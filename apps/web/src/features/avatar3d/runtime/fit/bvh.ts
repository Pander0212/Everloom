/**
 * A bounding volume hierarchy over triangles, in flat typed arrays (no three.js, so it runs in a
 * worker and in tests): closest point on the surface (with a filter, e.g. "faces whose normal agrees
 * with this one") and ray hits.
 */
export interface Tris {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface Bvh {
  tris: Tris;
  /** Triangle order after building (leaves index into this). */
  order: Uint32Array;
  /** Per node: min xyz, max xyz. */
  bounds: Float32Array;
  /** Per node: left child (or -1 for a leaf), right child / first triangle, triangle count. */
  left: Int32Array;
  right: Int32Array;
  count: Int32Array;
  /** Unit face normals, per triangle. */
  faceNormals: Float32Array;
  nodes: number;
}

const LEAF = 6;

export function buildBvh(tris: Tris): Bvh {
  const { positions: p, indices } = tris;
  const n = indices.length / 3;
  const centroid = new Float32Array(n * 3), lo = new Float32Array(n * 3), hi = new Float32Array(n * 3), faceNormals = new Float32Array(n * 3);
  for (let t = 0; t < n; t++) {
    const a = indices[t * 3]! * 3, b = indices[t * 3 + 1]! * 3, c = indices[t * 3 + 2]! * 3;
    for (let k = 0; k < 3; k++) {
      const x = p[a + k]!, y = p[b + k]!, z = p[c + k]!;
      centroid[t * 3 + k] = (x + y + z) / 3;
      lo[t * 3 + k] = Math.min(x, y, z);
      hi[t * 3 + k] = Math.max(x, y, z);
    }
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!;
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    faceNormals[t * 3] = nx; faceNormals[t * 3 + 1] = ny; faceNormals[t * 3 + 2] = nz;
  }
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // Uneven splits can make leaves of one triangle: a binary tree has at most 2n − 1 nodes.
  const maxNodes = Math.max(1, 2 * n + 1);
  const bounds = new Float32Array(maxNodes * 6), left = new Int32Array(maxNodes), right = new Int32Array(maxNodes), count = new Int32Array(maxNodes);
  let nodes = 0;
  const build = (start: number, end: number): number => {
    const node = nodes++;
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    let cnx = Infinity, cny = Infinity, cnz = Infinity, cxx = -Infinity, cxy = -Infinity, cxz = -Infinity;
    for (let i = start; i < end; i++) {
      const t = order[i]! * 3;
      mnx = Math.min(mnx, lo[t]!); mny = Math.min(mny, lo[t + 1]!); mnz = Math.min(mnz, lo[t + 2]!);
      mxx = Math.max(mxx, hi[t]!); mxy = Math.max(mxy, hi[t + 1]!); mxz = Math.max(mxz, hi[t + 2]!);
      cnx = Math.min(cnx, centroid[t]!); cny = Math.min(cny, centroid[t + 1]!); cnz = Math.min(cnz, centroid[t + 2]!);
      cxx = Math.max(cxx, centroid[t]!); cxy = Math.max(cxy, centroid[t + 1]!); cxz = Math.max(cxz, centroid[t + 2]!);
    }
    bounds.set([mnx, mny, mnz, mxx, mxy, mxz], node * 6);
    if (end - start <= LEAF) { left[node] = -1; right[node] = start; count[node] = end - start; return node; }
    const ex = cxx - cnx, ey = cxy - cny, ez = cxz - cnz;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const mid = [cnx + ex / 2, cny + ey / 2, cnz + ez / 2][axis]!;
    // Partition around the middle of the centroid box; fall back to halves when it's degenerate.
    let i = start, j = end - 1;
    while (i <= j) {
      if (centroid[order[i]! * 3 + axis]! < mid) i++;
      else { const tmp = order[i]!; order[i] = order[j]!; order[j] = tmp; j--; }
    }
    let split = i;
    if (split === start || split === end) split = (start + end) >> 1;
    count[node] = 0;
    left[node] = build(start, split);
    right[node] = build(split, end);
    return node;
  };
  if (n) build(0, n);
  else { nodes = 1; left[0] = -1; right[0] = 0; count[0] = 0; bounds.set([0, 0, 0, 0, 0, 0]); }
  return { tris, order, bounds, left, right, count, faceNormals, nodes };
}

export interface Closest {
  tri: number;
  /** The closest point and its barycentric weights for the triangle's three corners. */
  x: number; y: number; z: number;
  u: number; v: number; w: number;
  distance: number;
}

const boxDistSq = (b: Float32Array, node: number, x: number, y: number, z: number) => {
  const o = node * 6;
  const dx = Math.max(b[o]! - x, 0, x - b[o + 3]!), dy = Math.max(b[o + 1]! - y, 0, y - b[o + 4]!), dz = Math.max(b[o + 2]! - z, 0, z - b[o + 5]!);
  return dx * dx + dy * dy + dz * dz;
};

/** Closest point on triangle (a, b, c) to p, with barycentric weights (Ericson, Real-Time Collision Detection 5.1.5). */
export function closestOnTriangle(p: Float32Array, ia: number, ib: number, ic: number, x: number, y: number, z: number, out: Float64Array) {
  const ax = p[ia]!, ay = p[ia + 1]!, az = p[ia + 2]!;
  const abx = p[ib]! - ax, aby = p[ib + 1]! - ay, abz = p[ib + 2]! - az;
  const acx = p[ic]! - ax, acy = p[ic + 1]! - ay, acz = p[ic + 2]! - az;
  const apx = x - ax, apy = y - ay, apz = z - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let u: number, v: number, w: number;
  if (d1 <= 0 && d2 <= 0) { u = 1; v = 0; w = 0; }
  else {
    const bpx = x - p[ib]!, bpy = y - p[ib + 1]!, bpz = z - p[ib + 2]!;
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); u = 1 - t; v = t; w = 0; }
      else {
        const cpx = x - p[ic]!, cpy = y - p[ic + 1]!, cpz = z - p[ic + 2]!;
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); u = 1 - t; v = 0; w = t; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / (d4 - d3 + (d5 - d6)); u = 0; v = 1 - t; w = t; }
            else { const denom = 1 / (va + vb + vc); v = vb * denom; w = vc * denom; u = 1 - v - w; }
          }
        }
      }
    }
  }
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
  out[3] = u; out[4] = v; out[5] = w;
}

/**
 * The closest surface point within `maxDistance` among triangles that pass `accept` (null: any).
 * Returns null when nothing qualifies.
 */
// Scratch space shared by every query (one query runs at a time; queries are called hundreds of
// thousands of times while fitting, so nothing is allocated per call).
const _tmp = new Float64Array(6), _keep = new Float64Array(6), _stack = new Int32Array(128);

export function closestPoint(bvh: Bvh, x: number, y: number, z: number, maxDistance: number, accept: ((tri: number) => boolean) | null, out?: Closest): Closest | null {
  const { bounds, left, right, count, order, tris } = bvh;
  const { positions: p, indices } = tris;
  let best = maxDistance * maxDistance, found = -1;
  const tmp = _tmp, keep = _keep, stack = _stack;
  let sp = 0;
  stack[sp++] = 0;
  while (sp) {
    const node = stack[--sp]!;
    if (boxDistSq(bounds, node, x, y, z) > best) continue;
    if (left[node] === -1) {
      for (let i = right[node]!, e = right[node]! + count[node]!; i < e; i++) {
        const t = order[i]!;
        if (accept && !accept(t)) continue;
        closestOnTriangle(p, indices[t * 3]! * 3, indices[t * 3 + 1]! * 3, indices[t * 3 + 2]! * 3, x, y, z, tmp);
        const dx = tmp[0]! - x, dy = tmp[1]! - y, dz = tmp[2]! - z, d = dx * dx + dy * dy + dz * dz;
        if (d < best) { best = d; found = t; keep.set(tmp); }
      }
    } else {
      const l = left[node]!, r = right[node]!;
      const dl = boxDistSq(bounds, l, x, y, z), dr = boxDistSq(bounds, r, x, y, z);
      // Nearer child last, so it's popped first.
      if (sp + 2 > stack.length) continue;
      if (dl < dr) { if (dr <= best) stack[sp++] = r; if (dl <= best) stack[sp++] = l; }
      else { if (dl <= best) stack[sp++] = l; if (dr <= best) stack[sp++] = r; }
    }
  }
  if (found < 0) return null;
  const res = out ?? ({} as Closest);
  res.tri = found; res.x = keep[0]!; res.y = keep[1]!; res.z = keep[2]!; res.u = keep[3]!; res.v = keep[4]!; res.w = keep[5]!; res.distance = Math.sqrt(best);
  return res;
}

/** Distance along the ray (origin, unit direction) to the nearest triangle hit within `max`, or Infinity. */
export function rayHit(bvh: Bvh, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number {
  const { bounds, left, right, count, order, tris } = bvh;
  const { positions: p, indices } = tris;
  const ix = 1 / (dx || 1e-12), iy = 1 / (dy || 1e-12), iz = 1 / (dz || 1e-12);
  let best = max;
  const stack = new Int32Array(128);
  let sp = 0;
  stack[sp++] = 0;
  while (sp) {
    const node = stack[--sp]!, o = node * 6;
    let t0 = ((ix >= 0 ? bounds[o]! : bounds[o + 3]!) - ox) * ix, t1 = ((ix >= 0 ? bounds[o + 3]! : bounds[o]!) - ox) * ix;
    const ty0 = ((iy >= 0 ? bounds[o + 1]! : bounds[o + 4]!) - oy) * iy, ty1 = ((iy >= 0 ? bounds[o + 4]! : bounds[o + 1]!) - oy) * iy;
    t0 = Math.max(t0, ty0); t1 = Math.min(t1, ty1);
    const tz0 = ((iz >= 0 ? bounds[o + 2]! : bounds[o + 5]!) - oz) * iz, tz1 = ((iz >= 0 ? bounds[o + 5]! : bounds[o + 2]!) - oz) * iz;
    t0 = Math.max(t0, tz0); t1 = Math.min(t1, tz1);
    if (t1 < Math.max(t0, 0) || t0 > best) continue;
    if (left[node] === -1) {
      for (let i = right[node]!, e = right[node]! + count[node]!; i < e; i++) {
        const t = order[i]!, a = indices[t * 3]! * 3, b = indices[t * 3 + 1]! * 3, c = indices[t * 3 + 2]! * 3;
        // Möller–Trumbore, both faces.
        const e1x = p[b]! - p[a]!, e1y = p[b + 1]! - p[a + 1]!, e1z = p[b + 2]! - p[a + 2]!;
        const e2x = p[c]! - p[a]!, e2y = p[c + 1]! - p[a + 1]!, e2z = p[c + 2]! - p[a + 2]!;
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-14) continue;
        const inv = 1 / det, sx = ox - p[a]!, sy = oy - p[a + 1]!, sz = oz - p[a + 2]!;
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (dist >= 0 && dist < best) best = dist;
      }
    } else if (sp + 2 <= stack.length) { stack[sp++] = left[node]!; stack[sp++] = right[node]!; }
  }
  return best;
}
