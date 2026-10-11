import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyCanonical, emptyPose, prepareRig } from '../src/features/avatar3d/runtime/canonical';

/** A five-bone spine (Spine → Spine1 → Spine2 → Chest), as on many VRChat avatars, with arms so the facing is known. */
function rig() {
  const root = new THREE.Object3D();
  const bone = (n: string, p: THREE.Object3D, y: number, x = 0) => {
    const b = new THREE.Bone();
    b.name = n;
    b.position.set(x, y, 0);
    p.add(b);
    return b;
  };
  const hips = bone('Hips', root, 1);
  const spine = bone('Spine', hips, 0.1);
  const s1 = bone('Spine1', spine, 0.1);
  const s2 = bone('Spine2', s1, 0.1);
  const chest = bone('Chest', s2, 0.1);
  const neck = bone('Neck', chest, 0.15);
  const head = bone('Head', neck, 0.1);
  const lu = bone('L_UpperArm', chest, 0.1, 0.15);
  const ll = bone('L_LowerArm', lu, 0, 0.25);
  const ru = bone('R_UpperArm', chest, 0.1, -0.15);
  const rl = bone('R_LowerArm', ru, 0, -0.25);
  root.updateMatrixWorld(true);
  return { root, hips, spine, s1, s2, chest, neck, head, lu, ll, ru, rl };
}

describe('a long spine', () => {
  it('shares the spine’s bend over the unmapped spine bones, and the chest still ends where the pose puts it', () => {
    const a = rig();
    const r = prepareRig(a.root, { hips: a.hips, spine: a.spine, chest: a.chest, neck: a.neck, head: a.head, leftUpperArm: a.lu, leftLowerArm: a.ll, rightUpperArm: a.ru, rightLowerArm: a.rl });
    expect(r.spread?.spine?.bones.map((b) => b.name)).toEqual(['Spine1', 'Spine2']);
    const pose = emptyPose();
    pose.rot.spine = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(30));
    applyCanonical(r, pose);
    const angle = (q: THREE.Quaternion, rest: THREE.Quaternion) => THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(q.clone().multiply(rest.clone().invert()).w))));
    expect(angle(a.spine.quaternion, r.tlocal.spine!)).toBeCloseTo(10, 0);
    expect(angle(a.s1.quaternion, r.spread!.spine!.rest[0]!)).toBeCloseTo(10, 0);
    expect(angle(a.s2.quaternion, r.spread!.spine!.rest[1]!)).toBeCloseTo(10, 0);
    // The chest's world rotation is the full 30° bend.
    const chestWorld = a.chest.getWorldQuaternion(new THREE.Quaternion());
    expect(THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(chestWorld.w))))).toBeCloseTo(30, 0);
  });
});
