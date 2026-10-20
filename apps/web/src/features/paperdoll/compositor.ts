/**
 * The paper-doll compositor: draws a character into a template by the engine's plan (layers by
 * trait, z order, recolour, cages). Each layer is recoloured with its mask and warped by the body
 * cages (a triangle mesh, each triangle an affine draw), then stacked into one canvas. Results are
 * cached by the plan's key, so a composite is rebuilt only when something that changes pixels does.
 */
import { compositeKey, deformPoints, recolorPixels, type SlotPlan, type Template } from '@everloom/engine/studio';

const images = new Map<string, Promise<HTMLImageElement>>();
const cache = new Map<string, HTMLCanvasElement>();
const CACHE_MAX = 24;

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(`Could not load ${url}`)); im.src = url; });
    p.catch(() => images.delete(url));
    images.set(url, p);
  }
  return p;
}

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/** Draws `src` warped by moving its grid points (rest → moved), as affine-mapped triangles. */
function drawWarped(dst: CanvasRenderingContext2D, src: CanvasImageSource, rect: [number, number, number, number], rest: Float32Array, moved: Float32Array, cols: number, rows: number) {
  const [x0, y0] = rect;
  const at = (a: Float32Array, r: number, c: number) => [a[(r * (cols + 1) + c) * 2]!, a[(r * (cols + 1) + c) * 2 + 1]!] as const;
  const tri = (s: ReadonlyArray<readonly [number, number]>, d: ReadonlyArray<readonly [number, number]>) => {
    const [[sx0, sy0], [sx1, sy1], [sx2, sy2]] = s, [[dx0, dy0], [dx1, dy1], [dx2, dy2]] = d;
    const den = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0);
    if (Math.abs(den) < 1e-9) return;
    // The affine map taking the source triangle onto the destination one.
    const a = ((dx1 - dx0) * (sy2 - sy0) - (dx2 - dx0) * (sy1 - sy0)) / den;
    const b = ((dy1 - dy0) * (sy2 - sy0) - (dy2 - dy0) * (sy1 - sy0)) / den;
    const c = ((dx2 - dx0) * (sx1 - sx0) - (dx1 - dx0) * (sx2 - sx0)) / den;
    const d2 = ((dy2 - dy0) * (sx1 - sx0) - (dy1 - dy0) * (sx2 - sx0)) / den;
    const e = dx0 - a * sx0 - c * sy0, f = dy0 - b * sx0 - d2 * sy0;
    dst.save();
    // Clip slightly larger than the triangle so neighbours overlap (no hairline seams).
    const cx = (dx0 + dx1 + dx2) / 3, cy = (dy0 + dy1 + dy2) / 3, g = (x: number, m: number) => m + (x - m) * 1.02;
    dst.beginPath(); dst.moveTo(g(dx0, cx), g(dy0, cy)); dst.lineTo(g(dx1, cx), g(dy1, cy)); dst.lineTo(g(dx2, cx), g(dy2, cy)); dst.closePath(); dst.clip();
    dst.setTransform(a, b, c, d2, e, f);
    dst.drawImage(src, x0, y0);
    dst.restore();
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const s = [at(rest, r, c), at(rest, r, c + 1), at(rest, r + 1, c + 1), at(rest, r + 1, c)];
    const d = [at(moved, r, c), at(moved, r, c + 1), at(moved, r + 1, c + 1), at(moved, r + 1, c)];
    if (s.every((p, i) => p[0] === d[i]![0] && p[1] === d[i]![1])) {
      // An undeformed cell: one plain copy.
      const [px, py] = s[0]!, [qx, qy] = s[2]!;
      dst.drawImage(src, px - x0, py - y0, qx - px, qy - py, px, py, qx - px, qy - py);
      continue;
    }
    tri([s[0]!, s[1]!, s[2]!], [d[0]!, d[1]!, d[2]!]);
    tri([s[0]!, s[2]!, s[3]!], [d[0]!, d[2]!, d[3]!]);
  }
}

/** One character composited into a template slot, full template size. */
export async function compositeSlot(t: Template, base: string, plan: SlotPlan): Promise<HTMLCanvasElement> {
  const key = compositeKey(t, plan);
  const hit = cache.get(key);
  if (hit) return hit;
  const out = canvas(t.width, t.height);
  const ctx = out.getContext('2d')!;
  const cages = plan.slot.cages;
  const deform = cages.some((c) => Math.abs(plan.sliders[c.slider] ?? 0) > 1e-3);
  for (const pl of plan.layers) {
    const l = pl.layer;
    const im = await loadImage(base + l.file);
    const [x, y, w, h] = l.rect;
    let src: CanvasImageSource = im;
    if (pl.recolor.length) {
      const c = canvas(w, h), g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(im, 0, 0, w, h);
      const data = g.getImageData(0, 0, w, h);
      for (const r of pl.recolor) {
        let mask: Uint8Array | undefined;
        if (r.mask) {
          const mi = await loadImage(base + r.mask), mc = canvas(w, h), mg = mc.getContext('2d', { willReadFrequently: true })!;
          mg.drawImage(mi, 0, 0, w, h);
          const md = mg.getImageData(0, 0, w, h).data;
          mask = new Uint8Array(w * h);
          for (let p = 0; p < w * h; p++) mask[p] = (md[p * 4]! * md[p * 4 + 3]!) / 255;
        }
        recolorPixels(data.data, r.kind, r.base, r.target, mask);
      }
      g.putImageData(data, 0, 0);
      src = c;
    }
    const mine = l.cages ? cages.filter((c) => l.cages!.includes(c.id)) : cages;
    if (!deform || !mine.length || l.part === 'background') { ctx.drawImage(src, x, y, w, h); continue; }
    const step = 12, cols = Math.max(1, Math.ceil(w / step)), rows = Math.max(1, Math.ceil(h / step));
    const rest = new Float32Array((cols + 1) * (rows + 1) * 2);
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) { const k = (r * (cols + 1) + c) * 2; rest[k] = x + Math.min(w, c * step); rest[k + 1] = y + Math.min(h, r * step); }
    const moved = rest.slice();
    deformPoints(moved, mine, plan.sliders);
    let srcCanvas = src;
    if (!(src instanceof HTMLCanvasElement)) { const c = canvas(w, h); c.getContext('2d')!.drawImage(src, 0, 0, w, h); srcCanvas = c; }
    drawWarped(ctx, srcCanvas, l.rect as [number, number, number, number], rest, moved, cols, rows);
  }
  cache.set(key, out);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return out;
}

/** The background (and POV) layers of a template, if any. */
export async function compositeExtras(t: Template, base: string, options: Record<string, string>): Promise<{ background: HTMLCanvasElement | null; pov: HTMLCanvasElement | null }> {
  const out: { background: HTMLCanvasElement | null; pov: HTMLCanvasElement | null } = { background: null, pov: null };
  for (const part of ['background', 'pov'] as const) {
    const ls = t.slots.flatMap((s) => s.layers).filter((l) => l.part === part && Object.entries(l.when).every(([k, v]) => !k.startsWith('option.') || ([] as unknown[]).concat(v).includes(options[k.slice(7)])));
    if (!ls.length) continue;
    const c = canvas(t.width, t.height), g = c.getContext('2d')!;
    for (const l of ls.sort((a, b) => a.z - b.z)) g.drawImage(await loadImage(base + l.file), ...(l.rect as [number, number, number, number]));
    out[part] = c;
  }
  return out;
}

export function clearCompositeCache() { cache.clear(); }
