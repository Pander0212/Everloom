/**
 * Packs part images into texture pages (shelf packing, 2 px gutters, power-of-two-friendly sizes)
 * and makes each part's mesh from its transparency. Shared by the placeholder build and the pack
 * builder.
 */
import sharp from 'sharp';
import { autoMesh, cellFor, type PuppetMesh } from '../../packages/engine/src/index.js';

export interface PartImage {
  id: string;
  slot: string;
  /** RGBA pixels, already trimmed to the part. */
  rgba: Buffer;
  width: number;
  height: number;
  /** Where the trimmed image's top-left sits in puppet space. */
  x: number;
  y: number;
  color?: string;
  name?: string;
}

export interface PackedPart { id: string; slot: string; texture: number; mesh: PuppetMesh; color?: string; name?: string }

/** Trims transparent borders; returns null when nothing is visible. */
export async function trimRgba(rgba: Buffer, width: number, height: number, threshold = 4): Promise<{ rgba: Buffer; width: number; height: number; x: number; y: number } | null> {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4 + 3]! > threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) rgba.copy(out, y * w * 4, ((y + y0) * width + x0) * 4, ((y + y0) * width + x0 + w) * 4);
  return { rgba: out, width: w, height: h, x: x0, y: y0 };
}

/** Packs parts into pages of at most `max` pixels square; returns PNG pages and meshed parts. */
export async function packAtlas(parts: PartImage[], o: { max?: number; meshScale?: number } = {}): Promise<{ pages: Buffer[]; parts: PackedPart[] }> {
  const max = o.max ?? 2048, gap = 2;
  const order = [...parts].sort((a, b) => b.height - a.height);
  const pages: Array<{ w: number; h: number; items: Array<{ p: PartImage; x: number; y: number }> }> = [];
  let page = { w: 0, h: 0, items: [] as Array<{ p: PartImage; x: number; y: number }> }, cx = 0, cy = 0, rowH = 0;
  for (const p of order) {
    if (p.width + gap > max || p.height + gap > max) throw new Error(`part ${p.id} (${p.width}x${p.height}) is larger than a ${max} px page`);
    if (cx + p.width + gap > max) { cx = 0; cy += rowH; rowH = 0; }
    if (cy + p.height + gap > max) { pages.push(page); page = { w: 0, h: 0, items: [] }; cx = 0; cy = 0; rowH = 0; }
    page.items.push({ p, x: cx + gap, y: cy + gap });
    cx += p.width + gap * 2; rowH = Math.max(rowH, p.height + gap * 2);
    page.w = Math.max(page.w, cx); page.h = Math.max(page.h, cy + rowH);
  }
  if (page.items.length) pages.push(page);
  const pngs: Buffer[] = [];
  const out: PackedPart[] = [];
  for (const [ti, pg] of pages.entries()) {
    const W = Math.ceil(pg.w / 4) * 4, H = Math.ceil(pg.h / 4) * 4;
    pngs.push(await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(pg.items.map(({ p, x, y }) => ({ input: p.rgba, raw: { width: p.width, height: p.height, channels: 4 as const }, left: x, top: y })))
      .png({ compressionLevel: 9 }).toBuffer());
    for (const { p, x, y } of pg.items) {
      const alpha = new Uint8Array(p.width * p.height);
      for (let i = 0; i < alpha.length; i++) alpha[i] = p.rgba[i * 4 + 3]!;
      const mesh = autoMesh({ width: p.width, height: p.height, alpha }, { cell: cellFor(p.slot, o.meshScale ?? 1), offset: [p.x, p.y], page: { x, y, width: W, height: H } });
      out.push({ id: p.id, slot: p.slot, texture: ti, mesh, color: p.color, name: p.name });
    }
  }
  // Back in the order the parts came in.
  const at = new Map(parts.map((p, i) => [p.id, i]));
  out.sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  return { pages: pngs, parts: out };
}
