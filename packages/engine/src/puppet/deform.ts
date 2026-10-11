/**
 * Evaluates a puppet at its current parameter values: keyforms are interpolated (linearly between
 * keys, bilinearly for two parameters, held at the ends), deformers are applied parents first, and
 * every part's vertices come out in puppet space with its opacity and draw order.
 *
 * Warp deformers map a point by where it sits in their rest rectangle (u, v) onto their current
 * grid (bilinear in each cell, extended linearly past the edges). Rotation deformers turn and scale
 * around their origin, which itself follows the parent. Allocation-free per frame.
 */
import type { BindingProp, PuppetModel } from './format.js';

interface CompiledBinding {
  prop: BindingProp;
  params: number[];
  keys: number[][];
  /** One keyform per key combination; numbers for scalar props. */
  values: Float32Array[];
  scalar: Float32Array;
}

interface DeformerState {
  kind: 'warp' | 'rotate';
  parent: number;
  /** warp: rest rect and grid size; current grid in puppet space. */
  rect: [number, number, number, number];
  cols: number;
  rows: number;
  rest: Float32Array;
  grid: Float32Array;
  /** rotate: rest origin; current origin in puppet space, angle (radians) and scale. */
  origin: [number, number];
  at: [number, number];
  angle: number;
  scale: number;
  bindings: CompiledBinding[];
}

export interface PartFrame {
  /** Puppet-space positions x,y per vertex (updated in place each evaluation). */
  positions: Float32Array;
  opacity: number;
  z: number;
}

const DEG = Math.PI / 180;

export class PuppetRig {
  readonly paramIds: string[];
  readonly values: Float32Array;
  readonly min: Float32Array;
  readonly max: Float32Array;
  readonly defaults: Float32Array;
  readonly frames: PartFrame[];
  /** Part indices back to front, refreshed each evaluation. */
  readonly order: number[];
  private paramIndex = new Map<string, number>();
  private deformers: DeformerState[] = [];
  private deformerOrder: number[] = [];
  private parts: Array<{ parent: number; rest: Float32Array; z: number; opacity: number; bindings: CompiledBinding[] }> = [];
  private w = new Float32Array(4);
  private wi = new Int32Array(4);

  constructor(readonly model: PuppetModel) {
    this.paramIds = model.params.map((p) => p.id);
    model.params.forEach((p, i) => this.paramIndex.set(p.id, i));
    this.values = Float32Array.from(model.params.map((p) => p.default));
    this.min = Float32Array.from(model.params.map((p) => p.min));
    this.max = Float32Array.from(model.params.map((p) => p.max));
    this.defaults = Float32Array.from(model.params.map((p) => p.default));
    const dIndex = new Map(model.deformers.map((d, i) => [d.id, i]));
    const pIndex = new Map(model.parts.map((p, i) => [p.id, i]));
    const compile = (b: PuppetModel['bindings'][number]): CompiledBinding => ({
      prop: b.prop,
      params: b.params.map((p) => this.paramIndex.get(p) ?? -1),
      keys: b.keys,
      values: b.values.map((v) => (typeof v === 'number' ? Float32Array.of(v) : Float32Array.from(v))),
      scalar: Float32Array.from(b.values.map((v) => (typeof v === 'number' ? v : v[0] ?? 0))),
    });
    for (const d of model.deformers) {
      const s: DeformerState = { kind: d.kind, parent: d.parent ? dIndex.get(d.parent) ?? -1 : -1, rect: [0, 0, 1, 1], cols: 1, rows: 1, rest: new Float32Array(0), grid: new Float32Array(0), origin: [0, 0], at: [0, 0], angle: 0, scale: 1, bindings: [] };
      if (d.kind === 'warp') {
        s.rect = d.rect; s.cols = d.cols; s.rows = d.rows;
        s.rest = new Float32Array((d.cols + 1) * (d.rows + 1) * 2);
        for (let r = 0; r <= d.rows; r++) for (let c = 0; c <= d.cols; c++) {
          const k = (r * (d.cols + 1) + c) * 2;
          s.rest[k] = d.rect[0] + (d.rect[2] * c) / d.cols;
          s.rest[k + 1] = d.rect[1] + (d.rect[3] * r) / d.rows;
        }
        s.grid = new Float32Array(s.rest.length);
      } else s.origin = d.origin;
      this.deformers.push(s);
    }
    this.parts = model.parts.map((p) => ({ parent: p.parent ? dIndex.get(p.parent) ?? -1 : -1, rest: Float32Array.from(p.mesh.positions), z: p.z, opacity: p.opacity, bindings: [] }));
    for (const b of model.bindings) {
      const c = compile(b);
      if (b.prop === 'verts' || b.prop === 'opacity' || b.prop === 'z') { const i = pIndex.get(b.target); if (i !== undefined) this.parts[i]!.bindings.push(c); }
      else { const i = dIndex.get(b.target); if (i !== undefined) this.deformers[i]!.bindings.push(c); }
    }
    // Parents before children.
    const placed = new Set<number>();
    const visit = (i: number) => { if (placed.has(i)) return; const p = this.deformers[i]!.parent; if (p >= 0) visit(p); placed.add(i); this.deformerOrder.push(i); };
    this.deformers.forEach((_, i) => visit(i));
    this.frames = this.parts.map((p) => ({ positions: new Float32Array(p.rest.length), opacity: p.opacity, z: p.z }));
    this.order = this.parts.map((_, i) => i);
  }

  param(id: string): number { return this.paramIndex.get(id) ?? -1; }
  get(id: string): number { const i = this.paramIndex.get(id); return i === undefined ? 0 : this.values[i]!; }
  set(id: string, v: number) {
    const i = this.paramIndex.get(id);
    if (i !== undefined) this.values[i] = Math.min(this.max[i]!, Math.max(this.min[i]!, v));
  }
  reset() { this.values.set(this.defaults); }

  /** Weights over the binding's keyforms for the current values (into this.w / this.wi; returns how many). */
  private weights(b: CompiledBinding): number {
    const seg = (keys: number[], v: number): [number, number, number] => {
      if (keys.length === 1 || v <= keys[0]!) return [0, 0, 0];
      const last = keys.length - 1;
      if (v >= keys[last]!) return [last, last, 0];
      let j = 0;
      while (v > keys[j + 1]!) j++;
      return [j, j + 1, (v - keys[j]!) / (keys[j + 1]! - keys[j]!)];
    };
    const v0 = b.params[0]! >= 0 ? this.values[b.params[0]!]! : 0;
    const [a0, a1, t] = seg(b.keys[0]!, v0);
    if (b.keys.length === 1) {
      this.wi[0] = a0; this.w[0] = 1 - t; this.wi[1] = a1; this.w[1] = t;
      return 2;
    }
    const n0 = b.keys[0]!.length;
    const v1 = b.params[1]! >= 0 ? this.values[b.params[1]!]! : 0;
    const [c0, c1, s] = seg(b.keys[1]!, v1);
    this.wi[0] = a0 + c0 * n0; this.w[0] = (1 - t) * (1 - s);
    this.wi[1] = a1 + c0 * n0; this.w[1] = t * (1 - s);
    this.wi[2] = a0 + c1 * n0; this.w[2] = (1 - t) * s;
    this.wi[3] = a1 + c1 * n0; this.w[3] = t * s;
    return 4;
  }

  /** Adds the interpolated keyform of `b` into `out` (arrays). */
  private addArray(b: CompiledBinding, out: Float32Array) {
    const n = this.weights(b);
    for (let k = 0; k < n; k++) {
      const wt = this.w[k]!;
      if (wt === 0) continue;
      const src = b.values[this.wi[k]!]!;
      const len = Math.min(src.length, out.length);
      for (let i = 0; i < len; i++) out[i]! += src[i]! * wt;
    }
  }

  private scalar(b: CompiledBinding): number {
    const n = this.weights(b);
    let v = 0;
    for (let k = 0; k < n; k++) v += b.scalar[this.wi[k]!]! * this.w[k]!;
    return v;
  }

  /** Maps a point given in deformer `d`'s rest space into puppet space (writes to out). */
  mapPoint(d: number, x: number, y: number, out: Float32Array, o: number) {
    if (d < 0) { out[o] = x; out[o + 1] = y; return; }
    const s = this.deformers[d]!;
    if (s.kind === 'rotate') {
      const dx = (x - s.origin[0]) * s.scale, dy = (y - s.origin[1]) * s.scale;
      const c = Math.cos(s.angle), sn = Math.sin(s.angle);
      out[o] = s.at[0] + dx * c - dy * sn;
      out[o + 1] = s.at[1] + dx * sn + dy * c;
      return;
    }
    const [rx, ry, rw, rh] = s.rect;
    const u = ((x - rx) / rw) * s.cols, v = ((y - ry) / rh) * s.rows;
    const ci = Math.min(s.cols - 1, Math.max(0, Math.floor(u))), ri = Math.min(s.rows - 1, Math.max(0, Math.floor(v)));
    const fu = u - ci, fv = v - ri;
    const W = s.cols + 1, g = s.grid;
    const p00 = (ri * W + ci) * 2, p10 = p00 + 2, p01 = p00 + W * 2, p11 = p01 + 2;
    out[o] = g[p00]! * (1 - fu) * (1 - fv) + g[p10]! * fu * (1 - fv) + g[p01]! * (1 - fu) * fv + g[p11]! * fu * fv;
    out[o + 1] = g[p00 + 1]! * (1 - fu) * (1 - fv) + g[p10 + 1]! * fu * (1 - fv) + g[p01 + 1]! * (1 - fu) * fv + g[p11 + 1]! * fu * fv;
  }

  private tmp = new Float32Array(4);

  /** Runs every keyform and deformer; frames hold the result. */
  evaluate() {
    for (const i of this.deformerOrder) {
      const s = this.deformers[i]!;
      if (s.kind === 'warp') {
        s.grid.set(s.rest);
        for (const b of s.bindings) if (b.prop === 'grid') this.addArray(b, s.grid);
        if (s.parent >= 0) for (let k = 0; k < s.grid.length; k += 2) this.mapPoint(s.parent, s.grid[k]!, s.grid[k + 1]!, s.grid, k);
      } else {
        let angle = 0, scale = 1, ox = 0, oy = 0;
        for (const b of s.bindings) {
          if (b.prop === 'angle') angle += this.scalar(b);
          else if (b.prop === 'scale') scale *= this.scalar(b);
          else if (b.prop === 'offset') { this.tmp[0] = 0; this.tmp[1] = 0; this.addArray(b, this.tmp); ox += this.tmp[0]!; oy += this.tmp[1]!; }
        }
        const x = s.origin[0] + ox, y = s.origin[1] + oy;
        let pa = 0, ps = 1;
        if (s.parent >= 0) {
          // The parent's turn and stretch at this point, measured from a small step to the right.
          const t = this.tmp;
          this.mapPoint(s.parent, x, y, t, 0);
          this.mapPoint(s.parent, x + 1, y, t, 2);
          pa = Math.atan2(t[3]! - t[1]!, t[2]! - t[0]!);
          ps = Math.hypot(t[3]! - t[1]!, t[2]! - t[0]!);
          s.at[0] = t[0]!; s.at[1] = t[1]!;
        } else { s.at[0] = x; s.at[1] = y; }
        s.angle = angle * DEG + pa;
        s.scale = scale * ps;
      }
    }
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]!, f = this.frames[i]!;
      f.positions.set(p.rest);
      let opacity = p.opacity, z = p.z;
      for (const b of p.bindings) {
        if (b.prop === 'verts') this.addArray(b, f.positions);
        else if (b.prop === 'opacity') opacity *= this.scalar(b);
        else if (b.prop === 'z') z += this.scalar(b);
      }
      if (p.parent >= 0) for (let k = 0; k < f.positions.length; k += 2) this.mapPoint(p.parent, f.positions[k]!, f.positions[k + 1]!, f.positions, k);
      f.opacity = Math.max(0, Math.min(1, opacity));
      f.z = z;
    }
    // Stable sort by draw order (insertion sort: the order rarely changes between frames).
    const o = this.order, fr = this.frames;
    for (let i = 1; i < o.length; i++) {
      const cur = o[i]!;
      let j = i - 1;
      while (j >= 0 && (fr[o[j]!]!.z > fr[cur]!.z || (fr[o[j]!]!.z === fr[cur]!.z && o[j]! > cur))) { o[j + 1] = o[j]!; j--; }
      o[j + 1] = cur;
    }
  }
}
