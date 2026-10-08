/**
 * Loads a model (GLB/glTF or VRM 0.x/1.0) and works out what the rest of the runtime needs: the
 * canonical bone map, the morph targets, secondary-motion chains and the model's size.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { VRMLoaderPlugin, type VRM } from '@pixiv/three-vrm';
import { mapBones, mapExpressions, REQUIRED_BONES, type AvatarConfig, type ExpressionMap, type HumanBone, type MorphWeight, type RigBone } from '@everloom/engine';
import { buildHuman } from './makehuman';
import { createBodyMorphs, type BodyMorphWeights } from './body-shape';

export interface LoadedModel {
  bodyMorphs?: BodyMorphWeights;
  bodyMorphError?: string;
  gltf: GLTF | null;
  scene: THREE.Object3D;
  vrm: VRM | null;
  bones: Partial<Record<HumanBone, THREE.Object3D>>;
  /** Current editable skeleton, retaining names from the source file. */
  rigBones?: RigBone[];
  automaticBoneMap?: Partial<Record<HumanBone, string>>;
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
  /** Every bone's local transform as the file had it (the bind pose), for fitting and resets. */
  restPose?: Map<THREE.Object3D, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>;
}

/** Runs `fn` with the bones in the file's rest pose, then puts the current pose back. */
export function withRestPose<T>(model: LoadedModel, fn: () => T): T {
  if (!model.restPose) return fn();
  const saved = [...model.restPose.keys()].map((b) => [b, b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const);
  applyRestPose(model);
  try { return fn(); }
  finally {
    for (const [b, p, q, s] of saved) { b.position.copy(p); b.quaternion.copy(q); b.scale.copy(s); }
    model.scene.updateMatrixWorld(true);
  }
}

/** Puts every bone back where the file had it (the pose the meshes were skinned in). */
export function applyRestPose(model: LoadedModel) {
  if (!model.restPose) return;
  for (const [bone, t] of model.restPose) { bone.position.copy(t.position); bone.quaternion.copy(t.quaternion); bone.scale.copy(t.scale); }
  model.scene.updateMatrixWorld(true);
}

/** Release cancelled loads too: they never enter an Avatar's normal cleanup path. */
export function disposeLoadedModel(model: LoadedModel) {
  disposeScene(model.scene);
}

export function disposeScene(scene: THREE.Object3D) {
  const textures = new Set<THREE.Texture>((scene.userData.disposables as THREE.Texture[] | undefined) ?? []);
  const materials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>(), skeletons = new Set<THREE.Skeleton>();
  scene.traverse(object => {
    const mesh = object as THREE.SkinnedMesh; if (!mesh.isMesh) return;
    geometries.add(mesh.geometry); if (mesh.skeleton) skeletons.add(mesh.skeleton);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
    }
  });
  for (const texture of textures) texture.dispose(); for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose(); for (const skeleton of skeletons) skeleton.dispose();
}

let ktx2: KTX2Loader | null = null;
let draco: DRACOLoader | null = null;

function dracoLoader() {
  if (draco) return draco;
  draco = new DRACOLoader().setWorkerLimit(2);
  const internal = draco as DRACOLoader & { _initDecoder: () => Promise<void>; decoderPending: Promise<void> | null; decoderConfig: { wasmBinary?: ArrayBuffer }; workerSourceURL: string };
  internal._initDecoder = () => (internal.decoderPending ??= (async () => {
    const r = await fetch('/three/draco/draco_decoder.wasm', { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Draco decoder download failed (HTTP ${r.status}).`);
    internal.decoderConfig.wasmBinary = await r.arrayBuffer();
    internal.workerSourceURL = '/three/draco/draco-worker.js';
  })());
  return draco;
}

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
export function loaderFor(renderer: THREE.WebGLRenderer | null, manager?: THREE.LoadingManager): GLTFLoader {
  const l = new GLTFLoader(manager);
  l.setDRACOLoader(dracoLoader());
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
  bodyEdits?: boolean;
  bodyShape?: AvatarConfig['bodyShape'];
  makehuman?: AvatarConfig['makehuman'];
  content?: AvatarConfig['content'];
  /** Usable original if a compressed copy cannot be decoded on this device. */
  fallbackSource?: string | null;
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
  const read = async (input: string | ArrayBuffer): Promise<GLTF> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          let bytes = input;
          if (typeof input === 'string') {
            const r = await fetch(input, { credentials: 'same-origin', signal: controller.signal });
            if (!r.ok) throw new Error(`Model download failed (HTTP ${r.status}). ${r.status === 423 ? 'Unlock the Vault first.' : r.status === 401 ? 'Sign in again.' : 'Check that the model file still exists.'}`);
            bytes = await r.arrayBuffer();
          }
          return loader.parseAsync(bytes as ArrayBuffer, '');
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Loading the model timed out after 60 seconds. Check the network and try a smaller model.')); }, 60000); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  let gltf: GLTF;
  try { gltf = opts.makehuman ? { scene: await buildHuman(opts.makehuman, undefined, opts.content), animations: [], userData: {} } as unknown as GLTF : await read(source); }
  catch (e) {
    if (opts.makehuman) {
      // A portable bundle remains renderable before its optional editable CC0 library is installed.
      if ((e as Error).message === 'Install MakeHuman core and system assets first.') gltf = await read(source);
      else throw e;
    } else {
    if (!opts.fallbackSource || opts.fallbackSource === source) throw e;
    try { gltf = await read(opts.fallbackSource); }
    catch (originalError) { throw new Error(`The prepared model and its original could not be loaded: ${(originalError as Error).message}`); }
    }
  }
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
  scene.traverse(object => {
    if (!(object as THREE.Mesh).isMesh && !allBones.includes(object)) return;
    let ancestor = object.parent;
    while (ancestor && ancestor !== scene) {
      // A multi-material glTF mesh is a Group in three.js; it is still a mesh
      // node, and its name must not be mistaken for a humanoid joint.
      const association = gltf.parser?.associations.get(ancestor) as { meshes?: number } | undefined;
      if (!(ancestor as THREE.Mesh).isMesh && association?.meshes === undefined && !allBones.includes(ancestor)) allBones.push(ancestor);
      ancestor = ancestor.parent;
    }
  });
  const set = new Set(allBones);
  const restPose = new Map(allBones.map((b) => [b, { position: b.position.clone(), quaternion: b.quaternion.clone(), scale: b.scale.clone() }]));
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
  const runtimeName = nodeIndex(allBones), originalNames = new Map<string, THREE.Object3D>();
  for (const bone of allBones) {
    const association = gltf.parser?.associations.get(bone) as { nodes?: number } | undefined;
    const original = association?.nodes === undefined ? undefined : gltf.parser?.json.nodes?.[association.nodes]?.name;
    if (original && !originalNames.has(original)) originalNames.set(original, bone);
  }
  const byName = (name: string) => originalNames.get(name) ?? runtimeName(name);
  const sourceNames = new Map([...originalNames].map(([name, object]) => [object, name]));
  const editableBones = allBones.map(bone => ({ name: sourceNames.get(bone) ?? bone.name, parent: bone.parent && set.has(bone.parent) ? sourceNames.get(bone.parent) ?? bone.parent.name : null }));
  const automaticBoneMap = Object.fromEntries(Object.entries(auto.map).map(([key, name]) => {
    const object = name ? runtimeName(name) : undefined;
    return [key, object ? sourceNames.get(object) ?? object.name : name];
  }));
  for (const [k, n] of Object.entries(map)) {
    const o = n ? byName(n) : undefined;
    if (o) bones[k as HumanBone] = o;
  }
  const missing = REQUIRED_BONES.filter(bone => !bones[bone]);
  let bodyMorphs: BodyMorphWeights | undefined, bodyMorphError: string | undefined;
  if (!opts.makehuman && (opts.bodyEdits || opts.bodyShape)) {
    try { bodyMorphs = createBodyMorphs(scene, bones, opts.bodyShape); }
    catch (e) { bodyMorphError = (e as Error).message; }
  }

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
  return { bodyMorphs, bodyMorphError, gltf, scene, vrm, bones, rigBones: editableBones, automaticBoneMap, missing, morphMeshes, morphNames: [...names], expressions, faceRig: ex.rig, secondaryChains: chains, meshes, height, rawHeight, scale, autoFit, floor: opts.floor ?? 0, restPose };
}
