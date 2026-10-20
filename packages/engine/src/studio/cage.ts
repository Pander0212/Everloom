/**
 * 2D cage deformation for the body sliders, implemented from the published method:
 * mean-value coordinates (M. S. Floater, "Mean value coordinates", CAGD 2003; K. Hormann and
 * M. S. Floater, "Mean value coordinates for arbitrary planar polygons", ACM TOG 2006).
 *
 * A point inside a cage polygon is a weighted average of the cage's vertices; moving the vertices
 * (a slider between its min and max polygon) moves the point smoothly. Outside the cage, within a
 * margin, the displacement of the nearest boundary point fades to zero, so the deformed region
 * joins the untouched picture without a tear. Several cages add their displacements.
 */
import type { Cage } from './template.js';

export type P = [number, number];

/** Mean-value weights of x with respect to polygon v (Hormann–Floater form, handles concave polygons). */
export function meanValueWeights(x: P, v: P[]): number[] {
  const n = v.length;
  const s = v.map((p) => [p[0] - x[0], p[1] - x[1]] as P);
  const r = s.map((d) => Math.hypot(d[0], d[1]));
  const w = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    // On a vertex: that vertex alone.
    if (r[i]! < 1e-9) { w.fill(0); w[i] = 1; return w; }
  }
  const A = new Array<number>(n), D = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    A[i] = (s[i]![0] * s[j]![1] - s[i]![1] * s[j]![0]) / 2;
    D[i] = s[i]![0] * s[j]![0] + s[i]![1] * s[j]![1];
    // On an edge: linear between its two vertices.
    if (Math.abs(A[i]!) < 1e-9 && D[i]! < 0) {
      w.fill(0);
      w[i] = r[j]! / (r[i]! + r[j]!);
      w[j] = r[i]! / (r[i]! + r[j]!);
      return w;
    }
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n, next = (i + 1) % n;
    let wi = 0;
    if (Math.abs(A[prev]!) > 1e-12) wi += (r[prev]! - D[prev]! / r[i]!) / A[prev]!;
    if (Math.abs(A[i]!) > 1e-12) wi += (r[next]! - D[i]! / r[i]!) / A[i]!;
    w[i] = wi;
    sum += wi;
  }
  return w.map((x) => x / sum);
}

/** Whether a point lies inside a polygon (even–odd rule). */
export function inside(x: P, v: P[]): boolean {
  let c = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const a = v[i]!, b = v[j]!;
    if ((a[1] > x[1]) !== (b[1] > x[1]) && x[0] < ((b[0] - a[0]) * (x[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** The cage's vertices for a slider value t in −1…1 (between rest and min, or rest and max). */
export function cageAt(c: Pick<Cage, 'rest' | 'min' | 'max'>, t: number): P[] {
  const to = t < 0 ? c.min : c.max, k = Math.min(1, Math.abs(t));
  return c.rest.map((p, i) => [p[0] + (to[i]![0] - p[0]) * k, p[1] + (to[i]![1] - p[1]) * k] as P);
}

function nearestOnPolygon(x: P, v: P[]): { point: P; edge: number; t: number; dist: number } {
  let best = { point: v[0]!, edge: 0, t: 0, dist: Infinity };
  for (let i = 0; i < v.length; i++) {
    const a = v[i]!, b = v[(i + 1) % v.length]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x[0] - a[0]) * dx + (x[1] - a[1]) * dy) / L2));
    const p: P = [a[0] + dx * t, a[1] + dy * t];
    const d = Math.hypot(x[0] - p[0], x[1] - p[1]);
    if (d < best.dist) best = { point: p, edge: i, t, dist: d };
  }
  return best;
}

/** Displacement of one point by one cage at slider t. */
export function cageDisplacement(x: P, c: Pick<Cage, 'rest' | 'min' | 'max' | 'margin'>, t: number): P {
  if (Math.abs(t) < 1e-6) return [0, 0];
  const moved = cageAt(c, t);
  const disp = moved.map((p, i) => [p[0] - c.rest[i]![0], p[1] - c.rest[i]![1]] as P);
  if (inside(x, c.rest)) {
    const w = meanValueWeights(x, c.rest);
    let dx = 0, dy = 0;
    for (let i = 0; i < w.length; i++) { dx += w[i]! * disp[i]![0]; dy += w[i]! * disp[i]![1]; }
    return [dx, dy];
  }
  const near = nearestOnPolygon(x, c.rest);
  if (near.dist >= c.margin) return [0, 0];
  const a = disp[near.edge]!, b = disp[(near.edge + 1) % disp.length]!;
  // Smoothstep falloff from the boundary's displacement to zero at the margin.
  const f = 1 - near.dist / c.margin, s = f * f * (3 - 2 * f);
  return [(a[0] + (b[0] - a[0]) * near.t) * s, (a[1] + (b[1] - a[1]) * near.t) * s];
}

/** Deforms points (x,y pairs) in place by every cage at its slider value. */
export function deformPoints(points: Float32Array, cages: Array<Pick<Cage, 'rest' | 'min' | 'max' | 'margin' | 'slider'>>, sliders: Partial<Record<string, number>>): void {
  for (let i = 0; i < points.length; i += 2) {
    const x: P = [points[i]!, points[i + 1]!];
    let dx = 0, dy = 0;
    for (const c of cages) {
      const d = cageDisplacement(x, c, sliders[c.slider] ?? 0);
      dx += d[0]; dy += d[1];
    }
    points[i] = x[0] + dx;
    points[i + 1] = x[1] + dy;
  }
}

/**
 * The slider-distortion gate: deform a grid over the area and return the smallest Jacobian
 * determinant ratio (deformed cell area / rest cell area) and the largest. A value ≤ 0 is a fold
 * (tearing); very small or very large means visible stretching.
 */
export function gridDistortion(area: [number, number, number, number], cages: Parameters<typeof deformPoints>[1], sliders: Parameters<typeof deformPoints>[2], step = 6): { min: number; max: number } {
  const [x0, y0, w, h] = area;
  const cols = Math.max(2, Math.ceil(w / step)), rows = Math.max(2, Math.ceil(h / step));
  const pts = new Float32Array((cols + 1) * (rows + 1) * 2);
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) { const k = (r * (cols + 1) + c) * 2; pts[k] = x0 + (w * c) / cols; pts[k + 1] = y0 + (h * r) / rows; }
  const rest = pts.slice();
  deformPoints(pts, cages, sliders);
  let min = Infinity, max = -Infinity;
  const at = (a: Float32Array, r: number, c: number) => [a[(r * (cols + 1) + c) * 2]!, a[(r * (cols + 1) + c) * 2 + 1]!];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const area2 = (a: Float32Array) => {
      const [p, q, s, t] = [at(a, r, c), at(a, r, c + 1), at(a, r + 1, c + 1), at(a, r + 1, c)];
      return ((q[0]! - p[0]!) * (t[1]! - p[1]!) - (q[1]! - p[1]!) * (t[0]! - p[0]!)) + ((t[0]! - s[0]!) * (q[1]! - s[1]!) - (t[1]! - s[1]!) * (q[0]! - s[0]!));
    };
    const ratio = area2(pts) / area2(rest);
    min = Math.min(min, ratio); max = Math.max(max, ratio);
  }
  return { min, max };
}
