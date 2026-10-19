/**
 * A procedural test figure: an adult mannequin (front view, A-pose) with simple clothes, drawn from
 * capsules and ellipses. It needs no generated art, so the lab, the tests and the evidence clips can
 * run anywhere; real characters come from the art pipeline (docs/puppets-v2/pipeline.md).
 */
import type { CharacterInput } from './build.js';
import type { Keypoints } from './skeleton.js';

type P = [number, number];
export type FigureShape =
  | { type: 'capsule'; pts: P[]; w: number | number[]; color: string }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; color: string };
export interface TestFigure { input: CharacterInput; paint: Record<string, FigureShape[]> }

const SKIN = '#f0c6ad', SKIN2 = '#e4b398', HAIR = '#5b3a29', TOP = '#4f7cac', SHORTS = '#2f3e55', SHOE = '#3b2f2f', EYE = '#2b2b2b';

export const TEST_KEYPOINTS: Keypoints = {
  view: 'front', headTop: [200, 90], neck: [200, 210], chest: [200, 300], pelvis: [200, 430],
  shoulder_L: [258, 268], elbow_L: [297, 376], wrist_L: [333, 475], hip_L: [234, 440], knee_L: [240, 605], ankle_L: [244, 765],
  shoulder_R: [142, 268], elbow_R: [103, 376], wrist_R: [67, 475], hip_R: [166, 440], knee_R: [160, 605], ankle_R: [156, 765],
  breast_L: [226, 300], breast_R: [174, 300], butt_L: [222, 452], butt_R: [178, 452],
};

/** The same figure in profile, facing screen left (near side = the character's left). */
export const TEST_KEYPOINTS_SIDE: Keypoints = {
  view: 'side', headTop: [200, 90], neck: [204, 210], chest: [200, 300], pelvis: [204, 430],
  shoulder_L: [206, 268], elbow_L: [210, 376], wrist_L: [204, 475], hip_L: [206, 440], knee_L: [200, 605], ankle_L: [208, 765],
  shoulder_R: [206, 268], elbow_R: [210, 376], wrist_R: [204, 475], hip_R: [206, 440], knee_R: [200, 605], ankle_R: [208, 765],
  breast_L: [178, 302], breast_R: [178, 302], butt_L: [232, 456], butt_R: [232, 456],
};

/** The figure, optionally with longer legs or a different build (for retargeting demos). */
export function testFigure(o: { legScale?: number; clothes?: boolean; view?: 'front' | 'side' } = {}): TestFigure {
  if (o.view === 'side') return sideFigure(o);
  const ls = o.legScale ?? 1;
  const leg = (p: P): P => (p[1] > 430 ? [p[0], 430 + (p[1] - 430) * ls] : p);
  const kp = Object.fromEntries(Object.entries(TEST_KEYPOINTS).map(([k, v]) => [k, Array.isArray(v) ? leg(v as P) : v])) as Keypoints;
  const H = Math.ceil(kp.ankle_L[1] + 40);
  const paint: Record<string, FigureShape[]> = {};
  const layers: CharacterInput['layers'] = [];
  const add = (id: string, role: string, shapes: FigureShape[], pad = 4, extra: Partial<CharacterInput['layers'][number]> = {}) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of shapes) {
      if (s.type === 'ellipse') { x0 = Math.min(x0, s.cx - s.rx); x1 = Math.max(x1, s.cx + s.rx); y0 = Math.min(y0, s.cy - s.ry); y1 = Math.max(y1, s.cy + s.ry); }
      else { const w = Math.max(...[s.w].flat()) / 2; for (const p of s.pts) { x0 = Math.min(x0, p[0] - w); x1 = Math.max(x1, p[0] + w); y0 = Math.min(y0, p[1] - w); y1 = Math.max(y1, p[1] + w); } }
    }
    paint[id] = shapes;
    layers.push({ id, role: role as never, texture: id, rect: [Math.floor(x0 - pad), Math.floor(y0 - pad), Math.ceil(x1 - x0 + 2 * pad), Math.ceil(y1 - y0 + 2 * pad)], ...extra });
  };
  for (const s of ['R', 'L'] as const) {
    const hip = kp[`hip_${s}`], knee = kp[`knee_${s}`], ank = kp[`ankle_${s}`], dir = s === 'L' ? 1 : -1;
    add(`leg${s}`, `leg_${s}`, [{ type: 'capsule', pts: [[hip[0] - dir * 4, hip[1] - 10] as P, knee, ank], w: [58, 40, 30], color: SKIN2 }]);
    add(`foot${s}`, `foot_${s}`, [{ type: 'ellipse', cx: ank[0] + dir * 6, cy: ank[1] + 14, rx: 22, ry: 13, color: SHOE }]);
  }
  add('torso', 'torso', [{ type: 'capsule', pts: [[200, 250], [200, 330], [200, 440]], w: [104, 84, 108], color: SKIN }]);
  add('neck', 'neck', [{ type: 'capsule', pts: [[200, 190], [200, 250]], w: 34, color: SKIN2 }]);
  for (const s of ['R', 'L'] as const) add(`breast${s}`, `breast_${s}`, [{ type: 'ellipse', cx: kp[`breast_${s}`]![0], cy: kp[`breast_${s}`]![1] + 4, rx: 26, ry: 22, color: SKIN }]);
  add('hairBack', 'hair_back', [{ type: 'ellipse', cx: 200, cy: 165, rx: 60, ry: 80, color: HAIR }]);
  add('head', 'head', [{ type: 'ellipse', cx: 200, cy: 150, rx: 46, ry: 58, color: SKIN }]);
  add('face', 'face', [{ type: 'ellipse', cx: 183, cy: 150, rx: 5, ry: 7, color: EYE }, { type: 'ellipse', cx: 217, cy: 150, rx: 5, ry: 7, color: EYE }, { type: 'capsule', pts: [[190, 182], [210, 182]], w: 4, color: '#b5665a' }]);
  add('hairFront', 'hair_front', [{ type: 'capsule', pts: [[160, 118], [200, 96], [240, 118]], w: 30, color: HAIR }]);
  if (o.clothes !== false) {
    add('top', 'topwear', [{ type: 'capsule', pts: [[200, 262], [200, 330], [200, 400]], w: [112, 92, 100], color: TOP }], 4, { outfit: 'casual' });
    add('shorts', 'bottomwear', [{ type: 'capsule', pts: [[200, 420], [200, 470]], w: [112, 124], color: SHORTS }], 4, { outfit: 'casual' });
  }
  for (const s of ['R', 'L'] as const) {
    const sh = kp[`shoulder_${s}`], el = kp[`elbow_${s}`], wr = kp[`wrist_${s}`];
    add(`arm${s}`, `arm_${s}`, [{ type: 'capsule', pts: [sh, el, wr], w: [36, 28, 24], color: SKIN }]);
    const d = [wr[0] - el[0], wr[1] - el[1]], n = Math.hypot(d[0]!, d[1]!);
    add(`hand${s}`, `hand_${s}`, [{ type: 'ellipse', cx: wr[0] + (d[0]! / n) * 22, cy: wr[1] + (d[1]! / n) * 22, rx: 15, ry: 20, color: SKIN2 }]);
  }
  return { input: { name: 'Test figure', width: 400, height: H, keypoints: kp, layers, textures: layers.map((l) => ({ id: l.texture, path: `${l.texture}.png`, width: l.rect[2], height: l.rect[3] })) }, paint };
}

function sideFigure(o: { legScale?: number; clothes?: boolean }): TestFigure {
  const ls = o.legScale ?? 1;
  const leg = (p: P): P => (p[1] > 430 ? [p[0], 430 + (p[1] - 430) * ls] : p);
  const kp = Object.fromEntries(Object.entries(TEST_KEYPOINTS_SIDE).map(([k, v]) => [k, Array.isArray(v) ? leg(v as P) : v])) as Keypoints;
  const H = Math.ceil(kp.ankle_L[1] + 40);
  const paint: Record<string, FigureShape[]> = {};
  const layers: CharacterInput['layers'] = [];
  const add = (id: string, role: string, shapes: FigureShape[], z?: number, extra: Partial<CharacterInput['layers'][number]> = {}) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of shapes) {
      if (s.type === 'ellipse') { x0 = Math.min(x0, s.cx - s.rx); x1 = Math.max(x1, s.cx + s.rx); y0 = Math.min(y0, s.cy - s.ry); y1 = Math.max(y1, s.cy + s.ry); }
      else { const w = Math.max(...[s.w].flat()) / 2; for (const p of s.pts) { x0 = Math.min(x0, p[0] - w); x1 = Math.max(x1, p[0] + w); y0 = Math.min(y0, p[1] - w); y1 = Math.max(y1, p[1] + w); } }
    }
    paint[id] = shapes;
    layers.push({ id, role: role as never, texture: id, rect: [Math.floor(x0 - 4), Math.floor(y0 - 4), Math.ceil(x1 - x0 + 8), Math.ceil(y1 - y0 + 8)], ...(z === undefined ? {} : { z }), ...extra });
  };
  // Far limbs (the character's right) are a shade darker and drawn behind the body.
  for (const [s, col, z] of [['R', '#d9a78c', 4], ['L', SKIN2, 10]] as const) {
    add(`leg${s}`, `leg_${s}`, [{ type: 'capsule', pts: [[kp[`hip_${s}`][0], kp[`hip_${s}`][1] - 10], kp[`knee_${s}`], kp[`ankle_${s}`]], w: [56, 38, 28], color: col }], z);
    add(`foot${s}`, `foot_${s}`, [{ type: 'ellipse', cx: kp[`ankle_${s}`][0] - 16, cy: kp[`ankle_${s}`][1] + 12, rx: 26, ry: 11, color: SHOE }], z + 1);
  }
  add('armR', 'arm_R', [{ type: 'capsule', pts: [kp.shoulder_R, kp.elbow_R, kp.wrist_R], w: [32, 26, 22], color: '#d9a78c' }], 3);
  add('handR', 'hand_R', [{ type: 'ellipse', cx: kp.wrist_R[0] - 2, cy: kp.wrist_R[1] + 20, rx: 11, ry: 18, color: '#d9a78c' }], 3);
  add('torso', 'torso', [{ type: 'capsule', pts: [[204, 250], [200, 330], [208, 440]], w: [70, 62, 84], color: SKIN }]);
  add('butt', 'butt_L', [{ type: 'ellipse', cx: kp.butt_L![0], cy: kp.butt_L![1], rx: 26, ry: 30, color: SKIN }], 12);
  add('breast', 'breast_L', [{ type: 'ellipse', cx: kp.breast_L![0] + 6, cy: kp.breast_L![1] + 4, rx: 18, ry: 22, color: SKIN }]);
  add('neck', 'neck', [{ type: 'capsule', pts: [[204, 190], [204, 250]], w: 30, color: SKIN2 }]);
  add('head', 'head', [{ type: 'ellipse', cx: 196, cy: 150, rx: 44, ry: 58, color: SKIN }]);
  add('face', 'face', [{ type: 'ellipse', cx: 168, cy: 148, rx: 4, ry: 7, color: EYE }, { type: 'capsule', pts: [[160, 182], [170, 182]], w: 4, color: '#b5665a' }]);
  add('hair', 'hair_front', [{ type: 'capsule', pts: [[170, 104], [212, 100], [236, 140], [238, 200]], w: [30, 40, 36, 24], color: HAIR }]);
  if (o.clothes !== false) {
    add('top', 'topwear', [{ type: 'capsule', pts: [[204, 262], [200, 330], [206, 400]], w: [76, 70, 82], color: TOP }], undefined, { outfit: 'casual' });
    add('shorts', 'bottomwear', [{ type: 'capsule', pts: [[206, 420], [208, 470]], w: [88, 96], color: SHORTS }], undefined, { outfit: 'casual' });
  }
  add('armL', 'arm_L', [{ type: 'capsule', pts: [kp.shoulder_L, kp.elbow_L, kp.wrist_L], w: [34, 28, 24], color: SKIN }]);
  add('handL', 'hand_L', [{ type: 'ellipse', cx: kp.wrist_L[0] - 2, cy: kp.wrist_L[1] + 20, rx: 12, ry: 19, color: SKIN2 }]);
  return { input: { name: 'Test figure (side)', width: 400, height: H, keypoints: kp, layers, textures: layers.map((l) => ({ id: l.texture, path: `${l.texture}.png`, width: l.rect[2], height: l.rect[3] })) }, paint };
}
