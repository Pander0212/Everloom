/**
 * Between three.js and the fitting core: the body's rest surface (neutral shape, bind pose, in the
 * model's own space) as typed arrays, and a rigged garment scene from a transfer result.
 */
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { HumanBone } from '@everloom/engine';
import { applyRestPose, type LoadedModel } from '../loader';
import { restGeometry } from '../skinning';
import type { BodyInput, ChainBone, TransferResult } from './core';

/** Meshes that aren't skin: never fitted against, never hidden. */
export const NOT_SKIN = /eye|teeth|tooth|tongue|brow|lash|hair|nail(?!s? ?body)/i;

export interface BodySurface {
  input: BodyInput;
  /** Body bones, in the order `input.joints` uses. */
  bones: THREE.Object3D[];
  /** Which mesh each vertex range belongs to (for coverage and region hiding). */
  ranges: Array<{ mesh: THREE.SkinnedMesh; vertexStart: number; vertexCount: number; triStart: number; triCount: number }>;
  /** Body meshes' names (the skin meshes). */
  names: string[];
}

const LEG = /UpperLeg|LowerLeg|Foot|Toes/;

/** Every bone's nearest humanoid ancestor (itself if it's mapped). */
function humanOf(model: LoadedModel) {
  const map = new Map<THREE.Object3D, HumanBone>();
  for (const [k, o] of Object.entries(model.bones)) if (o) map.set(o, k as HumanBone);
  return (b: THREE.Object3D): HumanBone | null => {
    for (let o: THREE.Object3D | null = b; o; o = o.parent) { const h = map.get(o); if (h) return h; }
    return null;
  };
}

/**
 * The body's surface for fitting. Positions are the bind pose with every morph at zero, in the space
 * of `model.scene` (what garments are placed in); morph offsets are carried along by name.
 */
export function bodySurface(model: LoadedModel, only?: readonly string[]): BodySurface {
  model.scene.updateMatrixWorld(true);
  const toScene = model.scene.matrixWorld.clone().invert();
  const meshes: THREE.SkinnedMesh[] = [];
  model.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.geometry.getAttribute('skinWeight') || !m.geometry.getAttribute('position')) return;
    if (only?.length ? !only.includes(m.name) : NOT_SKIN.test(m.name) || /^garment:/.test(m.parent?.name ?? '')) return;
    meshes.push(m);
  });
  if (!meshes.length) throw new Error('Automatic fitting needs a body with skin weights. Map or add a rig first.');
  const bones: THREE.Object3D[] = [];
  const boneIndex = new Map<THREE.Object3D, number>();
  const indexOf = (b: THREE.Object3D) => { let i = boneIndex.get(b); if (i === undefined) { i = bones.length; bones.push(b); boneIndex.set(b, i); } return i; };
  for (const h of ['hips', 'head'] as const) if (model.bones[h]) indexOf(model.bones[h]!);
  let vertices = 0, triangles = 0;
  for (const m of meshes) { vertices += m.geometry.getAttribute('position').count; triangles += (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3; }
  if (triangles > 300_000) throw new Error('Use a lighter body for automatic fitting (at most 300,000 surface triangles).');
  const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), indices = new Uint32Array(triangles * 3);
  const joints = new Uint16Array(vertices * 4), weights = new Float32Array(vertices * 4);
  const names = [...new Set(meshes.flatMap((m) => Object.keys(m.morphTargetDictionary ?? {})))];
  const morphs = names.map((name) => ({ name, deltas: new Float32Array(vertices * 3) }));
  const ranges: BodySurface['ranges'] = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), matrix = new THREE.Matrix4();
  let vo = 0, to = 0;
  // Rest pose: positions, normals and morph offsets through the skinning path (quantized files store
  // positions scaled, with the scale back in the inverse bind matrices).
  const saved = new Map([...(model.restPose?.keys() ?? [])].map((b) => [b, [b.position.clone(), b.quaternion.clone(), b.scale.clone()] as const]));
  applyRestPose(model);
  try {
  for (const m of meshes) {
    const g = m.geometry, pos = g.getAttribute('position'), nrm = g.getAttribute('normal'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
    const rest = restGeometry(m, toScene, !!nrm);
    positions.set(rest.positions, vo * 3);
    if (rest.normals) normals.set(rest.normals, vo * 3);
    for (let i = 0; i < pos.count; i++) {
      for (let k = 0; k < 4; k++) {
        const bone = m.skeleton.bones[si.getComponent(i, k)];
        const wt = sw.getComponent(i, k);
        joints[(vo + i) * 4 + k] = bone && wt > 0 ? indexOf(bone) : 0;
        weights[(vo + i) * 4 + k] = bone ? wt : 0;
      }
    }
    if (!nrm) computeNormals(positions, normals, g, vo);
    const dict = m.morphTargetDictionary ?? {};
    const entries = Object.entries(dict).filter(([, k]) => g.morphAttributes.position?.[k]);
    if (entries.length) {
      // Each vertex's own linear map (offsets are directions: no translation).
      const linear = new Float32Array(pos.count * 9), l3 = new THREE.Matrix3();
      for (let i = 0; i < pos.count; i++) linear.set(l3.setFromMatrix4(rest.matrixAt(i, matrix)).elements, i * 9);
      for (const [name, k] of entries) {
        const attr = g.morphAttributes.position![k]!;
        const out = morphs[names.indexOf(name)]!.deltas;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(attr, i);
          if (!g.morphTargetsRelative) v.sub(n.fromBufferAttribute(pos, i));
          v.applyMatrix3(l3.fromArray(linear, i * 9));
          out[(vo + i) * 3] = v.x; out[(vo + i) * 3 + 1] = v.y; out[(vo + i) * 3 + 2] = v.z;
        }
      }
    }
    const idx = g.index, tc = (idx?.count ?? pos.count) / 3;
    for (let t = 0; t < tc * 3; t++) indices[to * 3 + t] = (idx ? idx.getX(t) : t) + vo;
    ranges.push({ mesh: m, vertexStart: vo, vertexCount: pos.count, triStart: to, triCount: tc });
    vo += pos.count; to += tc;
  }
  } finally {
    for (const [b, [p, q, s]] of saved) { b.position.copy(p); b.quaternion.copy(q); b.scale.copy(s); }
    model.scene.updateMatrixWorld(true);
  }
  const human = humanOf(model);
  const boneSide = new Int8Array(bones.length), legBone = new Uint8Array(bones.length);
  bones.forEach((b, i) => {
    const h = human(b);
    boneSide[i] = h?.startsWith('left') ? -1 : h?.startsWith('right') ? 1 : 0;
    legBone[i] = h && LEG.test(h) ? 1 : 0;
  });
  const box = new THREE.Box3().setFromArray(positions);
  const input: BodyInput = { positions, normals, indices, joints, weights, morphs: morphs.filter((m) => m.deltas.some((x) => x !== 0)), boneCount: bones.length, boneSide, legBone, hips: model.bones.hips ? boneIndex.get(model.bones.hips)! : 0, head: model.bones.head ? boneIndex.get(model.bones.head)! : 0, height: Math.max(0.1, box.max.y - box.min.y) };
  return { input, bones, ranges, names: meshes.map((m) => m.name) };
}

function computeNormals(positions: Float32Array, normals: Float32Array, g: THREE.BufferGeometry, offset: number) {
  const count = g.getAttribute('position').count;
  const tmp = new THREE.BufferGeometry();
  tmp.setAttribute('position', new THREE.BufferAttribute(positions.slice(offset * 3, (offset + count) * 3), 3));
  if (g.index) tmp.setIndex(g.index);
  tmp.computeVertexNormals();
  normals.set(tmp.getAttribute('normal').array as Float32Array, offset * 3);
  tmp.dispose();
}

/** A body position (model space) to a bone's local space, for placing generated bones. */
function toLocal(bone: THREE.Object3D, p: [number, number, number], modelScene: THREE.Object3D) {
  modelScene.updateMatrixWorld(true);
  return new THREE.Vector3(...p).applyMatrix4(modelScene.matrixWorld).applyMatrix4(bone.matrixWorld.clone().invert());
}

export interface FittedPiece {
  name: string;
  /** The placed garment geometry (model space): uv, groups and materials are kept. */
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

/**
 * Bounds that hold the garment at any slider setting: its box, grown on each axis by every morph's
 * largest offset (sliders can combine). Straight over the arrays: three.js's own bounds with morph
 * targets take a second or more for a 20,000-vertex garment with a dozen morphs.
 */
export function morphBounds(g: THREE.BufferGeometry, positions: Float32Array, morphs: Array<{ deltas: Float32Array }>) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let a = 0; a < 3; a++) { const v = positions[i + a]!; if (v < lo[a]!) lo[a] = v; if (v > hi[a]!) hi[a] = v; }
  const grow = [0, 0, 0];
  for (const m of morphs) {
    const most = [0, 0, 0];
    for (let i = 0; i < m.deltas.length; i += 3) for (let a = 0; a < 3; a++) { const d = Math.abs(m.deltas[i + a]!); if (d > most[a]!) most[a] = d; }
    for (let a = 0; a < 3; a++) grow[a] += most[a]!;
  }
  const box = new THREE.Box3(new THREE.Vector3(lo[0]! - grow[0]!, lo[1]! - grow[1]!, lo[2]! - grow[2]!), new THREE.Vector3(hi[0]! + grow[0]!, hi[1]! + grow[1]!, hi[2]! + grow[2]!));
  if (box.isEmpty()) box.makeEmpty();
  g.boundingBox = box;
  g.boundingSphere = box.isEmpty() ? new THREE.Sphere() : box.getBoundingSphere(new THREE.Sphere());
}

/**
 * The rigged garment as its own scene: the body's skeleton (bind pose) with the generated swing
 * bones added, and one skinned mesh per piece with transferred weights and morph targets. Exported
 * as a GLB, it binds to any avatar of this base by bone names.
 */
export function buildGarmentScene(model: LoadedModel, surface: BodySurface, pieces: FittedPiece[], result: TransferResult): THREE.Object3D {
  // The file's own rest pose while copying (the pose the body was skinned in).
  applyRestPose(model);
  const output = clone(model.scene);
  const remove: THREE.Object3D[] = [];
  output.traverse((o) => { if ((o as THREE.Mesh).isMesh || o.name.startsWith('garment:') || o.name.startsWith('accessory:') || o.name === 'fitting') remove.push(o); });
  for (const o of remove) { for (const child of [...o.children]) if ((child as THREE.Bone).isBone) output.attach(child); o.removeFromParent(); }
  output.userData = {};
  output.updateMatrixWorld(true);
  const byName = new Map<string, THREE.Object3D>();
  output.traverse((o) => { if (!byName.has(o.name)) byName.set(o.name, o); });
  const skeletonBones: THREE.Bone[] = surface.bones.map((b) => {
    const twin = byName.get(b.name);
    if (!twin) throw new Error(`The copied skeleton lost the bone ${b.name}.`);
    // Some exporters skin to plain nodes; a skeleton takes any object.
    return twin as THREE.Bone;
  });
  // Generated bones, parented in order (a chain's root hangs from a body bone).
  const made = new Map<string, THREE.Bone>();
  for (const cb of result.bones as ChainBone[]) {
    const parent = typeof cb.parent === 'number' ? skeletonBones[cb.parent]! : made.get(cb.parent)!;
    const bone = new THREE.Bone();
    bone.name = cb.name;
    parent.updateMatrixWorld(true);
    bone.position.copy(toLocal(parent, cb.position, output));
    parent.add(bone);
    bone.updateMatrixWorld(true);
    made.set(cb.name, bone);
    skeletonBones.push(bone);
  }
  output.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(skeletonBones);
  pieces.forEach((piece, i) => {
    const r = result.meshes[i]!;
    const g = piece.geometry.clone();
    g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight');
    g.morphAttributes = {};
    g.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(r.joints, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(r.weights, 4));
    if (r.morphs.length) {
      g.morphTargetsRelative = true;
      g.morphAttributes.position = r.morphs.map((m) => { const a = new THREE.Float32BufferAttribute(m.deltas, 3); a.name = m.name; return a; });
    }
    g.computeVertexNormals();
    morphBounds(g, r.positions, r.morphs);
    const mesh = new THREE.SkinnedMesh(g, piece.material);
    mesh.name = piece.name || `Garment ${i + 1}`;
    if (r.morphs.length) mesh.updateMorphTargets();
    output.add(mesh);
    output.updateMatrixWorld(true);
    mesh.bind(skeleton, mesh.matrixWorld);
  });
  return output;
}
