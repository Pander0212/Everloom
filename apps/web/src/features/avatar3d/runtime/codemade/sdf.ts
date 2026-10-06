/**
 * Signed distance shapes for code-made characters: rounded cones (limbs), ellipsoids (head, chest),
 * rounded boxes (feet, capes), combined with a smooth union so joints blend like flesh. Each shape
 * names the bone that moves it; skin weights come from the same shapes.
 */
export type V3 = [number, number, number];

export interface Shape {
  /** Distance from p (negative inside). */
  d(x: number, y: number, z: number): number;
  bone: string;
  /** Axis-aligned bounds [min, max] (for skipping far shapes). */
  box: [V3, V3];
}

const len = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

/** A capsule whose radius changes from a to b (iq's round cone). */
export function roundCone(a: V3, b: V3, ra: number, rb: number, bone: string): Shape {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pad = Math.max(ra, rb);
  return {
    bone,
    box: [
      [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.min(a[2], b[2]) - pad],
      [Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad, Math.max(a[2], b[2]) + pad],
    ],
    d(px, py, pz) {
      const pax = px - a[0];
      const pay = py - a[1];
      const paz = pz - a[2];
      const y = pax * bax + pay * bay + paz * baz;
      const z = y - l2;
      const xx = len(pax * l2 - bax * y, pay * l2 - bay * y, paz * l2 - baz * y);
      const x2 = xx * xx;
      const y2 = y * y * l2;
      const z2 = z * z * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
      if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
      return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - ra;
    },
  };
}

/** An ellipsoid (approximate distance, good near the surface). */
export function ellipsoid(c: V3, r: V3, bone: string): Shape {
  return {
    bone,
    box: [
      [c[0] - r[0], c[1] - r[1], c[2] - r[2]],
      [c[0] + r[0], c[1] + r[1], c[2] + r[2]],
    ],
    d(px, py, pz) {
      const x = (px - c[0]) / r[0];
      const y = (py - c[1]) / r[1];
      const z = (pz - c[2]) / r[2];
      const k0 = len(x, y, z);
      const k1 = len(x / r[0], y / r[1], z / r[2]);
      return k1 === 0 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
    },
  };
}

/** A box with rounded edges. */
export function roundBox(c: V3, half: V3, round: number, bone: string): Shape {
  return {
    bone,
    box: [
      [c[0] - half[0] - round, c[1] - half[1] - round, c[2] - half[2] - round],
      [c[0] + half[0] + round, c[1] + half[1] + round, c[2] + half[2] + round],
    ],
    d(px, py, pz) {
      const qx = Math.abs(px - c[0]) - half[0];
      const qy = Math.abs(py - c[1]) - half[1];
      const qz = Math.abs(pz - c[2]) - half[2];
      return len(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - round;
    },
  };
}

/** Polynomial smooth minimum (k = blend width in metres). */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** A field: shapes blended together, then optionally cut and offset. */
export interface Field {
  shapes: Shape[];
  /** Blend width between shapes. */
  blend: number;
  /** Grow (+) or shrink (−) the whole surface (clothes sit just outside the body). */
  offset?: number;
  /** Extra limits: the field is kept only where every clip is negative (planes, regions). */
  clips?: Array<(x: number, y: number, z: number) => number>;
  /** Shapes subtracted (smoothly) from the result (a hood's opening, a sleeve's end). */
  minus?: Shape[];
  /** Rounds the edges the clips cut (metres; 0 = sharp). */
  clipRound?: number;
}

export function evalField(f: Field, x: number, y: number, z: number): number {
  let d = Infinity;
  for (const s of f.shapes) {
    // Far from this shape's box: it can't matter for the blend.
    const b = s.box;
    const ox = Math.max(b[0][0] - x, 0, x - b[1][0]);
    const oy = Math.max(b[0][1] - y, 0, y - b[1][1]);
    const oz = Math.max(b[0][2] - z, 0, z - b[1][2]);
    const far = len(ox, oy, oz);
    if (far > d + f.blend) continue;
    d = d === Infinity ? s.d(x, y, z) : smin(d, s.d(x, y, z), f.blend);
  }
  if (f.offset) d -= f.offset;
  if (f.minus) for (const m of f.minus) d = Math.max(d, -m.d(x, y, z));
  if (f.clips) {
    const k = f.clipRound ?? 0;
    for (const c of f.clips) d = k > 0 ? -smin(-d, -c(x, y, z), k) : Math.max(d, c(x, y, z));
  }
  return d;
}

/** Bounds of a field's shapes (grown by its offset and a margin). */
export function fieldBox(f: Field, margin: number): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const s of f.shapes)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, s.box[0][i]!);
      hi[i] = Math.max(hi[i]!, s.box[1][i]!);
    }
  const m = margin + (f.offset ?? 0);
  return [lo.map((v) => v - m) as V3, hi.map((v) => v + m) as V3];
}

/** A ring around an axis through c (axis 'y': a headband; 'z': glasses frames). */
export function torus(c: V3, major: number, minor: number, axis: 'x' | 'y' | 'z', bone: string): Shape {
  const r = major + minor;
  const ext: V3 = axis === 'x' ? [minor, r, r] : axis === 'y' ? [r, minor, r] : [r, r, minor];
  return {
    bone,
    box: [
      [c[0] - ext[0], c[1] - ext[1], c[2] - ext[2]],
      [c[0] + ext[0], c[1] + ext[1], c[2] + ext[2]],
    ],
    d(px, py, pz) {
      const x = px - c[0];
      const y = py - c[1];
      const z = pz - c[2];
      const [a, b, h] = axis === 'x' ? [y, z, x] : axis === 'y' ? [x, z, y] : [x, y, z];
      const q = Math.hypot(a, b) - major;
      return Math.hypot(q, h) - minor;
    },
  };
}

/** A shape scaled along one axis about a centre (a flared skirt that is oval, not round). */
export function scaled(s: Shape, c: V3, k: V3): Shape {
  const m = Math.min(...k);
  return {
    bone: s.bone,
    box: [
      [c[0] + (s.box[0][0] - c[0]) * k[0], c[1] + (s.box[0][1] - c[1]) * k[1], c[2] + (s.box[0][2] - c[2]) * k[2]],
      [c[0] + (s.box[1][0] - c[0]) * k[0], c[1] + (s.box[1][1] - c[1]) * k[1], c[2] + (s.box[1][2] - c[2]) * k[2]],
    ],
    d: (x, y, z) => s.d(c[0] + (x - c[0]) / k[0], c[1] + (y - c[1]) / k[1], c[2] + (z - c[2]) / k[2]) * m,
  };
}

/** The same shape moved by another bone (a garment piece that follows a different bone). */
export function rebone(s: Shape, bone: string): Shape {
  return { ...s, bone };
}
