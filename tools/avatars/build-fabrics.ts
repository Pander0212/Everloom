/**
 * Fabric detail maps for code-made clothes, from generated tiles (docs/art/LEDGER.md, Phase 5).
 *
 *   npx tsx tools/avatars/build-fabrics.ts <raw folder>
 *
 * Each tile is cropped (generated images often have a border), its lighting flattened (a heavily
 * blurred copy divided out), turned into a neutral luminance map that is bright on average (so it
 * multiplies with the garment's own colour), made seamless, checked, scaled down and saved as WebP in
 * apps/web/public/avatar/fabrics. Regular weaves (knit, plaid) are cropped to a whole number of
 * repeats; irregular ones (denim, a scattered print) are blended across the seam.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { makeSeamless, seamScore } from '../../apps/server/src/services/avatars/textures.js';

const FABRICS: Array<{ name: string; file: string; regular: boolean; size: number; contrast: number; flatten?: boolean; minPeriod?: number }> = [
  { name: 'knit', file: '085-nano-z-image-turbo-fabric-knit.jpg', regular: true, size: 256, contrast: 1.2 },
  // Flat colour blocks: no lighting to flatten (dividing by a blur smears them); the repeat is big.
  { name: 'plaid', file: '086-nano-qwen-image-fabric-plaid.jpg', regular: true, size: 256, contrast: 1, flatten: false, minPeriod: 250 },
  { name: 'denim', file: '087-nano-z-image-turbo-fabric-denim2.jpg', regular: false, size: 256, contrast: 2.2 },
  { name: 'floral', file: '088-nano-qwen-image-fabric-floral.jpg', regular: false, size: 256, contrast: 1 },
];

/** The strongest repeat length (pixels) in a luminance profile, by autocorrelation. */
function period(profile: Float64Array, min: number, max: number): number {
  const n = profile.length;
  const mean = profile.reduce((a, b) => a + b, 0) / n;
  let best = 0;
  let bestScore = -Infinity;
  for (let p = min; p <= max; p++) {
    let s = 0;
    for (let i = 0; i + p < n; i++) s += (profile[i]! - mean) * (profile[i + p]! - mean);
    s /= n - p;
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

async function luminance(input: Buffer): Promise<{ data: Float64Array; w: number; h: number }> {
  const { data, info } = await sharp(input).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data: Float64Array.from(data, (v) => v / 255), w: info.width, h: info.height };
}

async function build(raw: string, f: (typeof FABRICS)[number]) {
  const src = sharp(path.join(raw, f.file));
  const meta = await src.metadata();
  const cut = Math.round((meta.width ?? 1024) * 0.03);
  let img = await src.extract({ left: cut, top: cut, width: meta.width! - cut * 2, height: meta.height! - cut * 2 }).png().toBuffer();
  // Flatten the lighting: divide by a heavy blur, keep the average.
  const { data, w, h } = await luminance(img);
  const blur = await luminance(await sharp(img).greyscale().blur(48).png().toBuffer());
  const flat = new Float64Array(w * h);
  let mean = 0;
  for (let i = 0; i < w * h; i++) mean += (flat[i] = f.flatten === false ? data[i]! : data[i]! / Math.max(0.05, blur.data[i]!));
  mean /= w * h;
  // Neutral and bright: average 0.82, the pattern's contrast kept (and lifted for faint weaves).
  const out = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.round(Math.max(0, Math.min(1, 0.82 + (flat[i]! / mean - 1) * 0.82 * f.contrast)) * 255);
  img = await sharp(out, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
  if (f.regular) {
    // A whole number of repeats each way, so the edges meet.
    const L = await luminance(img);
    const cols = new Float64Array(L.w);
    const rows = new Float64Array(L.h);
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) (cols[x] += L.data[y * L.w + x]!), (rows[y] += L.data[y * L.w + x]!);
    const px = period(cols, f.minPeriod ?? 40, Math.floor(L.w / 2));
    const py = period(rows, f.minPeriod ?? 40, Math.floor(L.h / 2));
    const nx = Math.max(1, Math.floor(L.w / px));
    const ny = Math.max(1, Math.floor(L.h / py));
    img = await sharp(img).extract({ left: 0, top: 0, width: px * nx, height: py * ny }).png().toBuffer();
    console.log(f.name, `period ${px}x${py}, ${nx}x${ny} repeats`);
  }
  let tile = await sharp(img).resize(f.size * 2, f.size * 2, { fit: 'fill' }).png().toBuffer();
  const before = await seamScore(await sharp(tile).toColourspace('srgb').png().toBuffer());
  if (!f.regular || before > 12) tile = await makeSeamless(tile, f.size * 2);
  const final = await sharp(tile).resize(f.size, f.size).greyscale().png().toBuffer();
  const after = await seamScore(await sharp(final).toColourspace('srgb').png().toBuffer());
  const file = path.join('apps/web/public/avatar/fabrics', `${f.name}.webp`);
  writeFileSync(file, await sharp(final).webp({ quality: 82 }).toBuffer());
  console.log(f.name, `seam ${before.toFixed(1)} → ${after.toFixed(1)}`, file);
}

const raw = process.argv[2] ?? '.art-raw';
for (const f of FABRICS) await build(raw, f);
