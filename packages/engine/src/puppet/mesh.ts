/**
 * Meshes made automatically from a part's transparency: a grid laid over the image keeps every
 * cell that holds visible pixels (plus a one-cell margin, so deformation never cuts an edge), with
 * shared corners. Small cells where detail moves (eyes, brows, mouth), larger ones elsewhere.
 */
import type { PuppetMesh } from './format.js';

export interface AlphaImage { width: number; height: number; /** One byte per pixel. */ alpha: Uint8Array }

export interface AutoMeshOptions {
  /** Cell size in pixels. */
  cell: number;
  /** Alpha (0–255) above which a pixel counts as visible. */
  threshold?: number;
  /** Where the image's top-left sits in puppet space. */
  offset?: [number, number];
  /** Where the image sits in its texture page, in pixels, and the page's size. */
  page?: { x: number; y: number; width: number; height: number };
}

/** Cell size by slot: finer where the drawing moves in small ways. */
export function cellFor(slot: string, scale = 1): number {
  const base = /^(eye|brow|mouth|lash|iris|lid|tooth|teeth|tongue)/.test(slot) ? 10 : /^(face|nose|ear|blush|cheek)/.test(slot) ? 20 : /^hair/.test(slot) ? 28 : 40;
  return Math.max(4, Math.round(base * scale));
}

export function autoMesh(img: AlphaImage, o: AutoMeshOptions): PuppetMesh {
  const { width: W, height: H, alpha } = img;
  const cell = Math.max(2, Math.floor(o.cell));
  const thr = o.threshold ?? 8;
  const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell);
  const used = new Uint8Array(cols * rows);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (alpha[y * W + x]! > thr) used[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;
  // One-cell margin around everything visible.
  const keep = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!used[r * cols + c]) continue;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) keep[rr * cols + cc] = 1;
    }
  }
  const [ox, oy] = o.offset ?? [0, 0];
  const page = o.page ?? { x: 0, y: 0, width: W, height: H };
  const corner = new Map<number, number>();
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const vertex = (c: number, r: number) => {
    const key = r * (cols + 1) + c;
    let i = corner.get(key);
    if (i === undefined) {
      i = positions.length / 2;
      corner.set(key, i);
      const px = Math.min(W, c * cell), py = Math.min(H, r * cell);
      positions.push(ox + px, oy + py);
      uvs.push((page.x + px) / page.width, (page.y + py) / page.height);
    }
    return i;
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!keep[r * cols + c]) continue;
    const a = vertex(c, r), b = vertex(c + 1, r), d = vertex(c, r + 1), e = vertex(c + 1, r + 1);
    indices.push(a, b, e, a, e, d);
  }
  return { positions, uvs, indices };
}

/** A plain rectangle mesh (for parts that are a simple card, and tests). */
export function rectMesh(x: number, y: number, w: number, h: number, cols = 1, rows = 1, uv: [number, number, number, number] = [0, 0, 1, 1]): PuppetMesh {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    positions.push(x + (w * c) / cols, y + (h * r) / rows);
    uvs.push(uv[0] + (uv[2] * c) / cols, uv[1] + (uv[3] * r) / rows);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
    indices.push(a, b, e, a, e, d);
  }
  return { positions, uvs, indices };
}
