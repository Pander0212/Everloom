/**
 * Expression mapping: a model's morph targets (blend shapes) onto Everloom's emotions, blinks and
 * mouth shapes. Recognises ARKit's 52 shapes, VRM 0.x and 1.0 presets, VRoid's Fcl_* names, VRChat
 * visemes, MMD's Japanese morphs and common Blender names. Each canonical expression becomes a mix of
 * one or more morphs with weights, so ARKit models (which have no "happy" shape) still smile.
 */
import { EMOTIONS, type Emotion } from '../game/emotion.js';

export const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'] as const;
export type Viseme = (typeof VISEMES)[number];
export const FACE_CONTROLS = ['blink', 'blinkLeft', 'blinkRight', 'jawOpen'] as const;
export type FaceControl = (typeof FACE_CONTROLS)[number];
export type CanonicalExpression = Emotion | Viseme | FaceControl;
export const CANONICAL_EXPRESSIONS: CanonicalExpression[] = [...EMOTIONS, ...VISEMES, ...FACE_CONTROLS];

export interface MorphWeight {
  /** Morph target name (as in the model). */
  morph: string;
  weight: number;
}
export type ExpressionMap = Partial<Record<CanonicalExpression, MorphWeight[]>>;

/** Lower-case, no separators: "Fcl_MTH_A" → "fclmtha", "eyeBlink_L" → "eyeblinkl". */
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s._\-:|]+/g, '');

/** Direct single-morph names per canonical expression (normalized, first match wins). */
const DIRECT: Partial<Record<CanonicalExpression, string[]>> = {
  // VRM 1.0, VRM 0.x, VRoid, common names, MMD
  joy: ['happy', 'joy', 'fclalljoy', 'smile', 'smiling', '笑い', 'にこり', 'mouthsmile'],
  amusement: ['fun', 'fclallfun', 'laugh', 'laughing', 'grin', 'にやり'],
  anger: ['angry', 'anger', 'fclallangry', 'mad', '怒り'],
  sadness: ['sad', 'sorrow', 'fclallsorrow', 'sadness', '困る', '悲しい'],
  surprise: ['surprised', 'surprise', 'fclallsurprised', 'shock', '驚き', 'びっくり'],
  neutral: ['neutral', 'fclallneutral', 'default', '真面目'],
  embarrassment: ['shy', 'embarrassed', 'blush', 'fclallshy', '照れ', 'てれ'],
  fear: ['fear', 'scared', 'afraid'],
  disgust: ['disgust', 'disgusted'],
  confusion: ['confused', 'confusion', '?'],
  love: ['love', 'heart'],
  pride: ['proud', 'smug', 'ドヤ'],
  aa: ['aa', 'a', 'fclmtha', 'vrcvaa', 'vaa', 'mouthaa', 'あ'],
  ih: ['ih', 'i', 'fclmthi', 'vrcvih', 'vih', 'mouthih', 'い'],
  ou: ['ou', 'u', 'fclmthu', 'vrcvou', 'vou', 'mouthou', 'う'],
  ee: ['ee', 'e', 'fclmthe', 'vrcve', 've', 'vrcvee', 'mouthee', 'え'],
  oh: ['oh', 'o', 'fclmtho', 'vrcvoh', 'voh', 'mouthoh', 'お'],
  blink: ['blink', 'fcleyeclose', 'eyesclosed', 'eyeclose', 'vrcblink', 'まばたき'],
  blinkLeft: ['blinkleft', 'blinkl', 'fcleyeclosel', 'vrcblinkleft', 'eyeblinkleft', 'eyeblinkl', 'ウィンク', 'winkl', 'wink'],
  blinkRight: ['blinkright', 'blinkr', 'fcleyecloser', 'vrcblinkright', 'eyeblinkright', 'eyeblinkr', 'ウィンク右', 'winkr'],
  jawOpen: ['jawopen', 'mouthopen', 'openmouth', '口開け'],
};

/** ARKit mixes for expressions that have no single shape. */
const ARKIT: Partial<Record<CanonicalExpression, Array<[string, number]>>> = {
  joy: [['mouthSmileLeft', 0.85], ['mouthSmileRight', 0.85], ['cheekSquintLeft', 0.4], ['cheekSquintRight', 0.4], ['eyeSquintLeft', 0.3], ['eyeSquintRight', 0.3]],
  amusement: [['mouthSmileLeft', 1], ['mouthSmileRight', 1], ['jawOpen', 0.3], ['eyeSquintLeft', 0.6], ['eyeSquintRight', 0.6], ['cheekSquintLeft', 0.6], ['cheekSquintRight', 0.6]],
  sadness: [['mouthFrownLeft', 0.7], ['mouthFrownRight', 0.7], ['browInnerUp', 0.8], ['eyeLookDownLeft', 0.2], ['eyeLookDownRight', 0.2]],
  anger: [['browDownLeft', 0.9], ['browDownRight', 0.9], ['mouthPressLeft', 0.5], ['mouthPressRight', 0.5], ['noseSneerLeft', 0.4], ['noseSneerRight', 0.4]],
  surprise: [['eyeWideLeft', 0.8], ['eyeWideRight', 0.8], ['browInnerUp', 0.7], ['browOuterUpLeft', 0.6], ['browOuterUpRight', 0.6], ['jawOpen', 0.35]],
  fear: [['eyeWideLeft', 0.9], ['eyeWideRight', 0.9], ['browInnerUp', 1], ['mouthStretchLeft', 0.5], ['mouthStretchRight', 0.5]],
  disgust: [['noseSneerLeft', 0.8], ['noseSneerRight', 0.8], ['mouthUpperUpLeft', 0.5], ['mouthUpperUpRight', 0.5], ['browDownLeft', 0.4], ['browDownRight', 0.4]],
  embarrassment: [['mouthSmileLeft', 0.4], ['mouthSmileRight', 0.4], ['eyeLookDownLeft', 0.4], ['eyeLookDownRight', 0.4], ['browInnerUp', 0.3]],
  confusion: [['browDownLeft', 0.5], ['browOuterUpRight', 0.6], ['mouthLeft', 0.3]],
  curiosity: [['browOuterUpLeft', 0.5], ['browOuterUpRight', 0.5], ['mouthSmileLeft', 0.2], ['mouthSmileRight', 0.2]],
  pride: [['mouthSmileLeft', 0.5], ['mouthSmileRight', 0.2], ['eyeSquintLeft', 0.3], ['eyeSquintRight', 0.3]],
  love: [['mouthSmileLeft', 0.7], ['mouthSmileRight', 0.7], ['eyeSquintLeft', 0.4], ['eyeSquintRight', 0.4]],
  relief: [['mouthSmileLeft', 0.3], ['mouthSmileRight', 0.3], ['browInnerUp', 0.3]],
  nervousness: [['browInnerUp', 0.6], ['mouthStretchLeft', 0.3], ['mouthStretchRight', 0.3]],
  aa: [['jawOpen', 0.7]],
  ih: [['jawOpen', 0.25], ['mouthStretchLeft', 0.4], ['mouthStretchRight', 0.4]],
  ou: [['mouthFunnel', 0.7], ['mouthPucker', 0.5], ['jawOpen', 0.15]],
  ee: [['jawOpen', 0.2], ['mouthSmileLeft', 0.4], ['mouthSmileRight', 0.4]],
  oh: [['mouthFunnel', 0.6], ['jawOpen', 0.45]],
  blink: [['eyeBlinkLeft', 1], ['eyeBlinkRight', 1]],
  blinkLeft: [['eyeBlinkLeft', 1]],
  blinkRight: [['eyeBlinkRight', 1]],
  jawOpen: [['jawOpen', 1]],
};

/** Emotions a model lacks borrow from these, in order (and finally from neutral: nothing). */
export const EXPRESSION_FALLBACK: Partial<Record<Emotion, Array<[Emotion, number]>>> = {
  amusement: [['joy', 1]],
  love: [['joy', 0.8]],
  pride: [['joy', 0.6]],
  relief: [['joy', 0.5]],
  curiosity: [['surprise', 0.35], ['joy', 0.3]],
  embarrassment: [['joy', 0.5]],
  nervousness: [['sadness', 0.4]],
  confusion: [['sadness', 0.3]],
  fear: [['surprise', 0.7], ['sadness', 0.4]],
  disgust: [['anger', 0.6]],
  joy: [['amusement', 0.8]],
};

export interface ExpressionMapResult {
  map: ExpressionMap;
  /** Which kind of face rig it found. */
  rig: 'arkit' | 'vrm' | 'vroid' | 'mmd' | 'named' | 'none';
  /** Expressions mapped directly or by mix (not by fallback). */
  found: CanonicalExpression[];
}

/**
 * Maps a model's morph targets. `vrmExpressions` (VRM preset → morph binds) wins when present.
 */
export function mapExpressions(morphs: string[], vrmExpressions?: Partial<Record<string, MorphWeight[]>> | null): ExpressionMapResult {
  const map: ExpressionMap = {};
  const byNorm = new Map<string, string>();
  for (const m of morphs) if (!byNorm.has(norm(m))) byNorm.set(norm(m), m);
  // ARKit shapes sometimes carry a mesh prefix ("Face.eyeBlinkLeft", "blendShape1.jawOpen").
  const arkit = new Map<string, string>();
  for (const m of morphs) {
    const tail = m.split(/[.|:]/).pop()!;
    arkit.set(tail.toLowerCase(), m);
  }
  const isArkit = ['eyeblinkleft', 'jawopen', 'mouthsmileleft', 'browinnerup'].filter((k) => arkit.has(k)).length >= 3;
  const vrmKey: Record<string, CanonicalExpression> = { happy: 'joy', joy: 'joy', angry: 'anger', sad: 'sadness', sorrow: 'sadness', relaxed: 'relief', fun: 'amusement', surprised: 'surprise', aa: 'aa', a: 'aa', ih: 'ih', i: 'ih', ou: 'ou', u: 'ou', ee: 'ee', e: 'ee', oh: 'oh', o: 'oh', blink: 'blink', blinkleft: 'blinkLeft', blink_l: 'blinkLeft', blinkright: 'blinkRight', blink_r: 'blinkRight', neutral: 'neutral' };
  if (vrmExpressions) {
    for (const [k, binds] of Object.entries(vrmExpressions)) {
      const c = vrmKey[k.toLowerCase()];
      if (c && binds?.length) map[c] = binds.filter((b) => morphs.includes(b.morph));
    }
  }
  for (const c of CANONICAL_EXPRESSIONS) {
    if (map[c]?.length) continue;
    const direct = DIRECT[c]?.map((n) => byNorm.get(n)).find(Boolean);
    if (direct) {
      map[c] = [{ morph: direct, weight: 1 }];
      continue;
    }
    if (isArkit && ARKIT[c]) {
      const mix = ARKIT[c]!.map(([k, w]) => ({ morph: arkit.get(k.toLowerCase()), weight: w })).filter((x): x is MorphWeight => !!x.morph);
      if (mix.length) map[c] = mix;
    }
  }
  for (const k of Object.keys(map) as CanonicalExpression[]) if (!map[k]?.length) delete map[k];
  const found = Object.keys(map) as CanonicalExpression[];
  const rig: ExpressionMapResult['rig'] = vrmExpressions && found.length ? 'vrm' : isArkit ? 'arkit' : morphs.some((m) => /^Fcl_/i.test(m)) ? 'vroid' : morphs.some((m) => /[あいうえお]|まばたき/.test(m)) ? 'mmd' : found.length ? 'named' : 'none';
  return { map, rig, found };
}

/**
 * The morph weights for one moment: an emotion at some strength, a viseme mix for the mouth, and
 * the blink. Emotions the model lacks borrow from EXPRESSION_FALLBACK. Mouth shapes yield to a
 * strong emotion's mouth (a smile stays a smile while talking).
 */
export function faceWeights(map: ExpressionMap, s: { emotion: Emotion; strength: number; visemes?: Partial<Record<Viseme, number>>; blink?: number; jaw?: number }): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (list: MorphWeight[] | undefined, k: number) => {
    if (!list || k <= 0) return;
    for (const { morph, weight } of list) out[morph] = Math.min(1, (out[morph] ?? 0) + weight * k);
  };
  const emo = (e: Emotion, k: number) => {
    if (map[e]) add(map[e], k);
    else for (const [f, w] of EXPRESSION_FALLBACK[e] ?? []) if (map[f]) {
      add(map[f], k * w);
      break;
    }
  };
  if (s.emotion !== 'neutral') emo(s.emotion, s.strength);
  const talk = Math.max(0, 1 - 0.5 * s.strength);
  let mouthed = false;
  for (const v of VISEMES) {
    const k = (s.visemes?.[v] ?? 0) * talk;
    if (k > 0 && map[v]) {
      add(map[v], k);
      mouthed = true;
    }
  }
  if (!mouthed && s.visemes) {
    const open = Math.max(...VISEMES.map((v) => s.visemes![v] ?? 0)) * talk;
    if (map.jawOpen) add(map.jawOpen, open);
    else if (map.aa) add(map.aa, open);
  }
  if (s.jaw && map.jawOpen) add(map.jawOpen, s.jaw);
  if (s.blink) {
    if (map.blink) add(map.blink, s.blink);
    else {
      add(map.blinkLeft, s.blink);
      add(map.blinkRight, s.blink);
    }
  }
  return out;
}
