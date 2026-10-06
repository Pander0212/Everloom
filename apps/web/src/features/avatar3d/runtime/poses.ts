/**
 * Fixed check poses for the import wizard: if the mapping is right, the arms go straight out in
 * the T-pose, straight up in "arms up", and the knees bend forward in "squat".
 * Angles are degrees in the canonical frame (facing +Z, the character's left at +X).
 */
import * as THREE from 'three';
import type { HumanBone } from '@everloom/engine';
import { emptyPose, type CanonicalPose } from './canonical';

type Euler = [number, number, number];
const D = Math.PI / 180;

/** Builds a pose from left-side angles; right-side bones get the mirror (x, −y, −z). */
export function poseFrom(angles: Partial<Record<HumanBone, Euler>>, hipsY = 0): CanonicalPose {
  const p = emptyPose();
  for (const [bone, [x, y, z]] of Object.entries(angles) as Array<[HumanBone, Euler]>) {
    p.rot[bone] = new THREE.Quaternion().setFromEuler(new THREE.Euler(x * D, y * D, z * D));
    if (bone.startsWith('left')) {
      const mirror = bone.replace(/^left/, 'right') as HumanBone;
      if (!(mirror in angles)) p.rot[mirror] = new THREE.Quaternion().setFromEuler(new THREE.Euler(x * D, -y * D, -z * D));
    }
  }
  p.hips.set(0, hipsY, 0);
  return p;
}

export const CHECK_POSES = {
  tpose: () => poseFrom({}),
  armsUp: () => poseFrom({ leftUpperArm: [0, 0, 82], leftLowerArm: [0, 0, 5] }),
  squat: () => poseFrom({ spine: [18, 0, 0], leftUpperLeg: [-95, 0, -4], leftLowerLeg: [100, 0, 0], leftFoot: [-10, 0, 0], leftUpperArm: [0, -70, -10], leftLowerArm: [0, -10, 0] }, -0.42),
  wave: () => poseFrom({ leftUpperArm: [0, 0, -72], rightUpperArm: [0, 0, -60], rightLowerArm: [0, 0, -45], rightHand: [0, 0, -10] }),
} as const;
export type CheckPose = keyof typeof CHECK_POSES;
