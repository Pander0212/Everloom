/**
 * Unity animation clips (.anim) and animator controllers (.controller).
 *
 * A clip holds curves per object path: blendshape weights (`blendShape.<name>` on a renderer),
 * transform curves (position, rotation as quaternions or Euler angles, scale) and, for humanoid
 * clips, muscle curves on the Animator. Face clips (only blendshapes) become expressions; transform
 * clips on bones become Everloom clips through the usual retargeting; muscle clips need Unity's
 * muscle space and are imported as "needs retarget".
 */
import { asList, asMap, asNum, asRef, asStr, parseUnityYaml, type UnityRef, type YamlMap } from './yaml';
import { EMOTIONS, type Emotion } from '../game/emotion.js';

export interface Key<T> {
  t: number;
  v: T;
}
export interface UnityAnim {
  name: string;
  sampleRate: number;
  loop: boolean;
  length: number;
  blendShapes: { path: string; name: string; keys: Key<number>[] }[];
  rotations: { path: string; keys: Key<[number, number, number, number]>[] }[];
  eulers: { path: string; keys: Key<[number, number, number]>[] }[];
  positions: { path: string; keys: Key<[number, number, number]>[] }[];
  scales: { path: string; keys: Key<[number, number, number]>[] }[];
  /** Humanoid muscle curves (Animator, class 95): present means the clip needs Unity's muscle space. */
  muscles: number;
  /** Other float curves (material properties, toggles), counted for the report. */
  other: number;
}

export type AnimKind = 'face' | 'body' | 'humanoid' | 'toggle' | 'empty';

function keys<T>(curve: YamlMap, read: (v: unknown) => T): Key<T>[] {
  return asList(asMap(curve.curve).m_Curve)
    .map(asMap)
    .map((k) => ({ t: asNum(k.time), v: read(k.value) }));
}
const v3 = (v: unknown): [number, number, number] => {
  const m = asMap(v as never);
  return [asNum(m.x), asNum(m.y), asNum(m.z)];
};
const q4 = (v: unknown): [number, number, number, number] => {
  const m = asMap(v as never);
  return [asNum(m.x), asNum(m.y), asNum(m.z), asNum(m.w, 1)];
};

export function readAnim(text: string): UnityAnim | null {
  const doc = parseUnityYaml(text).find((d) => d.classId === 74 || d.type === 'AnimationClip');
  if (!doc) return null;
  const b = doc.body;
  const a: UnityAnim = { name: asStr(b.m_Name) || 'Clip', sampleRate: asNum(b.m_SampleRate, 60), loop: asNum(asMap(b.m_AnimationClipSettings).m_LoopTime) !== 0, length: 0, blendShapes: [], rotations: [], eulers: [], positions: [], scales: [], muscles: 0, other: 0 };
  for (const c of asList(b.m_FloatCurves).map(asMap)) {
    const attr = asStr(c.attribute);
    const cls = asNum(c.classID);
    if (attr.startsWith('blendShape.')) a.blendShapes.push({ path: asStr(c.path), name: attr.slice('blendShape.'.length), keys: keys(c, (v) => asNum(v as never)) });
    else if (cls === 95) a.muscles++;
    else a.other++;
  }
  for (const c of asList(b.m_RotationCurves).map(asMap)) a.rotations.push({ path: asStr(c.path), keys: keys(c, q4) });
  for (const c of asList(b.m_EulerCurves).map(asMap)) a.eulers.push({ path: asStr(c.path), keys: keys(c, v3) });
  for (const c of asList(b.m_PositionCurves).map(asMap)) a.positions.push({ path: asStr(c.path), keys: keys(c, v3) });
  for (const c of asList(b.m_ScaleCurves).map(asMap)) a.scales.push({ path: asStr(c.path), keys: keys(c, v3) });
  const all = [...a.blendShapes, ...a.rotations, ...a.eulers, ...a.positions, ...a.scales].flatMap((c) => c.keys.map((k) => k.t));
  const stop = asNum(asMap(b.m_AnimationClipSettings).m_StopTime, 0);
  a.length = Math.max(stop, ...all, 0);
  if (asList(b.m_PPtrCurves).length) a.other++;
  return a;
}

export function animKind(a: UnityAnim): AnimKind {
  if (a.muscles) return 'humanoid';
  if (a.rotations.length || a.eulers.length || a.positions.length > 1) return 'body';
  if (a.blendShapes.length) return 'face';
  if (a.other || a.scales.length || a.positions.length) return 'toggle';
  return 'empty';
}

/** The blendshape weights a face clip ends on (0–1), by mesh path. */
export function faceWeights(a: UnityAnim): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of a.blendShapes) {
    const last = c.keys.at(-1)?.v ?? 0;
    if (last > 0.5) out[c.name] = Math.min(1, last / 100);
  }
  return out;
}

/** Names that say which emotion a face clip shows ("Smile", "怒り", "Face_Sad"…). */
const EMOTION_WORDS: Partial<Record<Emotion, RegExp>> = {
  joy: /smile|happy|joy|grin|にこ|笑|喜|スマイル/i,
  amusement: /laugh|fun|lol|楽/i,
  anger: /angry|anger|mad|rage|怒|むか/i,
  sadness: /sad|cry|sorrow|tear|悲|泣|哀/i,
  surprise: /surprise|shock|wow|驚|びっくり/i,
  embarrassment: /shy|blush|embarrass|照|赤面/i,
  fear: /fear|scared|afraid|怖|恐/i,
  disgust: /disgust|ew|嫌/i,
  confusion: /confus|\?|困|はてな/i,
  love: /love|heart|ハート|恋/i,
  pride: /proud|smug|doya|ドヤ/i,
  neutral: /neutral|default|normal|通常|無表情/i,
};

export function emotionOf(name: string): Emotion | null {
  for (const e of EMOTIONS) {
    const re = EMOTION_WORDS[e];
    if (re?.test(name)) return e;
  }
  return null;
}

// ------------------------------------------------------------------ animator controllers

export interface ControllerState {
  name: string;
  layer: string;
  motion: UnityRef | null;
}

/** A controller's states (as emotes and gestures), with the clip each one plays. */
export function readController(text: string): ControllerState[] {
  const docs = parseUnityYaml(text);
  const byId = new Map(docs.map((d) => [d.fileId, d]));
  const out: ControllerState[] = [];
  const ctrl = docs.find((d) => d.classId === 91);
  const layers = asList(ctrl?.body.m_AnimatorLayers).map(asMap);
  for (const l of layers) {
    const smId = asRef(l.m_StateMachine)?.fileID;
    const sm = smId ? byId.get(smId) : undefined;
    if (!sm) continue;
    const visit = (machine: typeof sm, depth: number) => {
      if (depth > 8) return;
      for (const s of asList(machine.body.m_ChildStates).map(asMap)) {
        const st = byId.get(asRef(s.m_State)?.fileID ?? '');
        if (!st) continue;
        out.push({ name: asStr(st.body.m_Name), layer: asStr(l.m_Name), motion: asRef(st.body.m_Motion) });
      }
      for (const s of asList(machine.body.m_ChildStateMachines).map(asMap)) {
        const sub = byId.get(asRef(s.m_StateMachine)?.fileID ?? '');
        if (sub) visit(sub, depth + 1);
      }
    };
    visit(sm, 0);
  }
  return out;
}
