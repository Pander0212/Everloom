/** Prepare licensed all-ages assets before installation; no upstream program code. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import sharp from 'sharp';
import { parseHumanObj } from '../../packages/engine/src/avatar/makehuman-data.ts';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const original = readFileSync(process.argv[2]);
if (digest(original) !== 'b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107') throw new Error('Unexpected system archive');
const files = unzipSync(original, { filter: file => /^(clothes|hair|eyes|eyebrows|eyelashes|teeth|tongue|skins)\//.test(file.name) && /\.(obj|mhclo|mhmat|png|jpe?g|webp)$/i.test(file.name) && !/genital|penis|vagina|nipple|anus|explicit/i.test(file.name) });
const core = unzipSync(readFileSync('apps/web/public/avatar/makehuman-core.zip'), { filter: file => file.name.endsWith('/3dobjs/base.obj') });
const base = parseHumanObj(new TextDecoder().decode(Object.values(core)[0]));
const body = base.faces.filter(face => face.group === 'body');
const ys = body.flatMap(face => face.vertices.map(v => base.vertices[v * 3 + 1]));
const top = Math.max(...ys), bottom = Math.min(...ys), cutoff = top - (top - bottom) * 0.19;
const head = body.filter(face => face.vertices.every(v => base.vertices[v * 3 + 1] >= cutoff));
if (head.length < 500) throw new Error('The safe head region could not be identified');
const maskFor = (width, height) => {
  const mask = new Uint8Array(width * height);
  const inside = (p, a, b, c) => {
    const cross = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
    const x = cross(a, b, p), y = cross(b, c, p), z = cross(c, a, p); return (x >= 0 && y >= 0 && z >= 0) || (x <= 0 && y <= 0 && z <= 0);
  };
  for (const face of head) {
    const uv = face.uv.map(index => { const p = base.uv[index]; return [p[0] * width, (1 - p[1]) * height]; });
    for (let t = 1; t < uv.length - 1; t++) {
      const triangle = [uv[0], uv[t], uv[t + 1]];
      const x0 = Math.max(0, Math.floor(Math.min(...triangle.map(p => p[0])))), x1 = Math.min(width - 1, Math.ceil(Math.max(...triangle.map(p => p[0]))));
      const y0 = Math.max(0, Math.floor(Math.min(...triangle.map(p => p[1])))), y1 = Math.min(height - 1, Math.ceil(Math.max(...triangle.map(p => p[1]))));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inside([x + 0.5, y + 0.5], ...triangle)) mask[y * width + x] = 1;
    }
  }
  // Small UV padding prevents seams without retaining unrelated body regions.
  const padded = mask.slice();
  for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) if (mask[y * width + x]) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) padded[(y + dy) * width + x + dx] = 1;
  return padded;
};
const masks = new Map();
for (const [name, bytes] of Object.entries(files)) {
  if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
  const decoded = await sharp(bytes).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (name.startsWith('skins/')) {
    const { width, height } = decoded.info, key = `${width}:${height}`;
    if (!masks.has(key)) masks.set(key, maskFor(width, height));
    const mask = masks.get(key), sum = [0, 0, 0]; let count = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) { for (let c = 0; c < 3; c++) sum[c] += decoded.data[i * 4 + c]; count++; }
    const neutral = /normal/i.test(name) ? [128, 128, 255] : sum.map(value => Math.round(value / Math.max(1, count)));
    for (let i = 0; i < mask.length; i++) if (!mask[i]) { for (let c = 0; c < 3; c++) decoded.data[i * 4 + c] = neutral[c]; decoded.data[i * 4 + 3] = 255; }
  }
  const pipeline = sharp(decoded.data, { raw: decoded.info });
  files[name] = await (/\.png$/i.test(name) ? pipeline.png() : /\.webp$/i.test(name) ? pipeline.webp({ quality: 90 }) : pipeline.jpeg({ quality: 92 })).toBuffer();
}
files['PROVENANCE.json'] = strToU8(JSON.stringify({ source: 'Official MakeHuman system assets CC0 archive', sourceSha256: digest(original), license: 'CC0-1.0', changes: 'Textures capped at 1024px for the starter pack. Skin maps retain only the head UV triangles plus two pixels of padding; the rest is a uniform sampled color. No anatomical body texture pixels or explicit assets are distributed. Meshes and proxy bindings unchanged.', bodyHeadCutoff: cutoff, headFaces: head.length }, null, 2));
files['LICENSE-CC0.txt'] = strToU8('MakeHuman system asset data: CC0 1.0 Universal. https://creativecommons.org/publicdomain/zero/1.0/legalcode\nCopyright holders credited in each original material and proxy header; modified textures described in PROVENANCE.json.\n');
const packed = zipSync(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, bytes]) => [name, [bytes, { mtime: new Date('2020-01-01T00:00:00Z') }]])), { level: 6 });
writeFileSync('apps/web/public/avatar/makehuman-system.zip', packed);
console.log(JSON.stringify({ sha256: digest(packed), bytes: packed.length, files: Object.keys(files).length, headFaces: head.length }));
