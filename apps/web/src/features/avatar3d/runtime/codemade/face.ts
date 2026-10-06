/**
 * The face of a code-made character: eyes, lashes, brows, mouth and blush drawn as thin patches
 * that hug the head, in the anime style. Each patch is an ellipse with a bend and a tilt; a morph
 * target is the same patch with other numbers (a blink flattens the eye onto the lid line), so
 * expressions and lip-sync work like any other model's.
 */
import type { AvatarRecipe, ExpressionMap } from '@everloom/engine';
import type { BodyPlan } from './body';
import { evalField, type Field, type V3 } from './sdf';
import { shade } from './outfit';

/** An ellipse on the face: centre, half sizes, bend (ends up +) and tilt (inner end up +). */
interface Ell {
  cx: number;
  cy: number;
  w: number;
  h: number;
  bend?: number;
  tilt?: number;
}

interface Feature {
  base: Ell;
  morphs: Partial<Record<string, Partial<Ell>>>;
  /** Colour at the top and bottom (a gradient for the iris). */
  color: [string, string];
  /** Side: +1 left (+X), −1 right, 0 middle (for tilt). */
  side: number;
  layer: number;
}

export const FACE_MORPHS = ['blink', 'blinkLeft', 'blinkRight', 'eyeSmile', 'eyeWide', 'aa', 'ih', 'ou', 'ee', 'oh', 'smile', 'frown', 'browAngry', 'browSad', 'browUp', 'blush'] as const;

export const FACE_EXPRESSIONS: ExpressionMap = {
  joy: [{ morph: 'smile', weight: 1 }, { morph: 'eyeSmile', weight: 0.45 }, { morph: 'browUp', weight: 0.3 }],
  amusement: [{ morph: 'smile', weight: 1 }, { morph: 'eyeSmile', weight: 1 }],
  love: [{ morph: 'smile', weight: 0.7 }, { morph: 'eyeSmile', weight: 0.35 }, { morph: 'blush', weight: 1 }],
  surprise: [{ morph: 'eyeWide', weight: 1 }, { morph: 'oh', weight: 0.6 }, { morph: 'browUp', weight: 1 }],
  sadness: [{ morph: 'browSad', weight: 1 }, { morph: 'frown', weight: 0.8 }],
  anger: [{ morph: 'browAngry', weight: 1 }, { morph: 'frown', weight: 0.6 }],
  fear: [{ morph: 'browSad', weight: 0.8 }, { morph: 'eyeWide', weight: 0.7 }, { morph: 'oh', weight: 0.3 }],
  embarrassment: [{ morph: 'blush', weight: 1 }, { morph: 'browSad', weight: 0.5 }, { morph: 'smile', weight: 0.3 }],
  confusion: [{ morph: 'browSad', weight: 0.4 }, { morph: 'browAngry', weight: 0.3 }, { morph: 'frown', weight: 0.3 }],
  curiosity: [{ morph: 'browUp', weight: 0.6 }, { morph: 'eyeWide', weight: 0.3 }, { morph: 'oh', weight: 0.2 }],
  disgust: [{ morph: 'browAngry', weight: 0.6 }, { morph: 'frown', weight: 0.8 }, { morph: 'ee', weight: 0.3 }],
  pride: [{ morph: 'smile', weight: 0.6 }, { morph: 'browUp', weight: 0.2 }, { morph: 'eyeSmile', weight: 0.2 }],
  relief: [{ morph: 'smile', weight: 0.5 }, { morph: 'eyeSmile', weight: 0.3 }],
  nervousness: [{ morph: 'browSad', weight: 0.6 }, { morph: 'ee', weight: 0.3 }],
  aa: [{ morph: 'aa', weight: 1 }],
  ih: [{ morph: 'ih', weight: 1 }],
  ou: [{ morph: 'ou', weight: 1 }],
  ee: [{ morph: 'ee', weight: 1 }],
  oh: [{ morph: 'oh', weight: 1 }],
  jawOpen: [{ morph: 'aa', weight: 1 }],
  blink: [{ morph: 'blink', weight: 1 }],
  blinkLeft: [{ morph: 'blinkLeft', weight: 1 }],
  blinkRight: [{ morph: 'blinkRight', weight: 1 }],
};

export interface FaceMesh {
  positions: Float32Array;
  normals: Float32Array;
  /** Texture coordinates into `palette` (one pair of texels per feature: top and bottom colour). */
  uvs: Float32Array;
  palette: Uint8Array;
  paletteWidth: number;
  indices: Uint32Array;
  morphs: Record<string, Float32Array>;
}

const RINGS = 4;
const SEG = 20;

function features(plan: BodyPlan, r: AvatarRecipe): Feature[] {
  const hh = plan.at.headH;
  const es = r.face.eyeSize;
  const eyeY = plan.at.chinY + hh * (plan.kid ? 0.36 : 0.42);
  const ex = hh * (plan.kid ? 0.165 : 0.17);
  const w = hh * 0.07 * (0.85 + 0.4 * es);
  const h = hh * 0.062 * (0.75 + 0.75 * es);
  const lid = -0.35 * h;
  const out: Feature[] = [];
  const lash = shade(r.hair.color, 0.45);
  const iris = r.face.eyes;
  for (const s of [1, -1]) {
    const cx = s * ex;
    const blinkKey = s > 0 ? 'blinkLeft' : 'blinkRight';
    const shut: Partial<Ell> = { cy: eyeY + lid, h: 0.02 * h, bend: 0.2 * h };
    const smiled: Partial<Ell> = { cy: eyeY + lid * 0.4, h: 0.02 * h, bend: -0.35 * h };
    const closes = (k = 1): Feature['morphs'] => ({ blink: shut, [blinkKey]: shut, eyeSmile: smiled, eyeWide: { h: h * 1.12 * k } });
    out.push({ base: { cx, cy: eyeY, w, h }, morphs: closes(), color: ['#fbf8f4', '#efe8e2'], side: s, layer: 0 });
    out.push({ base: { cx: cx - s * w * 0.04, cy: eyeY - h * 0.06, w: w * 0.62, h: h * 0.84 }, morphs: { ...closes(0.92), eyeWide: { w: w * 0.55, h: h * 0.75 } }, color: [shade(iris, 0.55), shade(iris, 1.35)], side: s, layer: 1 });
    out.push({ base: { cx: cx - s * w * 0.04, cy: eyeY - h * 0.08, w: w * 0.28, h: h * 0.38 }, morphs: { ...closes(0.5), eyeWide: { w: w * 0.22, h: h * 0.3 } }, color: [shade(iris, 0.25), shade(iris, 0.35)], side: s, layer: 2 });
    out.push({ base: { cx: cx + s * w * 0.18, cy: eyeY + h * 0.32, w: w * 0.15, h: h * 0.17 }, morphs: { blink: shut, [blinkKey]: shut, eyeSmile: smiled }, color: ['#ffffff', '#ffffff'], side: s, layer: 3 });
    // Upper lash: an arch above the eye; closed, a curve on the lid line.
    out.push({ base: { cx, cy: eyeY + h * 0.92, w: w * 1.08, h: h * 0.17, bend: -0.6 * h }, morphs: { blink: { cy: eyeY + lid, h: h * 0.12, bend: 0.22 * h }, [blinkKey]: { cy: eyeY + lid, h: h * 0.12, bend: 0.22 * h }, eyeSmile: { cy: eyeY + lid * 0.4, h: h * 0.14, bend: -0.4 * h }, eyeWide: { cy: eyeY + h * 1.05 } }, color: [lash, lash], side: s, layer: 4 });
    // Brows.
    const by = eyeY + h + hh * 0.07;
    out.push({ base: { cx: cx - s * w * 0.05, cy: by, w: w * 0.95, h: hh * 0.011, bend: -hh * 0.012 }, morphs: { browAngry: { tilt: -hh * 0.035, cy: by - hh * 0.012 }, browSad: { tilt: hh * 0.03, bend: 0 }, browUp: { cy: by + hh * 0.03 }, eyeWide: { cy: by + hh * 0.02 } }, color: [r.face.brows ?? shade(r.hair.color, 0.8), r.face.brows ?? shade(r.hair.color, 0.8)], side: s, layer: 0 });
    // Blush (hidden unless the recipe or a feeling shows it).
    const bh = r.face.blush ? hh * 0.022 : 0.0001;
    out.push({ base: { cx: s * hh * 0.21, cy: eyeY - hh * 0.11, w: hh * 0.055, h: bh }, morphs: { blush: { h: hh * 0.03, w: hh * 0.065 } }, color: ['#f2a0a0', '#f2a0a0'], side: 0, layer: 0 });
  }
  // Mouth.
  const my = plan.at.chinY + hh * 0.16;
  const mw = hh * 0.05;
  out.push({
    base: { cx: 0, cy: my, w: mw, h: hh * 0.007, bend: hh * 0.006 },
    morphs: {
      aa: { h: hh * 0.045, w: mw * 0.85, cy: my - hh * 0.02, bend: 0 },
      ih: { h: hh * 0.016, w: mw * 1.1, cy: my - hh * 0.004 },
      ou: { h: hh * 0.024, w: mw * 0.5, cy: my - hh * 0.008, bend: 0 },
      ee: { h: hh * 0.014, w: mw * 1.2, bend: hh * 0.01 },
      oh: { h: hh * 0.035, w: mw * 0.65, cy: my - hh * 0.015, bend: 0 },
      smile: { w: mw * 1.25, h: hh * 0.011, bend: hh * 0.03, cy: my - hh * 0.006 },
      frown: { w: mw * 0.9, bend: -hh * 0.02, cy: my + hh * 0.006 },
    },
    color: ['#7a3036', '#a8484c'],
    side: 0,
    layer: 0,
  });
  return out;
}

/** Point (u, v) of the unit disc placed on an ellipse. */
function place(e: Required<Ell>, side: number, u: number, v: number): [number, number] {
  const inner = -side * u;
  return [e.cx + u * e.w, e.cy + v * e.h + e.bend * u * u + e.tilt * inner];
}

export function buildFace(plan: BodyPlan, r: AvatarRecipe): FaceMesh {
  const head: Field = { shapes: plan.shapes.filter((s) => s.bone === 'head'), blend: plan.blend };
  const { H } = plan;
  const hz = plan.at.headC[2];
  const front = hz + plan.at.headR[2] * 1.3;
  /** The head's surface in front of (x, y), and its normal. */
  const surface = (x: number, y: number): [V3, V3] => {
    let a = front;
    let b = hz;
    if (evalField(head, x, y, b) > 0) b = hz - plan.at.headR[2];
    for (let i = 0; i < 24; i++) {
      const m = (a + b) / 2;
      if (evalField(head, x, y, m) > 0) a = m;
      else b = m;
    }
    const z = (a + b) / 2;
    const e = 0.001 * H;
    const gx = evalField(head, x + e, y, z) - evalField(head, x - e, y, z);
    const gy = evalField(head, x, y + e, z) - evalField(head, x, y - e, z);
    const gz = evalField(head, x, y, z + e) - evalField(head, x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [
      [x, y, z],
      [gx / l, gy / l, gz / l],
    ];
  };
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const pal: number[] = [];
  const idx: number[] = [];
  const morphs: Record<string, number[]> = Object.fromEntries(FACE_MORPHS.map((m) => [m, []]));
  const disc: Array<[number, number]> = [[0, 0]];
  for (let ring = 1; ring <= RINGS; ring++)
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      disc.push([Math.cos(a) * (ring / RINGS), Math.sin(a) * (ring / RINGS)]);
    }
  const full = (e: Ell): Required<Ell> => ({ bend: 0, tilt: 0, ...e });
  const lift = (layer: number) => 0.0012 * H + layer * 0.0008 * H;
  const list = features(plan, r);
  const width = list.length * 2;
  list.forEach((f, fi) => {
    const start = pos.length / 3;
    const base = full(f.base);
    pal.push(...hexBytes(f.color[0]), 255, ...hexBytes(f.color[1]), 255);
    // Texel centres of this feature's two colours; linear filtering blends between them.
    const u0 = (fi * 2 + 0.5) / width;
    const u1 = (fi * 2 + 1.5) / width;
    const at = (e: Required<Ell>, u: number, v: number): V3 => {
      const [x, y] = place(e, f.side, u, v);
      const [p, n] = surface(x, y);
      const l = lift(f.layer);
      return [p[0] + n[0] * l, p[1] + n[1] * l, p[2] + n[2] * l];
    };
    for (const [u, v] of disc) {
      const p = at(base, u, v);
      const [, n] = surface(p[0], p[1]);
      pos.push(...p);
      nrm.push(...n);
      uv.push(u0 + (u1 - u0) * ((1 - v) / 2), 0.5);
      for (const m of FACE_MORPHS) {
        const ch = f.morphs[m];
        if (!ch) {
          morphs[m]!.push(0, 0, 0);
          continue;
        }
        const q = at(full({ ...base, ...ch }), u, v);
        morphs[m]!.push(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
      }
    }
    // Centre fan, then rings of quads (facing +Z).
    for (let s = 0; s < SEG; s++) idx.push(start, start + 1 + s, start + 1 + ((s + 1) % SEG));
    for (let ring = 1; ring < RINGS; ring++)
      for (let s = 0; s < SEG; s++) {
        const a = start + 1 + (ring - 1) * SEG + s;
        const b = start + 1 + (ring - 1) * SEG + ((s + 1) % SEG);
        const c = a + SEG;
        const d = b + SEG;
        idx.push(a, c, d, a, d, b);
      }
  });
  return {
    positions: Float32Array.from(pos),
    normals: Float32Array.from(nrm),
    uvs: Float32Array.from(uv),
    palette: Uint8Array.from(pal),
    paletteWidth: width,
    indices: Uint32Array.from(idx),
    morphs: Object.fromEntries(Object.entries(morphs).map(([k, v]) => [k, Float32Array.from(v)])),
  };
}

function hexBytes(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
