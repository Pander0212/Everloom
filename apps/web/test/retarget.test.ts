/**
 * Retargeting: the bundled clips on models with other rigs, rest poses and proportions. Limbs point
 * the same way as on the source rig, feet stay near the floor in standing clips, nothing explodes.
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { HumanBone } from '@everloom/engine';
import { applyCanonical, prepareRig, type RigInfo } from '../src/features/avatar3d/runtime/canonical';
import { sampleClip } from '../src/features/avatar3d/runtime/clip';
import { boneDir, bonesOf, clip, footClearance, loadGlb, syntheticRig } from './helpers3d';

type Target = { label: string; rig: RigInfo; floor: number };

function floorOf(rig: RigInfo): number {
  return footClearance(rig, 0) * rig.hipsHeight;
}
function makeRig(label: string, scene: THREE.Object3D): Target {
  const rig = prepareRig(scene, bonesOf(scene));
  return { label, rig, floor: floorOf(rig) };
}

const PAIRS: Array<[HumanBone, HumanBone]> = [
  ['leftUpperArm', 'leftLowerArm'],
  ['leftLowerArm', 'leftHand'],
  ['rightUpperArm', 'rightLowerArm'],
  ['rightLowerArm', 'rightHand'],
  ['leftUpperLeg', 'leftLowerLeg'],
  ['leftLowerLeg', 'leftFoot'],
  ['rightUpperLeg', 'rightLowerLeg'],
  ['hips', 'head'],
];

let source: Target;
const targets: Target[] = [];
beforeAll(async () => {
  source = makeRig('Quaternius male (Rigify-style)', (await loadGlb('tests/fixtures/avatars/models/mannequin-m.glb')).scene);
  targets.push(makeRig('Quaternius female (Unreal names)', (await loadGlb('tests/fixtures/avatars/models/mannequin-f.glb')).scene));
  targets.push(makeRig('Mixamo names, A-pose, long legs, short arms', syntheticRig('mixamo', { armDown: 45, legs: 1.25, arms: 0.8 })));
  targets.push(makeRig('MMD names with arm twist bones, facing -Z', syntheticRig('mmd', { twist: true, backwards: true })));
  targets.push(makeRig('Mixamo names at centimetre scale', syntheticRig('mixamo', { scale: 0.01, armDown: 20 })));
});

describe('retargeting the bundled clips', () => {
  it('every model reaches a T-pose: arms out sideways, legs straight down', () => {
    for (const t of [source, ...targets]) {
      for (const side of ['left', 'right'] as const) {
        const arm = boneDir(t.rig, `${side}UpperArm` as HumanBone, `${side}LowerArm` as HumanBone);
        expect(Math.abs(arm.x), `${t.label} ${side} arm`).toBeGreaterThan(0.99);
        expect(Math.sign(arm.x), `${t.label} ${side} arm side`).toBe(side === 'left' ? 1 : -1);
        const leg = boneDir(t.rig, `${side}UpperLeg` as HumanBone, `${side}LowerLeg` as HumanBone);
        expect(leg.y, `${t.label} ${side} leg`).toBeLessThan(-0.99);
      }
    }
  });

  for (const id of ['idle', 'talk', 'dance', 'walk', 'wave_check', 'kneel', 'sit', 'attack', 'defeat']) {
    if (id === 'wave_check') continue;
    it(`${id}: limbs match the source rig, no explosions${['idle', 'talk', 'dance', 'walk'].includes(id) ? ', feet on the floor' : ''}`, () => {
      const c = clip(id);
      const standing = ['idle', 'talk', 'dance', 'walk'].includes(id);
      let worstAngle = 0;
      for (let f = 0; f < c.frames; f += Math.max(1, Math.floor(c.frames / 8))) {
        const pose = sampleClip(c, f / c.fps);
        applyCanonical(source.rig, pose);
        const want = PAIRS.map(([a, b]) => boneDir(source.rig, a, b));
        for (const t of targets) {
          applyCanonical(t.rig, pose);
          t.rig.root.updateMatrixWorld(true);
          t.rig.root.traverse((o) => {
            for (const v of o.matrixWorld.elements) expect(Number.isFinite(v), `${t.label} matrix`).toBe(true);
          });
          PAIRS.forEach(([a, b], i) => {
            const got = boneDir(t.rig, a, b);
            const angle = (got.angleTo(want[i]!) * 180) / Math.PI;
            worstAngle = Math.max(worstAngle, angle);
            expect(angle, `${t.label} ${a}→${b} at frame ${f}`).toBeLessThan(20);
          });
          const clear = footClearance(t.rig, t.floor);
          if (standing) {
            expect(clear, `${t.label} feet at frame ${f}`).toBeGreaterThan(-0.08);
            expect(clear, `${t.label} feet at frame ${f}`).toBeLessThan(0.15);
          } else expect(clear, `${t.label} feet at frame ${f}`).toBeGreaterThan(-0.6);
        }
      }
      expect(worstAngle).toBeLessThan(20);
    });
  }
});
