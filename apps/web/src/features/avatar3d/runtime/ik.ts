/**
 * Light inverse kinematics: a two-bone chain (upper arm, forearm, hand; or thigh, shin, foot) is
 * bent and turned so its end reaches a target, blended by a weight. The elbow or knee bends in the
 * plane it already bends in, so poses keep their character. Lengths never change.
 */
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _w = new THREE.Quaternion(), _id = new THREE.Quaternion();

/** Turns `bone` by a world-space rotation `delta` (blended by weight), keeping its parent. */
function rotateWorld(bone: THREE.Object3D, delta: THREE.Quaternion, weight: number) {
  const d = _q.copy(_id).slerp(delta, weight);
  bone.parent?.getWorldQuaternion(_p);
  bone.getWorldQuaternion(_w);
  // new world = d · world  →  new local = parent⁻¹ · d · world
  bone.quaternion.copy(_p.invert().multiply(d).multiply(_w));
  bone.updateWorldMatrix(false, true);
}

/**
 * Moves the chain's end toward `target` (world space). Returns how far the end is from the target
 * afterwards (0 when reachable and weight is 1).
 */
export function solveTwoBone(root: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, weight = 1, pole?: THREE.Vector3): number {
  root.updateWorldMatrix(true, true);
  if (weight <= 0) return end.getWorldPosition(_c).distanceTo(target);
  const a = root.getWorldPosition(_a.clone()), b = mid.getWorldPosition(_b.clone()), c = end.getWorldPosition(_c.clone());
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  if (l1 < 1e-6 || l2 < 1e-6) return c.distanceTo(target);
  const t = _t.copy(target);
  // As far as the target, but never straighter than almost straight nor tighter than fully folded.
  const reach = THREE.MathUtils.clamp(a.distanceTo(t), Math.max(Math.abs(l1 - l2) * 1.001, 1e-5), (l1 + l2) * 0.999);
  // 1. The elbow: the angle at the mid joint that makes root→end as long as root→target.
  const ab = b.clone().sub(a), cb = c.clone().sub(b);
  let axis = ab.clone().cross(cb);
  if (axis.lengthSq() < 1e-12) axis = pole ? ab.clone().cross(pole.clone().sub(a)) : ab.clone().cross(new THREE.Vector3(0, 0, 1));
  if (axis.lengthSq() < 1e-12) axis = ab.clone().cross(new THREE.Vector3(1, 0, 0));
  axis.normalize();
  const current = Math.acos(THREE.MathUtils.clamp(a.clone().sub(b).normalize().dot(c.clone().sub(b).normalize()), -1, 1));
  const wanted = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - reach * reach) / (2 * l1 * l2), -1, 1));
  rotateWorld(mid, new THREE.Quaternion().setFromAxisAngle(axis, current - wanted), weight);
  // 2. The shoulder: aim root→end at the target.
  root.updateWorldMatrix(true, true);
  const c2 = end.getWorldPosition(new THREE.Vector3());
  const from = c2.sub(a).normalize(), to = target.clone().sub(a).normalize();
  rotateWorld(root, new THREE.Quaternion().setFromUnitVectors(from, to), weight);
  // 3. With a pole (a world point), swing the elbow toward it around the shoulder→hand line; the hand stays.
  if (pole) {
    const axis2 = end.getWorldPosition(new THREE.Vector3()).sub(a);
    if (axis2.lengthSq() > 1e-10) {
      axis2.normalize();
      const flat = (v: THREE.Vector3) => v.sub(a).addScaledVector(axis2, -v.dot(axis2));
      const elbow = flat(mid.getWorldPosition(new THREE.Vector3())), want = flat(pole.clone());
      if (elbow.lengthSq() > 1e-10 && want.lengthSq() > 1e-10) {
        const angle = Math.atan2(elbow.clone().cross(want).dot(axis2), elbow.dot(want));
        rotateWorld(root, new THREE.Quaternion().setFromAxisAngle(axis2, angle), weight);
      }
    }
  }
  return end.getWorldPosition(new THREE.Vector3()).distanceTo(target);
}
