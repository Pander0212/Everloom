/**
 * A layered picture → puppet parts and template landmarks (docs/puppets.md › Making a template or
 * a character, step 3). The TypeScript twin of `tools/puppets/map.py`, so the server can turn a
 * See-through result into a puppet without Python: plain RGBA arrays in, full-canvas RGBA parts
 * out (the caller trims, packs and rigs them with `buildTemplateRig`).
 *
 * - Layers are named by See-through's tags (maybe split `-l`/`-r`) and come back to front.
 * - Left and right are split at the face's centre, not by the names.
 * - Tags go to slots; the front hair below the cheeks becomes `hair.side`, the rest `hair.front`.
 * - The face carries the ears and the closed mouth; a closed eye is drawn from the lash layer;
 *   open mouths are simple shapes in a lip colour until drawn ones exist.
 * - Landmarks come from the parts; each breast from the depth of the torso layer, when given.
 * - Body parts keep the picture's own draw order (arms behind a top's straps, a waistband over it).
 */
import type { BustLandmark, TemplateLandmarks } from './schema.js';

export interface LayerImage {
  /** See-through's tag, e.g. `front hair`, `topwear`, `eyewhite-l`. */
  name: string;
  /** Full-canvas RGBA (width × height × 4), straight alpha. */
  rgba: Uint8Array;
}

export interface LayeredPicture {
  width: number;
  height: number;
  /** Back to front. */
  layers: LayerImage[];
  /** Depth of the torso layer (one byte per pixel, smaller = nearer), for the chest. */
  topwearDepth?: Uint8Array;
  /** The picture that was layered, on the same canvas (RGBA): what no layer holds is recovered. */
  source?: Uint8Array;
}

export interface MappedPart { id: string; slot: string; rgba: Uint8Array; color?: string; z?: number }
export interface MappedPuppet { width: number; height: number; parts: MappedPart[]; landmarks: TemplateLandmarks; colors: Record<string, string>; tags: string[] }

type Box = [number, number, number, number];

const SLOT: Record<string, string> = {
  'back hair': 'hair.back', topwear: 'top', bottomwear: 'bottom', legwear: 'legwear', footwear: 'shoes',
  neckwear: 'acc.body', objects: 'acc.body', headwear: 'acc.head', earwear: 'acc.head', eyewear: 'acc.head',
  tail: 'acc.back', wings: 'acc.back',
};
const COLOR: Record<string, string> = { 'hair.back': 'hair', top: 'cloth1', bottom: 'cloth2', legwear: 'cloth3' };
const ALIAS: Record<string, string> = { hairf: 'front hair', hairb: 'back hair', eyel: 'eyes', eyer: 'eyes', browl: 'eyebrow', browr: 'eyebrow', earl: 'ears', earr: 'ears' };

export function baseTag(name: string): string {
  let n = name.toLowerCase().trim();
  if (n.endsWith('-l') || n.endsWith('-r')) n = n.slice(0, -2);
  return ALIAS[n] ?? n;
}

/** Bounding box of pixels with alpha above `thr`: [x0, y0, x1, y1) or null. */
export function alphaBox(rgba: Uint8Array, W: number, H: number, thr = 24): Box | null {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W * 4;
    for (let x = 0; x < W; x++) if (rgba[row + x * 4 + 3]! > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

/** src over dst (straight alpha), as a new image. */
export function over(dst: Uint8Array, src: Uint8Array): Uint8Array {
  const out = new Uint8Array(dst.length);
  for (let i = 0; i < dst.length; i += 4) {
    const sa = src[i + 3]! / 255, da = dst[i + 3]! / 255, oa = sa + da * (1 - sa);
    if (oa <= 0) continue;
    for (let c = 0; c < 3; c++) out[i + c] = Math.round((src[i + c]! * sa + dst[i + c]! * da * (1 - sa)) / oa);
    out[i + 3] = Math.round(oa * 255);
  }
  return out;
}

/** The character's left half (the picture's right of `cx`) and right half. */
function splitLR(a: Uint8Array, W: number, cx: number): [Uint8Array, Uint8Array] {
  const l = a.slice(), r = a.slice(), c = Math.floor(cx);
  for (let i = 0; i < a.length; i += 4) { const x = (i / 4) % W; if (x < c) l[i + 3] = 0; else r[i + 3] = 0; }
  return [l, r];
}

/** Fills an anti-aliased ellipse (or its ring when `ring` > 0) of colour rgb into a. */
function ellipse(a: Uint8Array, W: number, H: number, cx: number, cy: number, rx: number, ry: number, rgb: [number, number, number], ring = 0) {
  if (rx <= 0 || ry <= 0) return;
  for (let y = Math.max(0, Math.floor(cy - ry - 2)); y <= Math.min(H - 1, Math.ceil(cy + ry + 2)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx - 2)); x <= Math.min(W - 1, Math.ceil(cx + rx + 2)); x++) {
      // Signed distance in pixels, approximately (scaled by the smaller radius).
      const d = (Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry) - 1) * Math.min(rx, ry);
      const cov = ring > 0 ? Math.max(0, Math.min(1, ring / 2 + 0.5 - Math.abs(d + ring / 2))) : Math.max(0, Math.min(1, 0.5 - d));
      if (cov <= 0) continue;
      const i = (y * W + x) * 4, sa = cov, da = a[i + 3]! / 255, oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) a[i + c] = Math.round((rgb[c]! * sa + a[i + c]! * da * (1 - sa)) / oa);
      a[i + 3] = Math.round(oa * 255);
    }
  }
}

function median(v: number[]): number { const s = [...v].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)]! : 0; }

/**
 * Each breast from the torso layer's depth: the nearest region of the upper torso (Otsu's split
 * of the depth values), one blob per side; an oval from its spread and the tip from its nearest 3%.
 */
export function measureBust(depth: Uint8Array, alpha: (i: number) => number, W: number, H: number, cx: number, top: number, bottom: number): { l: BustLandmark; r: BustLandmark } | null {
  const vals: number[] = [];
  const inRegion = (i: number) => { const y = Math.floor(i / W); return alpha(i) > 128 && y > top && y < bottom; };
  for (let i = 0; i < W * H; i++) if (inRegion(i)) vals.push(depth[i]!);
  if (vals.length < 500) return null;
  // Otsu over 64 bins.
  let lo = 255, hi = 0;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const bins = 64, width = Math.max(1e-6, (hi - lo) / bins), hist = new Array<number>(bins).fill(0);
  for (const v of vals) hist[Math.min(bins - 1, Math.floor((v - lo) / width))]!++;
  let best = -1, t = lo, w0 = 0, m0 = 0;
  const total = vals.length, mAll = hist.reduce((s, h, k) => s + h * (lo + k * width), 0);
  for (let k = 0; k < bins; k++) {
    w0 += hist[k]!; m0 += hist[k]! * (lo + k * width);
    const w1 = total - w0;
    if (!w0 || !w1) continue;
    const b = w0 * w1 * (m0 / w0 - (mAll - m0) / w1) ** 2;
    if (b > best) { best = b; t = lo + (k + 1) * width; }
  }
  const near = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (inRegion(i) && depth[i]! <= t) near[i] = 1;
  const out: Record<string, BustLandmark> = {};
  for (const side of ['l', 'r'] as const) {
    // The largest 8-connected blob on this side of the centre.
    const seen = new Uint8Array(W * H);
    let bestBlob: number[] = [];
    for (let i = 0; i < W * H; i++) {
      const x = i % W;
      if (!near[i] || seen[i] || (side === 'l' ? x < cx : x >= cx)) continue;
      const blob: number[] = [], stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const j = stack.pop()!; blob.push(j);
        const jx = j % W, jy = Math.floor(j / W);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = jx + dx, ny = jy + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || (side === 'l' ? nx < cx : nx >= cx)) continue;
          const k = ny * W + nx;
          if (near[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
      if (blob.length > bestBlob.length) bestBlob = blob;
    }
    if (bestBlob.length < 400) return null;
    let sx = 0, sy = 0;
    for (const j of bestBlob) { sx += j % W; sy += Math.floor(j / W); }
    const mx = sx / bestBlob.length, my = sy / bestBlob.length;
    let vx = 0, vy = 0;
    for (const j of bestBlob) { vx += (j % W - mx) ** 2; vy += (Math.floor(j / W) - my) ** 2; }
    const ds = bestBlob.map((j) => depth[j]!).sort((p, q) => p - q), cut = ds[Math.floor(ds.length * 0.03)]!;
    let tx = 0, ty = 0, tn = 0;
    for (const j of bestBlob) if (depth[j]! <= cut) { tx += j % W; ty += Math.floor(j / W); tn++; }
    out[side] = { cx: mx, cy: my, rx: 2 * Math.sqrt(vx / bestBlob.length), ry: 2 * Math.sqrt(vy / bestBlob.length), tip: [tx / tn, ty / tn] };
  }
  return { l: out.l!, r: out.r! };
}

export function mapLayers(pic: LayeredPicture): MappedPuppet {
  const { width: W, height: H } = pic;
  const N = W * H * 4;
  const merged = new Map<string, Uint8Array>(), order = new Map<string, number>();
  pic.layers.forEach((l, i) => {
    if (l.rgba.length !== N) throw new Error(`layer ${l.name} is not ${W}×${H}`);
    const t = baseTag(l.name);
    merged.set(t, merged.has(t) ? over(merged.get(t)!, l.rgba) : l.rgba);
    if (!order.has(t)) order.set(t, i);
  });
  const face = merged.get('face');
  if (!face) throw new Error('No face layer: is this a picture of a character, facing the viewer?');
  const fb = alphaBox(face, W, H)!;
  const cx = (fb[0] + fb[2]) / 2, R = (fb[2] - fb[0]) / 2;
  const parts: MappedPart[] = [], tagOf = new Map<string, string>(), byId = new Map<string, Uint8Array>();
  const put = (id: string, slot: string, rgba: Uint8Array, color?: string, tag?: string) => {
    if (!alphaBox(rgba, W, H, 8)) return;
    if (tag) tagOf.set(id, tag);
    parts.push({ id, slot, rgba, ...(color ? { color } : {}) });
    byId.set(id, rgba);
  };

  // ---- eyes and brows
  const eye = new Map<string, Uint8Array>();
  for (const [tag, k] of [['eyewhite', 'white'], ['irides', 'iris'], ['eyelash', 'lash']] as const) {
    const a = merged.get(tag);
    if (!a) continue;
    const [l, r] = splitLR(a, W, cx);
    eye.set(`l.${k}`, l); eye.set(`r.${k}`, r);
  }
  const lmEye: Record<string, { cx: number; cy: number; w: number; h: number }> = {};
  for (const s of ['l', 'r']) {
    const list = ['white', 'iris', 'lash'].map((k) => eye.get(`${s}.${k}`)).filter((x): x is Uint8Array => !!x);
    if (!list.length) continue;
    const u = list.reduce((acc, a) => over(acc, a), new Uint8Array(N));
    const b = alphaBox(u, W, H);
    if (!b) continue;
    lmEye[s] = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, w: b[2] - b[0], h: b[3] - b[1] };
    for (const k of ['white', 'iris', 'lash']) { const a = eye.get(`${s}.${k}`); if (a) put(`eye-${s}-${k}`, `eye.${s}.${k}`, a, k === 'iris' ? 'eyes' : undefined); }
  }
  // The closed eye: the lash squashed to a fifth of its height, flipped to bow downward, on the lid.
  for (const s of ['l', 'r']) {
    const lash = eye.get(`${s}.lash`), e = lmEye[s];
    if (!lash || !e) continue;
    const b = alphaBox(lash, W, H);
    if (!b) continue;
    const bw = b[2] - b[0], bh = b[3] - b[1], hh = Math.max(3, Math.floor(bh * 0.22)), ly = Math.floor(e.cy + e.h * 0.18);
    const c = new Uint8Array(N);
    for (let y = 0; y < hh; y++) for (let x = 0; x < bw; x++) {
      // Box-filter the rows that fold into this one (flipped vertically).
      const sy0 = b[1] + Math.floor(((hh - 1 - y) * bh) / hh), sy1 = b[1] + Math.max(Math.floor(((hh - y) * bh) / hh), Math.floor(((hh - 1 - y) * bh) / hh) + 1);
      let r = 0, g = 0, bl = 0, al = 0;
      for (let sy = sy0; sy < sy1; sy++) { const i = (sy * W + b[0] + x) * 4, aa = lash[i + 3]!; r += lash[i]! * aa; g += lash[i + 1]! * aa; bl += lash[i + 2]! * aa; al += aa; }
      const ty = ly + y;
      if (ty < 0 || ty >= H || !al) continue;
      const o = (ty * W + b[0] + x) * 4, n = sy1 - sy0;
      c[o] = Math.round(r / al); c[o + 1] = Math.round(g / al); c[o + 2] = Math.round(bl / al); c[o + 3] = Math.min(255, Math.round((al / n) * 1.6));
    }
    put(`eye-${s}-closed`, `eye.${s}.closed`, c);
  }
  const lmBrow: Record<string, { cx: number; cy: number; w: number }> = {};
  const brows = merged.get('eyebrow');
  if (brows) {
    const [l, r] = splitLR(brows, W, cx);
    for (const [s, a] of [['l', l], ['r', r]] as const) {
      const b = alphaBox(a, W, H);
      if (!b) continue;
      lmBrow[s] = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, w: b[2] - b[0] };
      put(`brow-${s}`, `brow.${s}`, a, 'hair');
    }
  }

  // ---- the face, with the ears behind and the closed mouth on it
  let f = face;
  const ears = merged.get('ears');
  if (ears) f = over(ears, f);
  const mouth = merged.get('mouth');
  const mb = mouth ? alphaBox(mouth, W, H) : null;
  if (mouth) f = over(f, mouth);
  put('face-skin', 'face', f, 'skin');
  const [mcx, mcy, mw] = mb ? [(mb[0] + mb[2]) / 2, (mb[1] + mb[3]) / 2, Math.max(8, (mb[2] - mb[0]) / 2)] : [cx, fb[1] + (fb[3] - fb[1]) * 0.8, R * 0.18];
  for (const [id, rx, ry, dy] of [['open', 0.55, 0.45, 0.25], ['wide', 0.8, 0.85, 0.5], ['o', 0.42, 0.7, 0.4], ['u', 0.3, 0.32, 0.15], ['e', 0.85, 0.35, 0.2], ['i', 0.95, 0.28, 0.12]] as const) {
    const m = new Uint8Array(N), ex = Math.floor(mcx), ey = Math.floor(mcy + mw * dy);
    ellipse(m, W, H, ex, ey, mw * rx, mw * ry, [120, 40, 50]);
    ellipse(m, W, H, ex, ey + mw * ry * 0.45, mw * rx * 0.55, Math.max(1, mw * ry * 0.35), [200, 100, 105]);
    ellipse(m, W, H, ex, ey, mw * rx, mw * ry, [60, 25, 30], Math.max(1, mw * 0.06));
    put(`mouth-${id}`, `mouth.${id}`, m);
  }
  const nose = merged.get('nose');
  if (nose) put('nose', 'nose', nose);

  // ---- hair: the fringe fades out over the side locks, which are whole from the cut down
  const fh = merged.get('front hair');
  if (fh) {
    const eyes = Object.values(lmEye);
    const ey = eyes.length ? eyes.reduce((s, e) => s + e.cy, 0) / eyes.length : fb[1] + R;
    const cut = Math.floor(ey + R * 0.35);
    const front = fh.slice(), side = fh.slice();
    for (let y = 0; y < H; y++) {
      const fade = Math.max(0, Math.min(1, (y - cut) / (R * 0.2)));
      for (let x = 0; x < W; x++) { const i = (y * W + x) * 4 + 3; front[i] = Math.round(front[i]! * (1 - fade)); if (y < cut) side[i] = 0; }
    }
    put('hair-front', 'hair.front', front, 'hair');
    put('hair-side', 'hair.side', side, 'hair');
  }

  // ---- the rest by tag
  const neck = merged.get('neck');
  if (neck) put('body-skin', 'body', neck, 'skin', 'neck');
  const armTop: Record<string, [number, number]> = {};
  const arms = merged.get('handwear');
  if (arms) {
    const [l, r] = splitLR(arms, W, cx);
    for (const [s, a] of [['l', l], ['r', r]] as const) {
      const b = alphaBox(a, W, H, 64);
      if (!b) continue;
      put(`arm-${s}`, `arm.${s}`, a, 'skin', 'handwear');
      // The shoulder: the median x of the arm's topmost rows, a little below its top.
      const xs: number[] = [];
      for (let y = b[1]; y < Math.min(H, b[1] + R * 0.35); y++) for (let x = b[0]; x < b[2]; x++) if (a[(y * W + x) * 4 + 3]! > 64) xs.push(x);
      armTop[s] = [median(xs), b[1] + R * 0.2];
    }
  }
  const skip = new Set(['face', 'ears', 'mouth', 'nose', 'eyewhite', 'irides', 'eyelash', 'eyebrow', 'front hair', 'neck', 'handwear', 'eyes', 'head']);
  for (const [t, a] of merged) {
    if (skip.has(t)) continue;
    const slot = SLOT[t];
    if (slot) put(t.replace(/ /g, '-'), slot, a, COLOR[slot], t);
  }

  // ---- landmarks
  const torso = new Uint8Array(W * H);
  for (const t of ['neck', 'topwear', 'bottomwear', 'legwear']) { const a = merged.get(t); if (a) for (let i = 0; i < W * H; i++) if (a[i * 4 + 3]! > 64) torso[i] = 1; }
  let bottom = 0;
  for (const l of pic.layers) { const b = alphaBox(l.rgba, W, H); if (b && b[3] > bottom) bottom = b[3]; }
  const widthAt = (yy: number) => {
    const y = Math.max(0, Math.min(H - 1, Math.floor(yy))), c = Math.floor(cx), row = y * W;
    if (!torso[row + c]) { let any = false; for (let x = 0; x < W; x++) if (torso[row + x]) { any = true; break; } if (!any) return R * 2; }
    let l = c, r = c;
    while (l > 0 && torso[row + l - 1]) l--;
    while (r < W - 1 && torso[row + r + 1]) r++;
    return Math.max(r - l, R);
  };
  const chin = fb[3];
  let shY = chin + R * 0.75, chestY = chin + R * 1.35, waistY = chin + R * 2.5, hipsY = chin + R * 3.3;
  const tb = merged.has('topwear') ? alphaBox(merged.get('topwear')!, W, H, 64) : null;
  const bb = merged.has('bottomwear') ? alphaBox(merged.get('bottomwear')!, W, H, 64) : null;
  if (tb) { shY = tb[1] + R * 0.3; chestY = tb[1] + (tb[3] - tb[1]) * 0.3; }
  if (tb && bb) {
    const lo = Math.floor(chestY + R * 0.6), hi = Math.floor(bb[1] + R * 0.2);
    let best = Infinity;
    for (let y = lo; y < hi; y++) { const w = widthAt(y); if (w < best) { best = w; waistY = y; } }
    hipsY = bb[1] + (bb[3] - bb[1]) * 0.4;
  }
  const eL = lmEye.l ?? { cx: cx + R * 0.4, cy: fb[1] + R, w: R * 0.4, h: R * 0.3 };
  const eR = lmEye.r ?? { cx: cx - R * 0.4, cy: fb[1] + R, w: R * 0.4, h: R * 0.3 };
  let hairTop = fb[1];
  for (const t of ['front hair', 'back hair']) { const a = merged.get(t); const b = a && alphaBox(a, W, H); if (b && b[1] < hairTop) hairTop = b[1]; }
  const shHalf = widthAt(shY) / 2;
  const nb = neck ? alphaBox(neck, W, H) : null;
  const landmarks: TemplateLandmarks = {
    canvas: [W, H],
    head: { cx, cy: (fb[1] + fb[3]) / 2, r: R, top: hairTop, chin },
    eyeL: eL, eyeR: eR,
    browL: lmBrow.l ?? { cx: eL.cx, cy: eL.cy - eL.h * 2, w: eL.w },
    browR: lmBrow.r ?? { cx: eR.cx, cy: eR.cy - eR.h * 2, w: eR.w },
    mouth: { cx: mcx, cy: mcy, w: Math.max(mw * 2.2, R * 0.4) },
    neck: { cx, cy: nb ? (nb[1] + nb[3]) / 2 : chin + R * 0.2 },
    shoulderR: armTop.r ?? [cx - shHalf * 0.85, shY], shoulderL: armTop.l ?? [cx + shHalf * 0.85, shY],
    chest: { cy: chestY, w: widthAt(chestY) },
    waist: { cy: waistY, w: widthAt(waistY) },
    hips: { cy: hipsY, w: widthAt(hipsY) },
    bottom,
  };
  const top = merged.get('topwear');
  if (pic.topwearDepth && top && pic.topwearDepth.length === W * H) {
    const sh = landmarks.shoulderL[1], hy = landmarks.hips.cy;
    const bust = measureBust(pic.topwearDepth, (i) => top[i * 4 + 3]!, W, H, cx, sh, hy + (hy - sh) * 0.3);
    if (bust) { landmarks.bustL = bust.l; landmarks.bustR = bust.r; }
  }

  // ---- what no layer holds (See-through sometimes drops a tag, e.g. a picture's shoes): solid
  // pieces below the hips, away from the canvas edge, become `shoes`, just above the legs.
  if (pic.source && pic.source.length === N) {
    const left = new Uint8Array(W * H);
    for (let y = Math.floor(landmarks.hips.cy); y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (pic.source[i * 4 + 3]! <= 160) continue;
      let c = 0;
      for (const l of pic.layers) { const a = l.rgba[i * 4 + 3]!; if (a > c) c = a; }
      if (c < 64) left[i] = 1;
    }
    // Shrunk by 3 px, thin strips (outline halos) vanish; each piece must keep 1500 px.
    const core = new Uint8Array(W * H);
    for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
      let all = 1;
      for (let dy = -3; dy <= 3 && all; dy++) for (let dx = -3; dx <= 3; dx++) if (!left[(y + dy) * W + x + dx]) { all = 0; break; }
      core[y * W + x] = all;
    }
    const seen = new Uint8Array(W * H), keep = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (!left[i] || seen[i]) continue;
      const comp: number[] = [], stack = [i];
      seen[i] = 1;
      let edge = false, coreN = 0;
      while (stack.length) {
        const j = stack.pop()!; comp.push(j); if (core[j]) coreN++;
        const x = j % W, y = (j - x) / W;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx;
          if (left[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
      if (!edge && comp.length >= 1500 && coreN >= 1500) for (const j of comp) keep[j] = 1;
    }
    let any = false;
    const rest = new Uint8Array(N);
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
      // Grown by 2 px so the piece overlaps what it meets.
      let k = 0;
      for (let dy = -2; dy <= 2 && !k; dy++) for (let dx = -2; dx <= 2; dx++) if (keep[(y + dy) * W + x + dx]) { k = 1; break; }
      const i = y * W + x;
      if (!k || pic.source[i * 4 + 3]! <= 8) continue;
      rest.set(pic.source.subarray(i * 4, i * 4 + 4), i * 4);
      any = true;
    }
    if (any) {
      put(parts.some((p) => p.id === 'footwear') ? 'feet-rest' : 'footwear', 'shoes', rest, undefined, 'footwear-rest');
      order.set('footwear-rest', (order.get('legwear') ?? 0) + 0.5);
    }
  }

  // ---- colour groups from the parts' opaque pixels
  const colors: Record<string, string> = {};
  for (const [id, grp] of [['back-hair', 'hair'], ['face-skin', 'skin'], ['topwear', 'cloth1'], ['bottomwear', 'cloth2'], ['eye-l-iris', 'eyes']] as const) {
    const a = byId.get(id);
    if (!a) continue;
    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    for (let i = 0; i < a.length; i += 16) if (a[i + 3]! > 200) { rs.push(a[i]!); gs.push(a[i + 1]!); bs.push(a[i + 2]!); }
    if (rs.length) colors[grp] = `#${[median(rs), median(gs), median(bs)].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  }

  // ---- body-level draw order from the picture's own
  const bodyish = (slot: string) => ['body', 'underwear', 'legwear', 'shoes', 'bottom', 'top', 'outer', 'acc', 'arm', 'sleeve'].includes(slot.split(':')[0]!.split('.')[0]!) && !slot.startsWith('acc.head');
  const bodyParts = parts.filter((p) => tagOf.has(p.id) && bodyish(p.slot));
  const ranks = [...new Set(bodyParts.map((p) => order.get(tagOf.get(p.id)!)!))].sort((p, q) => p - q);
  for (const p of bodyParts) p.z = 10 + ranks.indexOf(order.get(tagOf.get(p.id)!)!) * Math.min(2, 19 / Math.max(1, ranks.length));

  return { width: W, height: H, parts, landmarks, colors, tags: [...merged.keys()].sort() };
}
