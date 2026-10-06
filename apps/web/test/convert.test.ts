/** Motion import: animations on other skeletons (glTF, BVH) become canonical clips that play right. */
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { describe, expect, it } from 'vitest';
import type { HumanBone } from '@everloom/engine';
import { applyCanonical, prepareRig } from '../src/features/avatar3d/runtime/canonical';
import { decodeClip, sampleClip } from '../src/features/avatar3d/runtime/clip';
import { convertMotion } from '../src/features/avatar3d/runtime/convert';
import { boneDir, bonesOf, loadGlb } from './helpers3d';

async function target() {
  const g = await loadGlb('tests/fixtures/avatars/models/mannequin-f.glb');
  return prepareRig(g.scene, bonesOf(g.scene));
}

/** A BVH skeleton in T-pose (units: cm); frame 2 lowers the left arm 70° and steps forward 30 cm. */
type J = { name: string; offset: [number, number, number]; children?: J[]; end?: [number, number, number] };
const SKELETON: J = {
  name: 'Hips', offset: [0, 0, 0], children: [
    { name: 'Spine', offset: [0, 10, 0], children: [
      { name: 'Chest', offset: [0, 12, 0], children: [
        { name: 'Neck', offset: [0, 14, 0], children: [{ name: 'Head', offset: [0, 8, 0], end: [0, 10, 0] }] },
        { name: 'LeftShoulder', offset: [4, 12, 0], children: [{ name: 'LeftArm', offset: [10, 0, 0], children: [{ name: 'LeftForeArm', offset: [26, 0, 0], children: [{ name: 'LeftHand', offset: [24, 0, 0], end: [8, 0, 0] }] }] }] },
        { name: 'RightShoulder', offset: [-4, 12, 0], children: [{ name: 'RightArm', offset: [-10, 0, 0], children: [{ name: 'RightForeArm', offset: [-26, 0, 0], children: [{ name: 'RightHand', offset: [-24, 0, 0], end: [-8, 0, 0] }] }] }] },
      ] },
    ] },
    { name: 'LeftUpLeg', offset: [9, 0, 0], children: [{ name: 'LeftLeg', offset: [0, -42, 0], children: [{ name: 'LeftFoot', offset: [0, -40, 0], end: [0, -4, 12] }] }] },
    { name: 'RightUpLeg', offset: [-9, 0, 0], children: [{ name: 'RightLeg', offset: [0, -42, 0], children: [{ name: 'RightFoot', offset: [0, -40, 0], end: [0, -4, 12] }] }] },
  ],
};
function bvh(): string {
  const lines: string[] = ['HIERARCHY'];
  const order: string[] = [];
  const walk = (j: J, root: boolean) => {
    order.push(j.name);
    lines.push(`${root ? 'ROOT' : 'JOINT'} ${j.name}`, '{', `OFFSET ${j.offset.join(' ')}`, root ? 'CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation' : 'CHANNELS 3 Zrotation Xrotation Yrotation');
    for (const c of j.children ?? []) walk(c, false);
    if (j.end) lines.push('End Site', '{', `OFFSET ${j.end.join(' ')}`, '}');
    lines.push('}');
  };
  walk(SKELETON, true);
  const frame = (z: number, leftArmZ: number) => order.flatMap((n) => (n === 'Hips' ? [0, 86, z, 0, 0, 0] : n === 'LeftArm' ? [leftArmZ, 0, 0] : [0, 0, 0])).join(' ');
  lines.push('MOTION', 'Frames: 2', 'Frame Time: 1', frame(0, 0), frame(30, -70));
  return lines.join('\n');
}

describe('motion import', () => {
  it('converts a BVH: the left arm comes down, the walk forward is taken out', async () => {
    const parsed = new BVHLoader().parse(bvh());
    const root = new THREE.Group();
    root.add(parsed.skeleton.bones[0]!);
    const json = convertMotion({ scene: root, animations: [parsed.clip] }, parsed.clip, { id: 'bvh_test', loop: false, fps: 2 });
    const clip = decodeClip(json);
    const rig = await target();
    applyCanonical(rig, sampleClip(clip, clip.duration));
    const d = boneDir(rig, 'leftUpperArm', 'leftLowerArm');
    // Lowered 70° from horizontal: mostly down, still to its left.
    expect(d.y).toBeLessThan(-0.85);
    expect(d.x).toBeGreaterThan(0.2);
    const r = boneDir(rig, 'rightUpperArm', 'rightLowerArm');
    expect(r.x).toBeLessThan(-0.95);
    // In place: no forward travel left.
    expect(Math.abs(clip.hips ? clip.hips[clip.hips.length - 1]! : 0)).toBeLessThan(0.01);
  });

  it('converts a glTF animation on another rig', async () => {
    const g = await loadGlb('tests/fixtures/avatars/models/mannequin-m.glb');
    const bones = bonesOf(g.scene);
    const arm = bones.rightUpperArm!;
    const q0 = arm.quaternion.clone();
    // Raise the right arm about its own forward axis in the rig's frame: build from world directions.
    g.scene.updateMatrixWorld(true);
    const parentQ = arm.parent!.getWorldQuaternion(new THREE.Quaternion());
    const worldDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 3);
    const q1 = parentQ.clone().invert().multiply(worldDown).multiply(parentQ).multiply(q0);
    const track = new THREE.QuaternionKeyframeTrack(`${arm.name}.quaternion`, [0, 1], [...q0.toArray(), ...q1.toArray()]);
    const anim = new THREE.AnimationClip('raise', 1, [track]);
    const src = await loadGlb('tests/fixtures/avatars/models/mannequin-m.glb');
    const json = convertMotion({ scene: src.scene, animations: [anim] }, anim, { id: 'gltf_test', loop: false, fps: 4 });
    expect(Object.keys(json.tracks)).toContain('rightUpperArm' satisfies HumanBone);
    const rig = await target();
    const clip = decodeClip(json);
    applyCanonical(rig, sampleClip(clip, 0));
    const before = boneDir(rig, 'rightUpperArm', 'rightLowerArm');
    applyCanonical(rig, sampleClip(clip, clip.duration));
    const after = boneDir(rig, 'rightUpperArm', 'rightLowerArm');
    expect((before.angleTo(after) * 180) / Math.PI).toBeGreaterThan(40);
  });
});
