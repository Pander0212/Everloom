/**
 * Loads a model (GLB/glTF or VRM 0.x/1.0) and works out what the rest of the runtime needs: the
 * canonical bone map, the morph targets, secondary-motion chains and the model's size.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { VRMLoaderPlugin, type VRM } from '@pixiv/three-vrm';
import { mapBones, mapExpressions, type ExpressionMap, type HumanBone, type MorphWeight, type RigBone } from '@everloom/engine';

export interface LoadedModel {
  gltf: GLTF;
  scene: THREE.Object3D;
  vrm: VRM | null;
  bones: Partial<Record<HumanBone, THREE.Object3D>>;
  missing: HumanBone[];
  /** Meshes with morph targets (expressions are applied to all of them by name). */
  morphMeshes: THREE.Mesh[];
  morphNames: string[];
  expressions: ExpressionMap;
  faceRig: string;
  /** Bone chains for hair, skirts, tails and accessories (not part of the humanoid). */
  secondaryChains: THREE.Object3D[][];
  /** Every mesh, by name (for wardrobe level 2: toggling parts). */
  meshes: THREE.Mesh[];
  height: number;
}

let ktx2: KTX2Loader | null = null;
function loaderFor(renderer: THREE.WebGLRenderer | null): GLTFLoader {
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  if (renderer) {
    ktx2 ??= new KTX2Loader().setTranscoderPath('/three/basis/').detectSupport(renderer);
    l.setKTX2Loader(ktx2);
  }
  // We pose the raw bones ourselves and update springs and expressions directly (never vrm.update()).
  l.register((parser) => new VRMLoaderPlugin(parser));
  return l;
}

/** Options saved with the avatar at import: bone and expression mapping fixes, scale, facing. */
export interface ModelOptions {
  boneMap?: Partial<Record<HumanBone, string>>;
  expressionMap?: ExpressionMap;
}

export async function loadModel(source: string | ArrayBuffer, renderer: THREE.WebGLRenderer | null, opts: ModelOptions = {}): Promise<LoadedModel> {
  const loader = loaderFor(renderer);
  const gltf: GLTF = typeof source === 'string' ? await loader.loadAsync(source) : await new Promise((resolve, reject) => loader.parse(source, '', resolve, reject));
  const vrm: VRM | null = (gltf.userData as { vrm?: VRM }).vrm ?? null;
  const scene: THREE.Object3D = vrm ? vrm.scene : gltf.scene;

  // Bones, with parents limited to bones.
  const allBones: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) allBones.push(o);
  });
  // Some exporters skin to plain nodes: take every skeleton's joints too.
  scene.traverse((o) => {
    const sk = (o as THREE.SkinnedMesh).skeleton;
    if (sk) for (const b of sk.bones) if (!allBones.includes(b)) allBones.push(b);
  });
  const set = new Set(allBones);
  const rigBones: RigBone[] = allBones.map((b) => ({ name: b.name, parent: b.parent && set.has(b.parent) ? b.parent.name : null }));
  let vrmMap: Record<string, string> | null = null;
  if (vrm) {
    vrmMap = {};
    const humanBones = vrm.humanoid.rawHumanBones as Record<string, { node: THREE.Object3D } | undefined>;
    for (const [k, v] of Object.entries(humanBones)) if (v?.node) vrmMap[k] = v.node.name;
  }
  const auto = mapBones(rigBones, vrmMap);
  const map = { ...auto.map, ...(opts.boneMap ?? {}) };
  const bones: Partial<Record<HumanBone, THREE.Object3D>> = {};
  for (const [k, n] of Object.entries(map)) {
    const o = allBones.find((b) => b.name === n);
    if (o) bones[k as HumanBone] = o;
  }
  const missing = auto.missing.filter((b) => !bones[b]);

  // Morph targets.
  const morphMeshes: THREE.Mesh[] = [];
  const names = new Set<string>();
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes.push(m);
    if (m.morphTargetDictionary && Object.keys(m.morphTargetDictionary).length) {
      morphMeshes.push(m);
      for (const n of Object.keys(m.morphTargetDictionary)) names.add(n);
    }
  });
  let vrmExpr: Record<string, MorphWeight[]> | null = null;
  if (vrm?.expressionManager) {
    // VRM expressions drive their own binds; map them by preset name.
    vrmExpr = {};
    for (const e of vrm.expressionManager.expressions) vrmExpr[e.expressionName] = [{ morph: `vrm:${e.expressionName}`, weight: 1 }];
    for (const e of Object.keys(vrmExpr)) names.add(`vrm:${e}`);
  }
  const ex = mapExpressions([...names], vrmExpr);
  const expressions = { ...ex.map, ...(opts.expressionMap ?? {}) };

  // Secondary chains: bones outside the humanoid whose names say hair, skirt, tail, ribbon… (or
  // VRoid's J_Sec_), starting where they leave a humanoid bone.
  const mapped = new Set(Object.values(bones));
  const SEC = /hair|skirt|tail|ribbon|cape|cloak|coat|sleeve|ear|breast|bust|chain|tie|scarf|sec_|^j_sec|ponytail|braid|bang|髪|スカート|尻尾|リボン/i;
  const chains: THREE.Object3D[][] = [];
  if (!vrm?.springBoneManager || vrm.springBoneManager.joints.size === 0) {
    for (const b of allBones) {
      if (mapped.has(b) || !SEC.test(b.name)) continue;
      if (b.parent && !mapped.has(b.parent) && SEC.test(b.parent.name)) continue; // not a chain start
      const chain: THREE.Object3D[] = [b];
      let cur: THREE.Object3D = b;
      while (cur.children.length && chain.length < 12) {
        const next = cur.children.find((c) => set.has(c));
        if (!next) break;
        chain.push(next);
        cur = next;
      }
      chains.push(chain);
    }
  }

  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const height = Math.max(0.01, box.max.y - box.min.y);
  return { gltf, scene, vrm, bones, missing, morphMeshes, morphNames: [...names], expressions, faceRig: ex.rig, secondaryChains: chains, meshes, height };
}
