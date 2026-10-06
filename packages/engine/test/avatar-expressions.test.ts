import { describe, expect, it } from 'vitest';
import { faceWeights, mapExpressions } from '../src/avatar/expressions.js';

const ARKIT_52 = ['eyeBlinkLeft', 'eyeLookDownLeft', 'eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft', 'eyeSquintLeft', 'eyeWideLeft', 'eyeBlinkRight', 'eyeLookDownRight', 'eyeLookInRight', 'eyeLookOutRight', 'eyeLookUpRight', 'eyeSquintRight', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawRight', 'jawOpen', 'mouthClose', 'mouthFunnel', 'mouthPucker', 'mouthLeft', 'mouthRight', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper', 'mouthPressLeft', 'mouthPressRight', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'noseSneerLeft', 'noseSneerRight', 'tongueOut'];

describe('expression mapping', () => {
  it('ARKit 52: emotions and visemes from mixes, blinks direct', () => {
    const r = mapExpressions(ARKIT_52.map((n) => `Face.${n}`));
    expect(r.rig).toBe('arkit');
    expect(r.map.blinkLeft).toEqual([{ morph: 'Face.eyeBlinkLeft', weight: 1 }]);
    expect(r.map.joy!.map((m) => m.morph)).toContain('Face.mouthSmileLeft');
    expect(r.map.aa).toEqual([{ morph: 'Face.jawOpen', weight: 0.7 }]);
    expect(r.map.ou!.map((m) => m.morph)).toEqual(expect.arrayContaining(['Face.mouthFunnel', 'Face.mouthPucker']));
    for (const e of ['joy', 'sadness', 'anger', 'surprise', 'fear', 'disgust'] as const) expect(r.map[e], e).toBeTruthy();
  });

  it('VRoid (Fcl_*) names', () => {
    const r = mapExpressions(['Fcl_ALL_Neutral', 'Fcl_ALL_Angry', 'Fcl_ALL_Fun', 'Fcl_ALL_Joy', 'Fcl_ALL_Sorrow', 'Fcl_ALL_Surprised', 'Fcl_EYE_Close', 'Fcl_EYE_Close_L', 'Fcl_EYE_Close_R', 'Fcl_MTH_A', 'Fcl_MTH_I', 'Fcl_MTH_U', 'Fcl_MTH_E', 'Fcl_MTH_O']);
    expect(r.rig).toBe('vroid');
    expect(r.map).toMatchObject({ joy: [{ morph: 'Fcl_ALL_Joy' }], amusement: [{ morph: 'Fcl_ALL_Fun' }], sadness: [{ morph: 'Fcl_ALL_Sorrow' }], aa: [{ morph: 'Fcl_MTH_A' }], oh: [{ morph: 'Fcl_MTH_O' }], blink: [{ morph: 'Fcl_EYE_Close' }], blinkRight: [{ morph: 'Fcl_EYE_Close_R' }] });
  });

  it('VRM expression binds win', () => {
    const r = mapExpressions(['Face_Smile', 'Face_A', 'Blink'], { happy: [{ morph: 'Face_Smile', weight: 1 }], aa: [{ morph: 'Face_A', weight: 1 }], blink: [{ morph: 'Blink', weight: 1 }], angry: [{ morph: 'Missing', weight: 1 }] });
    expect(r.rig).toBe('vrm');
    expect(r.map.joy).toEqual([{ morph: 'Face_Smile', weight: 1 }]);
    expect(r.map.anger).toBeUndefined();
  });

  it('MMD Japanese morphs and VRChat visemes', () => {
    const mmd = mapExpressions(['まばたき', 'ウィンク', 'ウィンク右', 'あ', 'い', 'う', 'え', 'お', '笑い', '怒り', '困る']);
    expect(mmd.rig).toBe('mmd');
    expect(mmd.map).toMatchObject({ blink: [{ morph: 'まばたき' }], blinkRight: [{ morph: 'ウィンク右' }], aa: [{ morph: 'あ' }], joy: [{ morph: '笑い' }], anger: [{ morph: '怒り' }], sadness: [{ morph: '困る' }] });
    const vrc = mapExpressions(['vrc.v_aa', 'vrc.v_ih', 'vrc.v_ou', 'vrc.v_e', 'vrc.v_oh', 'vrc.blink_left', 'vrc.blink_right']);
    expect(vrc.map).toMatchObject({ aa: [{ morph: 'vrc.v_aa' }], ee: [{ morph: 'vrc.v_e' }], blinkLeft: [{ morph: 'vrc.blink_left' }] });
  });

  it('a model without face morphs maps nothing (and says so)', () => {
    const r = mapExpressions(['Breathe', 'Muscle']);
    expect(r).toMatchObject({ rig: 'none', found: [] });
  });

  it('face weights: fallbacks for missing emotions, smiles survive talking, blink without a combined blink', () => {
    const map = mapExpressions(['Joy', 'A', 'Blink_L', 'Blink_R']).map;
    // "love" isn't there: it borrows joy at 0.8.
    expect(faceWeights(map, { emotion: 'love', strength: 1 })).toEqual({ Joy: 0.8 });
    // Talking at full joy halves the mouth shape.
    expect(faceWeights(map, { emotion: 'joy', strength: 1, visemes: { aa: 1 } })).toEqual({ Joy: 1, A: 0.5 });
    expect(faceWeights(map, { emotion: 'neutral', strength: 0, blink: 1 })).toEqual({ Blink_L: 1, Blink_R: 1 });
    // No viseme shapes but a jaw: the jaw opens with the loudest viseme.
    const jaw = mapExpressions(['jawOpen']).map;
    expect(faceWeights(jaw, { emotion: 'neutral', strength: 0, visemes: { oh: 0.6, aa: 0.2 } })).toEqual({ jawOpen: 0.6 });
  });
});
