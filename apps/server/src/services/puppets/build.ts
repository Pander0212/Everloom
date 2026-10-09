/**
 * A See-through result → a rigged puppet (puppet.json and texture pages). Shared by the server's
 * "make a puppet from a picture" job and tools/puppets/build-from-layers.ts.
 *
 * Reads `<name>/layers.json` and its layer PNGs (written by the worker next to its PSD) and, when
 * present, `<name>/topwear_depth.png` (the torso layer's depth, for the chest).
 */
import { buildTemplateRig, checkPuppet, mapLayers, parsePuppet, type LayerImage, type PuppetModel } from '@everloom/engine';
import sharp from 'sharp';
import { packAtlas, puppetJson, trimRgba, type PartImage } from './atlas.js';

export interface LayersIndex { width: number; height: number; layers: Array<{ name: string; file: string; left: number; top: number; width: number; height: number }> }

export interface BuiltPuppet { model: PuppetModel; json: string; pages: Buffer[]; tags: string[] }

/** `read(path)` returns a file of the result (paths relative to the result's root) or null. */
export async function puppetFromLayers(read: (p: string) => Buffer | null, name: string, o: { id: string; title: string; rating?: 'all-ages' | '18+'; bounce?: number }): Promise<BuiltPuppet> {
  const idx = read(`${name}/layers.json`);
  if (!idx) throw new Error('The layering result has no layers.json (is the worker up to date?)');
  const index = JSON.parse(idx.toString('utf8')) as LayersIndex;
  const W = index.width, H = index.height;
  if (!(W > 0 && H > 0 && W <= 4096 && H <= 4096)) throw new Error('The layering result has an odd canvas size');
  const layers: LayerImage[] = [];
  for (const l of index.layers) {
    const png = read(`${name}/${l.file}`);
    if (!png) continue;
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const full = new Uint8Array(W * H * 4);
    for (let y = 0; y < info.height; y++) {
      const ty = l.top + y;
      if (ty < 0 || ty >= H) continue;
      for (let x = 0; x < info.width; x++) {
        const tx = l.left + x;
        if (tx < 0 || tx >= W) continue;
        const s = (y * info.width + x) * 4, d = (ty * W + tx) * 4;
        full[d] = data[s]!; full[d + 1] = data[s + 1]!; full[d + 2] = data[s + 2]!; full[d + 3] = data[s + 3]!;
      }
    }
    layers.push({ name: l.name, rgba: full });
  }
  let topwearDepth: Uint8Array | undefined;
  const dp = read(`${name}/topwear_depth.png`);
  if (dp) {
    const { data, info } = await sharp(dp).greyscale().raw().toBuffer({ resolveWithObject: true });
    if (info.width === W && info.height === H) topwearDepth = new Uint8Array(data.buffer, data.byteOffset, W * H);
  }
  let source: Uint8Array | undefined;
  const sp = read(`${name}/src_img.png`);
  if (sp) {
    const { data, info } = await sharp(sp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width === W && info.height === H) source = new Uint8Array(data.buffer, data.byteOffset, W * H * 4);
  }
  const mapped = mapLayers({ width: W, height: H, layers, topwearDepth, source });
  const images: PartImage[] = [];
  for (const p of mapped.parts) {
    const t = await trimRgba(Buffer.from(p.rgba.buffer, p.rgba.byteOffset, p.rgba.length), W, H);
    if (t) images.push({ id: p.id, slot: p.slot, ...t, color: p.color });
  }
  const { pages, parts } = await packAtlas(images, { max: 2048, meshScale: 1 });
  const zOf = new Map(mapped.parts.map((p) => [p.id, p.z]));
  const model = buildTemplateRig(mapped.landmarks, parts.map((p) => ({ ...p, z: zOf.get(p.id) })), { id: o.id, name: o.title, template: 'everloom-f', rating: o.rating ?? 'all-ages', textures: pages.map((_, i) => `page${i}.png`), colors: mapped.colors, bounce: o.bounce });
  const c = checkPuppet(model);
  if (!c.ok) throw new Error(`The puppet didn't check out: ${c.errors.slice(0, 3).join('; ')}`);
  parsePuppet(JSON.parse(puppetJson(model))); // the format's own limits, as the player will read it
  return { model, json: puppetJson(model), pages, tags: mapped.tags };
}
