/**
 * Surface nets: a smooth, fairly even mesh of a distance field's zero surface. The field is first
 * sampled on a coarse grid; only fine points near the surface are evaluated exactly (the rest take
 * the coarse value), which keeps a whole character to a few hundred thousand evaluations.
 */
import { evalField, fieldBox, type Field, type V3 } from './sdf';

export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export function mesh(f: Field, cell: number, box?: [V3, V3]): Mesh {
  const [lo, hi] = box ?? fieldBox(f, cell * 2);
  const nx = Math.max(1, Math.ceil((hi[0] - lo[0]) / cell / 4)) * 4 + 1;
  const ny = Math.max(1, Math.ceil((hi[1] - lo[1]) / cell / 4)) * 4 + 1;
  const nz = Math.max(1, Math.ceil((hi[2] - lo[2]) / cell / 4)) * 4 + 1;
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const val = new Float32Array(nx * ny * nz);
  // Coarse pass (every 4th point), then exact values only within a band of the surface.
  const C = 4;
  const band = cell * C * 1.8;
  for (let k = 0; k < nz; k += C) for (let j = 0; j < ny; j += C) for (let i = 0; i < nx; i += C) val[at(i, j, k)] = evalField(f, lo[0] + i * cell, lo[1] + j * cell, lo[2] + k * cell);
  for (let k = 0; k < nz; k++) {
    const k0 = Math.min(nz - 1, k - (k % C));
    const k1 = Math.min(nz - 1, k0 + C);
    const tk = k0 === k1 ? 0 : (k - k0) / (k1 - k0);
    for (let j = 0; j < ny; j++) {
      const j0 = Math.min(ny - 1, j - (j % C));
      const j1 = Math.min(ny - 1, j0 + C);
      const tj = j0 === j1 ? 0 : (j - j0) / (j1 - j0);
      for (let i = 0; i < nx; i++) {
        if (i % C === 0 && j % C === 0 && k % C === 0) continue;
        const i0 = Math.min(nx - 1, i - (i % C));
        const i1 = Math.min(nx - 1, i0 + C);
        const ti = i0 === i1 ? 0 : (i - i0) / (i1 - i0);
        // Trilinear from the coarse corners.
        const c = (a: number, b: number, cc: number) => val[at(a, b, cc)]!;
        const x00 = c(i0, j0, k0) * (1 - ti) + c(i1, j0, k0) * ti;
        const x10 = c(i0, j1, k0) * (1 - ti) + c(i1, j1, k0) * ti;
        const x01 = c(i0, j0, k1) * (1 - ti) + c(i1, j0, k1) * ti;
        const x11 = c(i0, j1, k1) * (1 - ti) + c(i1, j1, k1) * ti;
        const v = (x00 * (1 - tj) + x10 * tj) * (1 - tk) + (x01 * (1 - tj) + x11 * tj) * tk;
        val[at(i, j, k)] = Math.abs(v) < band ? evalField(f, lo[0] + i * cell, lo[1] + j * cell, lo[2] + k * cell) : v;
      }
    }
  }

  // One vertex per cell that the surface passes through, at the mean of its edge crossings.
  const vid = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos: number[] = [];
  const corner = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ] as const;
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ] as const;
  const g = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [a, b, cc] = corner[c]!;
          g[c] = val[at(i + a, j + b, k + cc)]!;
          if (g[c]! < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [e0, e1] of edges) {
          const d0 = g[e0]!;
          const d1 = g[e1]!;
          if (d0 < 0 === d1 < 0) continue;
          const t = d0 / (d0 - d1);
          const [a0, b0, c0] = corner[e0]!;
          const [a1, b1, c1] = corner[e1]!;
          sx += a0 + (a1 - a0) * t;
          sy += b0 + (b1 - b0) * t;
          sz += c0 + (c1 - c0) * t;
          n++;
        }
        vid[cid(i, j, k)] = pos.length / 3;
        pos.push(lo[0] + (i + sx / n) * cell, lo[1] + (j + sy / n) * cell, lo[2] + (k + sz / n) * cell);
      }

  // A quad for every grid edge the surface crosses, joining the four cells around it.
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c);
    else idx.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = val[at(i, j, k)]! < 0;
        if (a === val[at(i + 1, j, k)]! < 0) continue;
        quad(vid[cid(i, j - 1, k - 1)]!, vid[cid(i, j, k - 1)]!, vid[cid(i, j, k)]!, vid[cid(i, j - 1, k)]!, !a);
      }
  for (let k = 1; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const a = val[at(i, j, k)]! < 0;
        if (a === val[at(i, j + 1, k)]! < 0) continue;
        quad(vid[cid(i - 1, j, k - 1)]!, vid[cid(i - 1, j, k)]!, vid[cid(i, j, k)]!, vid[cid(i, j, k - 1)]!, !a);
      }
  for (let k = 0; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const a = val[at(i, j, k)]! < 0;
        if (a === val[at(i, j, k + 1)]! < 0) continue;
        quad(vid[cid(i - 1, j - 1, k)]!, vid[cid(i, j - 1, k)]!, vid[cid(i, j, k)]!, vid[cid(i - 1, j, k)]!, !a);
      }

  // Normals from the field's gradient (smooth shading without seams).
  const normals = new Float32Array(pos.length);
  const e = cell * 0.5;
  for (let v = 0; v < pos.length; v += 3) {
    const x = pos[v]!;
    const y = pos[v + 1]!;
    const z = pos[v + 2]!;
    const gx = evalField(f, x + e, y, z) - evalField(f, x - e, y, z);
    const gy = evalField(f, x, y + e, z) - evalField(f, x, y - e, z);
    const gz = evalField(f, x, y, z + e) - evalField(f, x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    normals[v] = gx / l;
    normals[v + 1] = gy / l;
    normals[v + 2] = gz / l;
  }
  return { positions: Float32Array.from(pos), normals, indices: Uint32Array.from(idx) };
}
