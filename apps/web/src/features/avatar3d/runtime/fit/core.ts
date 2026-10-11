/**
 * Rigging a garment to a body in the browser, without Blender: plain typed arrays in, typed arrays
 * out, so it runs in a worker and in tests.
 *
 * 1. **Match**: each garment vertex finds the closest point on the body's surface (a BVH, not just the
 *    closest vertex) among faces whose normal agrees with the garment's at that vertex and within a
 *    distance limit. That keeps a sleeve's inside from taking the torso's weights, or one trouser
 *    leg the other leg's. Skin weights are interpolated at that point (barycentric).
 * 2. **Fill in**: vertices with no acceptable match (a skirt's hem far from the legs) take the weights
 *    of the nearest matched vertex *along the garment* (geodesic, Dijkstra), never across a gap.
 * 3. **Smooth** the weights over the garment's own surface, keep the four strongest, normalize.
 * 4. **Morphs**: the body's morph target offsets are carried over through the same binding, so the
 *    garment changes shape with the body sliders.
 * 5. **Push out** vertices that sit inside the skin to a small offset along the body's normal.
 * 6. Loose parts (skirts, long hair) can get generated **bone chains**: the top stays pinned to the
 *    body and a gradient hands the lower part over to the chains, which swing with physics.
 */
import { buildBvh, closestPoint, rayHit, type Bvh, type Closest } from './bvh';

export interface BodyInput {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Four joints and weights per vertex, into one bone list shared by all body meshes. */
  joints: Uint16Array;
  weights: Float32Array;
  morphs: Array<{ name: string; deltas: Float32Array }>;
  boneCount: number;
  /** Per bone: −1 left, +1 right, 0 middle (to flag weights mixed across the left and right limbs). */
  boneSide: Int8Array;
  /** Per bone: whether it's a leg bone (skirts take the hips' weights instead). */
  legBone: Uint8Array;
  hips: number;
  head: number;
  height: number;
}

export interface GarmentInput {
  positions: Float32Array;
  indices: Uint32Array | null;
}

export interface SwingOptions {
  mode: 'chains' | 'hair';
  pinStart: number;
  pinEnd: number;
  chains: number;
  segments: number;
  /** Prefix for the generated bones' names, unique per garment (bones are matched by name). */
  prefix: string;
  /** Where the chains hang from (hips for skirts, head for hair): the vertical axis passes through it. */
  center: [number, number, number];
}

export interface TransferOptions {
  /** Farthest acceptable surface match, in metres. */
  maxDistance: number;
  /** Cosine of the largest angle between the garment's and the body's normals that still matches. */
  normalCos: number;
  smoothing: number;
  /** Push intersecting vertices out to this distance (metres) when `pushOut` is on. */
  offset: number;
  pushOut: boolean;
  swing: SwingOptions | null;
}

export const DEFAULT_TRANSFER: TransferOptions = { maxDistance: 0.06, normalCos: 0.34, smoothing: 2, offset: 0.004, pushOut: true, swing: null };

/** Bits in the per-vertex flags. */
export const FLAG = { filled: 1, far: 2, mixedLimbs: 4, pushed: 8 } as const;

export interface TransferredMesh {
  positions: Float32Array;
  joints: Uint16Array;
  weights: Float32Array;
  morphs: Array<{ name: string; deltas: Float32Array }>;
  flags: Uint8Array;
}

export interface ChainBone {
  name: string;
  /** A body bone index, or the name of another generated bone. */
  parent: number | string;
  position: [number, number, number];
}

export interface TransferResult {
  meshes: TransferredMesh[];
  bones: ChainBone[];
  stats: { vertices: number; matched: number; filled: number; far: number; pushed: number; mixedLimbs: number; flipped: boolean; ms: number };
}

const K = 8;

interface Welded {
  /** Garment vertex → welded vertex. */
  map: Uint32Array;
  count: number;
  positions: Float32Array;
  tris: Uint32Array;
}

/** Joins vertices at the same position (unindexed exports split every corner), so the mesh is connected. */
export function weld(positions: Float32Array, indices: Uint32Array | null, eps = 1e-5): Welded {
  const n = positions.length / 3;
  const map = new Uint32Array(n);
  const seen = new Map<string, number>();
  const out: number[] = [];
  const q = 1 / eps;
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(positions[i * 3]! * q)},${Math.round(positions[i * 3 + 1]! * q)},${Math.round(positions[i * 3 + 2]! * q)}`;
    let id = seen.get(key);
    if (id === undefined) { id = out.length / 3; seen.set(key, id); out.push(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!); }
    map[i] = id;
  }
  const src = indices ?? Uint32Array.from({ length: n - (n % 3) }, (_, i) => i);
  const tris = new Uint32Array(src.length);
  for (let i = 0; i < src.length; i++) tris[i] = map[src[i]!]!;
  return { map, count: out.length / 3, positions: Float32Array.from(out), tris };
}

function vertexNormals(positions: Float32Array, tris: Uint32Array, count: number) {
  const nrm = new Float32Array(count * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]! * 3, b = tris[t + 1]! * 3, c = tris[t + 2]! * 3;
    const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!, vy = positions[c + 1]! - positions[a + 1]!, vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { nrm[v] += nx; nrm[v + 1] += ny; nrm[v + 2] += nz; }
  }
  for (let i = 0; i < count; i++) {
    const l = Math.hypot(nrm[i * 3]!, nrm[i * 3 + 1]!, nrm[i * 3 + 2]!) || 1;
    nrm[i * 3] /= l; nrm[i * 3 + 1] /= l; nrm[i * 3 + 2] /= l;
  }
  return nrm;
}

function adjacency(tris: Uint32Array, count: number) {
  const sets: Array<Set<number>> = Array.from({ length: count }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]!, b = tris[t + 1]!, c = tris[t + 2]!;
    if (a !== b) { sets[a]!.add(b); sets[b]!.add(a); }
    if (b !== c) { sets[b]!.add(c); sets[c]!.add(b); }
    if (a !== c) { sets[a]!.add(c); sets[c]!.add(a); }
  }
  const start = new Uint32Array(count + 1);
  for (let i = 0; i < count; i++) start[i + 1] = start[i]! + sets[i]!.size;
  const list = new Uint32Array(start[count]!);
  for (let i = 0; i < count; i++) { let k = start[i]!; for (const j of sets[i]!) list[k++] = j; }
  return { start, list };
}

/** A small sparse weight list per vertex: up to K (bone, weight) pairs. */
class Sparse {
  bones: Int32Array;
  values: Float32Array;
  constructor(readonly count: number) {
    this.bones = new Int32Array(count * K).fill(-1);
    this.values = new Float32Array(count * K);
  }
  add(v: number, bone: number, w: number) {
    if (w <= 0) return;
    const o = v * K;
    let empty = -1, smallest = -1;
    for (let k = 0; k < K; k++) {
      const b = this.bones[o + k]!;
      if (b === bone) { this.values[o + k] += w; return; }
      if (b === -1 && empty < 0) empty = k;
      if (smallest < 0 || this.values[o + k]! < this.values[o + smallest]!) smallest = k;
    }
    const slot = empty >= 0 ? empty : this.values[o + smallest]! < w ? smallest : -1;
    if (slot < 0) return;
    this.bones[o + slot] = bone; this.values[o + slot] = w;
  }
  clear(v: number) { this.bones.fill(-1, v * K, v * K + K); this.values.fill(0, v * K, v * K + K); }
  copy(to: number, from: Sparse, v: number, scale = 1) { for (let k = 0; k < K; k++) { const b = from.bones[v * K + k]!; if (b >= 0) this.add(to, b, from.values[v * K + k]! * scale); } }
  normalize(v: number) {
    let s = 0;
    for (let k = 0; k < K; k++) s += this.values[v * K + k]!;
    if (s > 0) for (let k = 0; k < K; k++) this.values[v * K + k] /= s;
  }
}

interface Binding { tri: number; u: number; v: number; w: number }

function heapPush(h: number[], d: Float64Array, v: number) {
  h.push(v);
  let i = h.length - 1;
  while (i > 0) { const p = (i - 1) >> 1; if (d[h[p]!]! <= d[h[i]!]!) break; [h[p], h[i]] = [h[i]!, h[p]!]; i = p; }
}
function heapPop(h: number[], d: Float64Array) {
  const top = h[0]!, last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < h.length && d[h[l]!]! < d[h[m]!]!) m = l;
      if (r < h.length && d[h[r]!]! < d[h[m]!]!) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i]!, h[m]!]; i = m;
    }
  }
  return top;
}

const smoothstep = (a: number, b: number, x: number) => {
  if (b <= a) return x >= a ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function buildBodyBvh(body: BodyInput): Bvh {
  return buildBvh({ positions: body.positions, indices: body.indices });
}

/** Rigs garment meshes (already placed on the body, in the body's space) to the body. */
export function transferToGarment(body: BodyInput, garments: GarmentInput[], options: Partial<TransferOptions> = {}, bvh: Bvh = buildBodyBvh(body), progress: (fraction: number) => void = () => {}): TransferResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const opts = { ...DEFAULT_TRANSFER, ...options };
  // Every garment mesh is joined into one welded surface so a top and its sleeves share seams.
  const offsets: number[] = [];
  let total = 0;
  for (const g of garments) { offsets.push(total); total += g.positions.length / 3; }
  const allPos = new Float32Array(total * 3);
  const allIdx: number[] = [];
  garments.forEach((g, gi) => {
    allPos.set(g.positions, offsets[gi]! * 3);
    const n = g.positions.length / 3;
    const idx = g.indices ?? Uint32Array.from({ length: n - (n % 3) }, (_, i) => i);
    for (let i = 0; i < idx.length; i++) allIdx.push(idx[i]! + offsets[gi]!);
  });
  const w = weld(allPos, Uint32Array.from(allIdx), Math.max(1e-6, body.height * 1e-5));
  const V = w.count;
  let gn = vertexNormals(w.positions, w.tris, V);
  const adj = adjacency(w.tris, V);
  const { positions: bp, normals: bn, indices: bi, joints: bj, weights: bw } = body;
  const fn = bvh.faceNormals;

  // 1. Match. A garment whose normals point inward (flipped export) is noticed and its normals flipped.
  const match = (v: number, flip: number, out: Closest) => {
    const x = w.positions[v * 3]!, y = w.positions[v * 3 + 1]!, z = w.positions[v * 3 + 2]!;
    const nx = gn[v * 3]! * flip, ny = gn[v * 3 + 1]! * flip, nz = gn[v * 3 + 2]! * flip;
    return closestPoint(bvh, x, y, z, opts.maxDistance, (t) => fn[t * 3]! * nx + fn[t * 3 + 1]! * ny + fn[t * 3 + 2]! * nz >= opts.normalCos, out);
  };
  let flipped = false;
  {
    let agree = 0, against = 0;
    const tmp = {} as Closest;
    for (let v = 0; v < V; v += Math.max(1, Math.floor(V / 400))) {
      if (match(v, 1, tmp)) agree++;
      else if (match(v, -1, tmp)) against++;
    }
    if (against > agree * 1.5) { flipped = true; for (let i = 0; i < gn.length; i++) gn[i] = -gn[i]!; }
  }
  const binding: Array<Binding | null> = new Array(V).fill(null);
  const matched = new Uint8Array(V);
  const flags = new Uint8Array(V);
  const weights = new Sparse(V);
  const out = {} as Closest;
  const addBodyWeights = (v: number, b: Binding, scale = 1) => {
    const corners = [bi[b.tri * 3]!, bi[b.tri * 3 + 1]!, bi[b.tri * 3 + 2]!], bary = [b.u, b.v, b.w];
    for (let c = 0; c < 3; c++) for (let k = 0; k < 4; k++) {
      const wt = bw[corners[c]! * 4 + k]!;
      if (wt > 0) weights.add(v, bj[corners[c]! * 4 + k]!, wt * Math.max(0, bary[c]!) * scale);
    }
  };
  let pushed = 0, loose = 0;
  const finalPos = new Float32Array(w.positions);
  // A second, wider look (still facing the same way) for loose cloth: a baggy sleeve still finds its
  // arm rather than taking the torso's weights through the cloth.
  const wide = (v: number, o: Closest) => {
    const x = w.positions[v * 3]!, y = w.positions[v * 3 + 1]!, z = w.positions[v * 3 + 2]!;
    const nx = gn[v * 3]!, ny = gn[v * 3 + 1]!, nz = gn[v * 3 + 2]!;
    return closestPoint(bvh, x, y, z, opts.maxDistance * 3, (t) => fn[t * 3]! * nx + fn[t * 3 + 1]! * ny + fn[t * 3 + 2]! * nz >= opts.normalCos, o);
  };
  for (let v = 0; v < V; v++) {
    let hit = match(v, 1, out);
    if (!hit && !opts.swing) { hit = wide(v, out); if (hit) loose++; }
    if (hit) {
      matched[v] = 1;
      binding[v] = { tri: hit.tri, u: hit.u, v: hit.v, w: hit.w };
      addBodyWeights(v, binding[v]!);
      if (opts.pushOut) {
        // The body's smooth normal at the match point.
        const c0 = bi[hit.tri * 3]! * 3, c1 = bi[hit.tri * 3 + 1]! * 3, c2 = bi[hit.tri * 3 + 2]! * 3;
        let nx = bn[c0]! * hit.u + bn[c1]! * hit.v + bn[c2]! * hit.w, ny = bn[c0 + 1]! * hit.u + bn[c1 + 1]! * hit.v + bn[c2 + 1]! * hit.w, nz = bn[c0 + 2]! * hit.u + bn[c1 + 2]! * hit.v + bn[c2 + 2]! * hit.w;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        const px = w.positions[v * 3]! - hit.x, py = w.positions[v * 3 + 1]! - hit.y, pz = w.positions[v * 3 + 2]! - hit.z;
        const signed = px * nx + py * ny + pz * nz;
        if (signed < opts.offset) {
          finalPos[v * 3] = hit.x + nx * opts.offset; finalPos[v * 3 + 1] = hit.y + ny * opts.offset; finalPos[v * 3 + 2] = hit.z + nz * opts.offset;
          flags[v] |= FLAG.pushed; pushed++;
        }
      }
    }
    if ((v & 1023) === 0) progress(0.1 + 0.5 * (v / V));
  }

  // 2. Fill in from the nearest matched vertex along the garment (multi-source Dijkstra).
  const dist = new Float64Array(V).fill(Infinity);
  const source = new Int32Array(V).fill(-1);
  const heap: number[] = [];
  for (let v = 0; v < V; v++) if (matched[v]) { dist[v] = 0; source[v] = v; heapPush(heap, dist, v); }
  while (heap.length) {
    const v = heapPop(heap, dist);
    for (let k = adj.start[v]!; k < adj.start[v + 1]!; k++) {
      const u = adj.list[k]!;
      const d = dist[v]! + Math.hypot(w.positions[u * 3]! - w.positions[v * 3]!, w.positions[u * 3 + 1]! - w.positions[v * 3 + 1]!, w.positions[u * 3 + 2]! - w.positions[v * 3 + 2]!);
      if (d < dist[u]!) { dist[u] = d; source[u] = source[v]!; heapPush(heap, dist, u); }
    }
  }
  let filled = 0, far = 0;
  for (let v = 0; v < V; v++) {
    if (matched[v]) continue;
    if (source[v]! >= 0) {
      weights.copy(v, weights, source[v]!);
      binding[v] = binding[source[v]!]!;
      flags[v] |= FLAG.filled; filled++;
    } else {
      // A separate piece with no acceptable match anywhere: plain closest point, flagged.
      const hit = closestPoint(bvh, w.positions[v * 3]!, w.positions[v * 3 + 1]!, w.positions[v * 3 + 2]!, Infinity, null, out)!;
      binding[v] = { tri: hit.tri, u: hit.u, v: hit.v, w: hit.w };
      addBodyWeights(v, binding[v]!);
      flags[v] |= FLAG.far; far++;
    }
  }
  progress(0.7);

  // 3. Smooth over the garment's surface.
  for (let it = 0; it < opts.smoothing; it++) {
    const next = new Sparse(V);
    for (let v = 0; v < V; v++) {
      const deg = adj.start[v + 1]! - adj.start[v]!;
      next.copy(v, weights, v, deg ? 0.5 : 1);
      for (let k = adj.start[v]!; k < adj.start[v + 1]!; k++) next.copy(v, weights, adj.list[k]!, 0.5 / deg);
      next.normalize(v);
    }
    weights.bones = next.bones; weights.values = next.values;
  }

  // 6. Swinging chains (before the four-bone limit, since they take a share of every lower vertex).
  const bones: ChainBone[] = [];
  if (opts.swing) swing(opts.swing, body, w.positions, weights, bones, V);

  // Final: four strongest, normalized; flag left/right mixing.
  const joints4 = new Uint16Array(V * 4), weights4 = new Float32Array(V * 4);
  let mixedLimbs = 0;
  for (let v = 0; v < V; v++) {
    const pairs: Array<[number, number]> = [];
    for (let k = 0; k < K; k++) { const b = weights.bones[v * K + k]!; if (b >= 0 && weights.values[v * K + k]! > 1e-6) pairs.push([b, weights.values[v * K + k]!]); }
    pairs.sort((a, b) => b[1] - a[1]);
    const top = pairs.slice(0, 4);
    const sum = top.reduce((s, p) => s + p[1], 0);
    if (!top.length) { joints4[v * 4] = body.hips; weights4[v * 4] = 1; continue; }
    let left = 0, right = 0;
    top.forEach(([b, wt], i) => {
      joints4[v * 4 + i] = b; weights4[v * 4 + i] = wt / sum;
      const side = b < body.boneCount ? body.boneSide[b]! : 0;
      if (side < 0) left += wt / sum; else if (side > 0) right += wt / sum;
    });
    if (left >= 0.2 && right >= 0.2) { flags[v] |= FLAG.mixedLimbs; mixedLimbs++; }
  }
  progress(0.85);

  // 4. Morph targets through the same binding, then smoothed once over the garment.
  const morphDeltas: Array<{ name: string; deltas: Float32Array }> = [];
  for (const m of body.morphs) {
    const d = new Float32Array(V * 3);
    let any = false;
    for (let v = 0; v < V; v++) {
      const b = binding[v]!;
      const c0 = bi[b.tri * 3]! * 3, c1 = bi[b.tri * 3 + 1]! * 3, c2 = bi[b.tri * 3 + 2]! * 3;
      for (let a = 0; a < 3; a++) {
        const value = m.deltas[c0 + a]! * b.u + m.deltas[c1 + a]! * b.v + m.deltas[c2 + a]! * b.w;
        d[v * 3 + a] = value;
        if (value !== 0) any = true;
      }
    }
    if (!any) continue;
    const s = new Float32Array(V * 3);
    for (let v = 0; v < V; v++) {
      const deg = adj.start[v + 1]! - adj.start[v]!;
      for (let a = 0; a < 3; a++) {
        let acc = 0;
        for (let k = adj.start[v]!; k < adj.start[v + 1]!; k++) acc += d[adj.list[k]! * 3 + a]!;
        s[v * 3 + a] = deg ? d[v * 3 + a]! * 0.5 + (acc / deg) * 0.5 : d[v * 3 + a]!;
      }
    }
    morphDeltas.push({ name: m.name, deltas: s });
  }

  // Back to each garment mesh's own vertices.
  const meshes: TransferredMesh[] = garments.map((g, gi) => {
    const n = g.positions.length / 3, o = offsets[gi]!;
    const positions = new Float32Array(n * 3), joints = new Uint16Array(n * 4), wts = new Float32Array(n * 4), fl = new Uint8Array(n);
    const morphs = morphDeltas.map((m) => ({ name: m.name, deltas: new Float32Array(n * 3) }));
    for (let i = 0; i < n; i++) {
      const v = w.map[o + i]!;
      positions.set(finalPos.subarray(v * 3, v * 3 + 3), i * 3);
      joints.set(joints4.subarray(v * 4, v * 4 + 4), i * 4);
      wts.set(weights4.subarray(v * 4, v * 4 + 4), i * 4);
      fl[i] = flags[v]!;
      morphs.forEach((m, mi) => m.deltas.set(morphDeltas[mi]!.deltas.subarray(v * 3, v * 3 + 3), i * 3));
    }
    return { positions, joints, weights: wts, morphs, flags: fl };
  });
  progress(1);
  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { meshes, bones, stats: { vertices: total, matched: V - filled - far, filled, far, pushed, mixedLimbs, flipped, ms } };
}

/**
 * Generated chains: N chains around the vertical axis through `center`, from the pin height down to
 * the bottom of the garment, each `segments` bones long and following its flare. Lower vertices are
 * handed from the body's weights to the two nearest chains by a smooth pin gradient.
 */
function swing(o: SwingOptions, body: BodyInput, pos: Float32Array, weights: Sparse, bones: ChainBone[], V: number) {
  let top = -Infinity, bottom = Infinity;
  for (let v = 0; v < V; v++) { top = Math.max(top, pos[v * 3 + 1]!); bottom = Math.min(bottom, pos[v * 3 + 1]!); }
  const height = top - bottom;
  if (height <= 1e-4) return;
  const yStart = top - o.pinStart * height;
  const seg = (yStart - bottom) / o.segments;
  if (seg <= 1e-5) return;
  const [cx, , cz] = o.center;
  const N = o.chains, step = (Math.PI * 2) / N;
  const angle = (v: number) => { let a = Math.atan2(pos[v * 3 + 2]! - cz, pos[v * 3]! - cx); if (a < 0) a += Math.PI * 2; return a; };
  // Radius of the garment per chain and joint height (the flare), and which chains have cloth below the pin.
  const radius = new Float64Array(N * (o.segments + 1));
  const active = new Uint8Array(N);
  for (let v = 0; v < V; v++) {
    const y = pos[v * 3 + 1]!;
    if (y > yStart + seg * 0.5) continue;
    const k = Math.round(angle(v) / step) % N;
    const j = Math.min(o.segments, Math.max(0, Math.round((yStart - y) / seg)));
    const r = Math.hypot(pos[v * 3]! - cx, pos[v * 3 + 2]! - cz);
    if (y < yStart - seg * 0.25) active[k] = 1;
    radius[k * (o.segments + 1) + j] = Math.max(radius[k * (o.segments + 1) + j]!, r);
  }
  const anchor = o.mode === 'hair' ? body.head : body.hips;
  const name = (k: number, j: number) => `${o.prefix}_${k}_${j}`;
  const boneIndex = new Map<string, number>();
  for (let k = 0; k < N; k++) {
    if (!active[k]) continue;
    let r = 0;
    for (let j = 0; j <= o.segments; j++) {
      const measured = radius[k * (o.segments + 1) + j]!;
      r = measured > 0 ? measured : r || Math.max(...Array.from(radius.subarray(k * (o.segments + 1), (k + 1) * (o.segments + 1))));
      const a = k * step;
      bones.push({ name: name(k, j), parent: j === 0 ? anchor : name(k, j - 1), position: [cx + Math.cos(a) * r, yStart - j * seg, cz + Math.sin(a) * r] });
      boneIndex.set(name(k, j), body.boneCount + bones.length - 1);
    }
  }
  if (!bones.length) return;
  const nearestActive = (k: number, dir: number) => { for (let i = 0; i < N; i++) { const c = (((k + dir * i) % N) + N) % N; if (active[c]) return c; } return -1; };
  const scratch = new Sparse(1);
  for (let v = 0; v < V; v++) {
    const y = pos[v * 3 + 1]!;
    const s = smoothstep(o.pinStart, o.pinEnd, (top - y) / height);
    // The body's share: skirts follow the hips, not one leg; hair follows the head.
    scratch.clear(0);
    for (let k = 0; k < K; k++) {
      const b = weights.bones[v * K + k]!;
      if (b < 0) continue;
      const wt = weights.values[v * K + k]!;
      const to = o.mode === 'hair' ? anchor : body.legBone[b] ? body.hips : b;
      scratch.add(0, to, wt * (1 - s));
    }
    if (s > 0) {
      const a = angle(v) / step;
      let k0 = Math.floor(a) % N, k1 = (k0 + 1) % N, f = a - Math.floor(a);
      if (!active[k0]) { k0 = nearestActive(k0, -1); }
      if (!active[k1]) { k1 = nearestActive(k1, 1); }
      if (k0 === k1) f = 0;
      const j = Math.min(o.segments - 1, Math.max(0, Math.floor((yStart - y) / seg)));
      if (k0 >= 0) scratch.add(0, boneIndex.get(name(k0, j))!, s * (1 - f));
      if (k1 >= 0) scratch.add(0, boneIndex.get(name(k1, j))!, s * f);
    }
    weights.clear(v);
    weights.copy(v, scratch, 0);
    weights.normalize(v);
  }
}

/**
 * Which body triangles a worn garment covers: from each triangle a few points cast rays outward
 * along the face normal; a triangle is hidden when at least three of its four rays meet the garment
 * within `maxDistance`. Rays also look a little way inward: skin that pokes out *through* the cloth
 * (a smaller cup on a fuller body) has the garment just behind it, and hides too. Works on the meshes
 * as loaded (any triangle order or simplification).
 */
export function coveredTriangles(body: { positions: Float32Array; indices: Uint32Array }, garment: Bvh, maxDistance: number, onlyTriangles?: Uint8Array, inward = maxDistance): Uint8Array {
  const { positions: p, indices } = body;
  const n = indices.length / 3;
  const out = new Uint8Array(n);
  for (let t = 0; t < n; t++) {
    if (onlyTriangles && !onlyTriangles[t]) continue;
    const a = indices[t * 3]! * 3, b = indices[t * 3 + 1]! * 3, c = indices[t * 3 + 2]! * 3;
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-14) continue;
    nx /= l; ny /= l; nz /= l;
    const cx = (p[a]! + p[b]! + p[c]!) / 3, cy = (p[a + 1]! + p[b + 1]! + p[c + 1]!) / 3, cz = (p[a + 2]! + p[b + 2]! + p[c + 2]!) / 3;
    let hits = 0;
    for (let s = 0; s < 4; s++) {
      // The centroid, then each corner pulled a third of the way in.
      const k = s === 0 ? -1 : [a, b, c][s - 1]!;
      const ox = k < 0 ? cx : p[k]! + (cx - p[k]!) * 0.35, oy = k < 0 ? cy : p[k + 1]! + (cy - p[k + 1]!) * 0.35, oz = k < 0 ? cz : p[k + 2]! + (cz - p[k + 2]!) * 0.35;
      if (rayHit(garment, ox - nx * 1e-4, oy - ny * 1e-4, oz - nz * 1e-4, nx, ny, nz, maxDistance) < maxDistance) hits++;
      else if (inward > 0 && rayHit(garment, ox + nx * 1e-4, oy + ny * 1e-4, oz + nz * 1e-4, -nx, -ny, -nz, inward) < inward) hits++;
      if (hits + (3 - s) < 3) break;
    }
    if (hits >= 3) out[t] = 1;
  }
  return out;
}
