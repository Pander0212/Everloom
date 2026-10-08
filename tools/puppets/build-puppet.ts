/**
 * Builds a rigged puppet from a folder of part images (docs/puppets.md › Making a template or a
 * character, step 5): each part is a full-canvas RGBA PNG in its slot, listed in `parts.json`, with
 * the template landmarks in `landmarks.json` (both written by `tools/puppets/map.py`).
 *
 *   npx tsx tools/puppets/build-puppet.ts <parts dir> <out dir> [--id x] [--name X] [--rating 18+]
 *
 * parts.json: { "parts": [{ "id", "slot", "file", "color"?, "z"? }], "colors"?: { group: "#rrggbb" } }
 * Writes <out>/puppet.json and <out>/page<i>.png. Output is art: it belongs in .puppets-work/ or a
 * pack, never in the repository (scripts/check-pack-art.mjs).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { buildTemplateRig, checkPuppet, type TemplateLandmarks } from '../../packages/engine/src/index.js';
import { packAtlas, puppetJson, trimRgba, type PartImage } from './atlas.js';

const { values: o, positionals: [src, dst] } = parseArgs({ allowPositionals: true, options: { id: { type: 'string' }, name: { type: 'string' }, template: { type: 'string', default: 'everloom-f' }, rating: { type: 'string', default: 'all-ages' } } });
if (!src || !dst) { console.error('usage: build-puppet.ts <parts dir> <out dir> [--id x] [--name X] [--rating 18+]'); process.exit(1); }

interface PartsFile { parts: Array<{ id: string; slot: string; file: string; color?: string; z?: number }>; colors?: Record<string, string> }

async function main() {
  const spec = JSON.parse(readFileSync(path.join(src!, 'parts.json'), 'utf8')) as PartsFile;
  const L = JSON.parse(readFileSync(path.join(src!, 'landmarks.json'), 'utf8')) as TemplateLandmarks;
  const images: PartImage[] = [];
  for (const p of spec.parts) {
    const { data, info } = await sharp(path.join(src!, p.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const t = await trimRgba(data, info.width, info.height);
    if (!t) { console.warn(`skipped ${p.id}: empty`); continue; }
    images.push({ id: p.id, slot: p.slot, ...t, color: p.color });
  }
  const { pages, parts } = await packAtlas(images, { max: 2048, meshScale: 1 });
  const id = o.id ?? path.basename(path.resolve(src!));
  const zOf = new Map(spec.parts.map((p) => [p.id, p.z]));
  const model = buildTemplateRig(L, parts.map((p) => ({ ...p, z: zOf.get(p.id) })), { id, name: o.name ?? id, template: o.template!, rating: o.rating === '18+' ? '18+' : 'all-ages', textures: pages.map((_, i) => `page${i}.png`), colors: spec.colors });
  const c = checkPuppet(model);
  if (!c.ok) throw new Error(c.errors.join('\n'));
  mkdirSync(dst!, { recursive: true });
  writeFileSync(path.join(dst!, 'puppet.json'), puppetJson(model));
  pages.forEach((p, i) => writeFileSync(path.join(dst!, `page${i}.png`), p));
  console.log(`${id}: ${parts.length} parts, ${model.deformers.length} deformers, ${model.bindings.length} bindings, ${pages.length} page(s), ${parts.reduce((n, p) => n + p.mesh.positions.length / 2, 0)} vertices`);
}

void main();
