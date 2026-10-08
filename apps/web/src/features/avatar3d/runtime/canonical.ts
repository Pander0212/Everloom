/**
 * Retargeting through a canonical pose (the same idea as VRM's "normalized" humanoid).
 *
 * Every model is first brought to a corrected T-pose: limbs (arms, hands, fingers, legs) are rotated
 * so they point along canonical directions, whatever the rest pose was (T, A, or anything between).
 * Spine, neck, head, shoulders and feet keep their natural shape. The world rotation of each mapped
 * bone in that T-pose is T_b.
 *
 * A canonical pose gives each canonical bone a local rotation q_b in a world-aligned frame where the
 * T-pose is identity. Its normalized world rotation is N_b = N_parent · q_b, and the model's bone is
 * driven to world rotation N_b · T_b, solved top-down through the model's real parents (so twist and
 * helper bones in between keep working, and canonical bones a model lacks fold into their children).
 * Hips motion is stored divided by hips height and scaled back by the target's, so feet don't slide
 * much on different proportions.
 *
 * All rotations are taken in the model's facing frame: models facing -Z are turned around first.
 */
import * as THREE from 'three';
import { HUMANOID_BONES, HUMAN_PARENT, type HumanBone } from '@everloom/engine';

/** Canonical T-pose directions (character faces +Z, so its left is +X). */
const DIRS: Array<[HumanBone, HumanBone, THREE.Vector3]> = (() => {
  const L = new THREE.Vector3(1, 0, 0);
  const R = new THREE.Vector3(-1, 0, 0);
  const D = new THREE.Vector3(0, -1, 0);
  const out: Array<[HumanBone, HumanBone, THREE.Vector3]> = [];
  for (const [S, v] of [['left', L], ['right', R]] as const) {
    out.push([`${S}UpperArm` as HumanBone, `${S}LowerArm` as HumanBone, v], [`${S}LowerArm` as HumanBone, `${S}Hand` as HumanBone, v], [`${S}Hand` as HumanBone, `${S}MiddleProximal` as HumanBone, v]);
    for (const f of ['Index', 'Middle', 'Ring', 'Little']) out.push([`${S}${f}Proximal` as HumanBone, `${S}${f}Intermediate` as HumanBone, v], [`${S}${f}Intermediate` as HumanBone, `${S}${f}Distal` as HumanBone, v]);
    out.push([`${S}UpperLeg` as HumanBone, `${S}LowerLeg` as HumanBone, D], [`${S}LowerLeg` as HumanBone, `${S}Foot` as HumanBone, D]);
  }
  return out;
})();

export interface RigInfo {
  root: THREE.Object3D;
  bones: Partial<Record<HumanBone, THREE.Object3D>>;
  /** World rotation (in the facing frame) of each mapped bone in the corrected T-pose. */
  tpose: Partial<Record<HumanBone, THREE.Quaternion>>;
  /** Local rotation of every mapped bone in the corrected T-pose (to reset to). */
  tlocal: Partial<Record<HumanBone, THREE.Quaternion>>;
  /** Hips position in the parent's space at T-pose, and its height above the feet. */
  hipsRest: THREE.Vector3;
  hipsHeight: number;
  /** The facing frame: identity for +Z, a half turn for -Z. */
  facing: THREE.Quaternion;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

const worldPos = (o: THREE.Object3D, out: THREE.Vector3) => out.setFromMatrixPosition(o.matrixWorld);
function worldQuat(o: THREE.Object3D, out: THREE.Quaternion) {
  o.matrixWorld.decompose(_v1, out, _v2);
  return out;
}
/** World rotation of an object relative to the rig's root and facing frame. */
function frameQuat(rig: Pick<RigInfo, 'root' | 'facing'>, o: THREE.Object3D, out: THREE.Quaternion): THREE.Quaternion {
  worldQuat(o, out);
  worldQuat(rig.root, _q2);
  return out.premultiply(_q2.invert()).premultiply(_q1.copy(rig.facing).invert());
}

/** Which way the model faces, from where its left hand is (a character facing +Z has its left at +X). */
export function detectFacing(root: THREE.Object3D, bones: Partial<Record<HumanBone, THREE.Object3D>>): THREE.Quaternion {
  root.updateMatrixWorld(true);
  const l = bones.leftUpperArm ?? bones.leftHand ?? bones.leftUpperLeg;
  const r = bones.rightUpperArm ?? bones.rightHand ?? bones.rightUpperLeg;
  if (!l || !r) return new THREE.Quaternion();
  const inv = _m.copy(root.matrixWorld).invert();
  const lx = worldPos(l, _v1).applyMatrix4(inv).x;
  const rx = worldPos(r, _v2).applyMatrix4(inv).x;
  return lx >= rx ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
}

/**
 * Brings a model to its corrected T-pose and records what retargeting needs. The skeleton stays in
 * that T-pose afterwards. `bones` maps canonical names to the model's objects.
 */
export function prepareRig(root: THREE.Object3D, bones: Partial<Record<HumanBone, THREE.Object3D>>): RigInfo {
  root.updateMatrixWorld(true);
  // Independent control nodes occur in rigid game rigs. Attach their mapped
  // segments to the humanoid parent while preserving the bind-pose world matrix.
  // Existing ancestor chains (including twist/helper bones) remain in place.
  const unique = new Set(Object.values(bones)).size === Object.values(bones).length;
  if (unique) for (const name of HUMANOID_BONES) {
    const bone = bones[name]; if (!bone) continue;
    let parentName = HUMAN_PARENT[name]; while (parentName && !bones[parentName]) parentName = HUMAN_PARENT[parentName];
    const target = parentName ? bones[parentName] : undefined; if (!target) continue;
    let ancestor = bone.parent; while (ancestor && ancestor !== target) ancestor = ancestor.parent;
    if (ancestor) continue;
    let reverse = target.parent; while (reverse && reverse !== bone) reverse = reverse.parent;
    if (!reverse) target.attach(bone);
  }
  root.updateMatrixWorld(true);
  const facing = detectFacing(root, bones);
  const rig: RigInfo = { root, bones, tpose: {}, tlocal: {}, hipsRest: new THREE.Vector3(), hipsHeight: 1, facing };
  const rootQ = worldQuat(root, new THREE.Quaternion());
  const frameToWorld = new THREE.Quaternion().copy(rootQ).multiply(facing);
  for (const [b, c, dirFrame] of DIRS) {
    const bo = bones[b];
    const co = bones[c];
    if (!bo || !co) continue;
    bo.updateWorldMatrix(true, true);
    const from = worldPos(co, new THREE.Vector3()).sub(worldPos(bo, new THREE.Vector3()));
    if (from.lengthSq() < 1e-10) continue;
    from.normalize();
    const to = dirFrame.clone().applyQuaternion(frameToWorld).normalize();
    // Rotate the bone in world space by the shortest arc from its direction to the canonical one.
    const delta = new THREE.Quaternion().setFromUnitVectors(from, to);
    const world = worldQuat(bo, new THREE.Quaternion());
    const parentWorld = bo.parent ? worldQuat(bo.parent, new THREE.Quaternion()) : new THREE.Quaternion();
    const newWorld = delta.multiply(world);
    bo.quaternion.copy(parentWorld.invert().multiply(newWorld));
    bo.updateWorldMatrix(false, true);
  }
  root.updateMatrixWorld(true);
  for (const b of HUMANOID_BONES) {
    const o = bones[b];
    if (!o) continue;
    rig.tpose[b] = frameQuat(rig, o, new THREE.Quaternion());
    rig.tlocal[b] = o.quaternion.clone();
  }
  const hips = bones.hips;
  if (hips) {
    rig.hipsRest.copy(hips.position);
    const inv = _m.copy(root.matrixWorld).invert();
    const hy = worldPos(hips, new THREE.Vector3()).applyMatrix4(inv).y;
    const feet = [bones.leftFoot, bones.rightFoot, bones.leftToes, bones.rightToes].filter(Boolean).map((f) => worldPos(f!, new THREE.Vector3()).applyMatrix4(inv).y);
    const floor = feet.length ? Math.min(...feet) : 0;
    rig.hipsHeight = hy - floor > 1e-6 ? hy - floor : 1;
  }
  return rig;
}

/** A canonical pose: local rotations in the world-aligned T-pose frame, and the hips offset / hips height. */
export interface CanonicalPose {
  rot: Partial<Record<HumanBone, THREE.Quaternion>>;
  hips: THREE.Vector3;
}

export const emptyPose = (): CanonicalPose => ({ rot: {}, hips: new THREE.Vector3() });

/** Reads a model's current pose as a canonical pose (used to convert clips). */
export function readCanonical(rig: RigInfo, out: CanonicalPose = emptyPose()): CanonicalPose {
  rig.root.updateMatrixWorld(true);
  const N: Partial<Record<HumanBone, THREE.Quaternion>> = {};
  for (const b of HUMANOID_BONES) {
    const o = rig.bones[b];
    const T = rig.tpose[b];
    if (!o || !T) continue;
    const n = frameQuat(rig, o, new THREE.Quaternion()).multiply(_q1.copy(T).invert());
    N[b] = n;
    // The nearest mapped canonical ancestor.
    let p = HUMAN_PARENT[b];
    while (p && !N[p]) p = HUMAN_PARENT[p];
    const q = p ? _q2.copy(N[p]!).invert().multiply(n) : n.clone();
    (out.rot[b] ??= new THREE.Quaternion()).copy(q);
  }
  const hips = rig.bones.hips;
  if (hips) {
    // Parent transforms can contain centimetre-to-metre scales. Motion is in
    // root units; a quaternion alone loses that scale and amplifies translations.
    const parentToRoot = rig.root.matrixWorld.clone().invert().multiply(hips.parent?.matrixWorld ?? new THREE.Matrix4());
    out.hips.copy(hips.position).sub(rig.hipsRest).applyMatrix3(new THREE.Matrix3().setFromMatrix4(parentToRoot)).applyQuaternion(rig.facing.clone().invert()).multiplyScalar(1 / rig.hipsHeight);
  }
  return out;
}

const _N = new Map<HumanBone, THREE.Quaternion>();
const _desired = new THREE.Quaternion();
const _pf = new THREE.Quaternion();
/**
 * Poses a model from a canonical pose. Bones the pose doesn't mention stay in the T-pose. A weight
 * below 1 blends from the T-pose (used for fading in).
 */
export function applyCanonical(rig: RigInfo, pose: CanonicalPose, opts: { hips?: boolean } = {}) {
  _N.clear();
  for (const b of HUMANOID_BONES) {
    const p = HUMAN_PARENT[b];
    const parentN = p ? _N.get(p) : undefined;
    const q = pose.rot[b];
    const n = parentN ? parentN.clone() : new THREE.Quaternion();
    if (q) n.multiply(q);
    _N.set(b, n);
  }
  for (const b of HUMANOID_BONES) {
    const o = rig.bones[b];
    const T = rig.tpose[b];
    if (!o || !T) continue;
    // Desired world rotation in the facing frame, then local to the bone's real parent.
    _desired.copy(_N.get(b)!).multiply(T);
    if (o.parent) frameQuat(rig, o.parent, _pf);
    else _pf.identity();
    o.quaternion.copy(_pf.invert().multiply(_desired));
    // Its subtree (including unmapped twist bones before the next mapped one) needs the new matrix.
    o.updateWorldMatrix(false, true);
  }
  const hips = rig.bones.hips;
  if (hips && opts.hips !== false) {
    const parentToRoot = rig.root.matrixWorld.clone().invert().multiply(hips.parent?.matrixWorld ?? new THREE.Matrix4());
    hips.position.copy(pose.hips).multiplyScalar(rig.hipsHeight).applyQuaternion(rig.facing).applyMatrix3(new THREE.Matrix3().setFromMatrix4(parentToRoot).invert()).add(rig.hipsRest);
  }
  rig.root.updateMatrixWorld(true);
}

/** Resets a model to its corrected T-pose. */
export function resetToTPose(rig: RigInfo) {
  for (const b of HUMANOID_BONES) {
    const o = rig.bones[b];
    if (o && rig.tlocal[b]) o.quaternion.copy(rig.tlocal[b]!);
  }
  rig.bones.hips?.position.copy(rig.hipsRest);
  rig.root.updateMatrixWorld(true);
}
