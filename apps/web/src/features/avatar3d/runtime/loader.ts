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
  gltf: GLTF | null;
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
  /** Height in metres as shown (after the saved scale and any automatic fit). */
  height: number;
  /** Height before any scaling, in the file's own units. */
  rawHeight: number;
  /** The scale applied: the saved one, or an automatic fit when the size made no sense. */
  scale: number;
  autoFit: boolean;
  /** Metres to raise the feet above the floor (negative: lower). */
  floor: number;
}

let ktx2: KTX2Loader | null = null;

/**
 * three runs the Basis transcoder in a worker built from a blob, which inherits the page's CSP;
 * the transcoder needs eval, which the page never allows. Use the same worker served as a file
 * (tools/avatars/ktx2-worker.mjs), which the server gives a policy of its own.
 */
type KtxInternals = KTX2Loader & { init: () => Promise<void>; transcoderPending: Promise<void> | null; workerSourceURL: string; transcoderBinary: ArrayBuffer; workerConfig: unknown; workerPool: { setWorkerCreator: (f: () => Worker) => void } };
function withFileWorker(loader: KTX2Loader): KTX2Loader {
  const k = loader as KtxInternals;
  const init = k.init.bind(k);
  let ready: Promise<void> | null = null;
  k.init = () =>
    (ready ??= init().then(() => {
      URL.revokeObjectURL(k.workerSourceURL);
      k.workerPool.setWorkerCreator(() => {
        const w = new Worker('/three/basis/ktx2-worker.js');
        const bin = k.transcoderBinary.slice(0);
        w.postMessage({ type: 'init', config: k.workerConfig, transcoderBinary: bin }, [bin]);
        return w;
      });
    }));
  return loader;
}
export function loaderFor(renderer: THREE.WebGLRenderer | null): GLTFLoader {
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  if (renderer) {
    ktx2 ??= withFileWorker(new KTX2Loader().setTranscoderPath('/three/basis/').detectSupport(renderer));
    l.setKTX2Loader(ktx2);
  }
  // We pose the raw bones ourselves and update springs and expressions directly (never vrm.update()).
  l.register((parser) => new VRMLoaderPlugin(parser));
  return l;
}

/**
 * Finds objects by the name in the model file. three.js changes some characters in node names
 * ("mixamorig:Hips" becomes "mixamorigHips"), while saved settings use the file's names.
 */
export function nodeIndex(objects: THREE.Object3D[]): (fileName: string) => THREE.Object3D | undefined {
  const map = new Map<string, THREE.Object3D>();
  for (const o of objects) if (!map.has(o.name)) map.set(o.name, o);
  return (n) => map.get(n) ?? map.get(THREE.PropertyBinding.sanitizeNodeName(n));
}

/** Options saved with the avatar at import: bone and expression mapping fixes, scale, facing. */
export interface ModelOptions {
  boneMap?: Partial<Record<HumanBone, string>>;
  expressionMap?: ExpressionMap;
  /** Multiplier from the file's units to metres. */
  scale?: number;
  /** Degrees to turn the model so it faces the camera. */
  facing?: number;
  floor?: number;
  /** Mesh name → colour (replaces the material's base colour; textures keep their detail). */
  tints?: Record<string, string>;
}

/** People are 0.4–3 m tall; outside that the units are off (centimetres, millimetres, inches). */
const SANE = [0.4, 3] as const;
const FIT_HEIGHT = 1.65;

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
  const byName = nodeIndex(allBones);
  for (const [k, n] of Object.entries(map)) {
    const o = n ? byName(n) : undefined;
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
    // Faces drawn on the head (Everloom's code-made bodies and packs) sit a hair above the skin.
    if (/face_overlay/i.test(m.name))
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -2;
        mat.polygonOffsetUnits = -2;
      }
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

  if (opts.tints)
    for (const m of meshes) {
      const tint = opts.tints[m.name];
      if (!tint) continue;
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => {
        const c = x.clone() as THREE.MeshStandardMaterial;
        c.color?.set(tint);
        return c;
      });
      m.material = Array.isArray(m.material) ? mats : mats[0]!;
    }

  scene.updateMatrixWorld(true);
  const rawHeight = Math.max(1e-4, new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3()).y);
  let scale = opts.scale ?? 1;
  let autoFit = false;
  if (rawHeight * scale < SANE[0] || rawHeight * scale > SANE[1]) {
    scale = FIT_HEIGHT / rawHeight;
    autoFit = true;
  }
  scene.scale.multiplyScalar(scale);
  scene.rotation.y += ((opts.facing ?? 0) * Math.PI) / 180;
  scene.updateMatrixWorld(true);
  const height = Math.max(0.01, new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3()).y);
  return { gltf, scene, vrm, bones, missing, morphMeshes, morphNames: [...names], expressions, faceRig: ex.rig, secondaryChains: chains, meshes, height, rawHeight, scale, autoFit, floor: opts.floor ?? 0 };
}
