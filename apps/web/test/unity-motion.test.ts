import { expect, it } from 'vitest';
import { ClipSchema } from '@everloom/engine';
import { readAnim } from '@everloom/engine/unity';
import { unityMotionText } from '../src/features/avatar3d/runtime/unity/motion';
import { decodeClip, sampleClip, blendPose } from '../src/features/avatar3d/runtime/clip';
import { emptyPose } from '../src/features/avatar3d/runtime/canonical';
it('keeps animated face weights through validation, sampling and layer fading', () => {
  const source = `%YAML 1.1\n--- !u!74 &1\nAnimationClip:\n  m_Name: Blink\n  m_FloatCurves:\n  - attribute: blendShape.eyeBlinkLeft\n    classID: 137\n    path: Face\n    curve:\n      m_Curve:\n      - time: 0\n        value: 0\n      - time: 1\n        value: 100\n`;
  const { clip } = unityMotionText(source, { id: 'blink', loop: false });
  expect(ClipSchema.safeParse(clip).success).toBe(true);
  const pose = sampleClip(decodeClip(clip), 0.5);
  expect(pose.morphs?.eyeBlinkLeft).toBeCloseTo(0.5);
  expect(blendPose(emptyPose(), pose, 0.5).morphs?.eyeBlinkLeft).toBeCloseTo(0.25);
  expect(ClipSchema.safeParse({ ...clip, morphs: { broken: [0, 1] } }).success).toBe(false);
});
it('preserves muscle curves and produces normalized animated canonical rotations', () => {
  const source = `%YAML 1.1\n--- !u!74 &1\nAnimationClip:\n  m_Name: Raise arm\n  m_FloatCurves:\n  - attribute: Left Arm Down-Up\n    classID: 95\n    path: ''\n    curve:\n      m_Curve:\n      - time: 0\n        value: -1\n      - time: 1\n        value: 1\n`;
  expect(readAnim(source)?.muscleCurves).toHaveLength(1);
  const { clip, notes } = unityMotionText(source, { id: 'raise' });
  expect(ClipSchema.safeParse(clip).success).toBe(true);
  const decoded = decodeClip(clip), start = sampleClip(decoded, 0).rot.leftUpperArm!, end = sampleClip(decoded, 1).rot.leftUpperArm!;
  expect(start.angleTo(end)).toBeGreaterThan(1);
  expect(end.length()).toBeCloseTo(1);
  expect(notes.join(' ')).toMatch(/approximate/);
});
