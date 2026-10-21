/**
 * Puppets v2 kept by the owner (docs/puppets-v2/pipeline.md › Character packs). A pack is a zip:
 *
 *   character.json   { name, rating, physics?, views: { front: { keypoints, layers: [...] }, side?, threeQuarter?, back? } }
 *   <layer>.png      one picture per layer, named by the layer's `file` (default: "<view>/<id>.png")
 *
 * The decomposition job (tools/puppets2) writes such packs; so can an artist by hand. On import every
 * view is auto-rigged (`buildCharacter`: skeleton, skinned meshes, IK, physics, motions), and the
 * models and pictures are kept in the owner's media folder (vault-aware), served at
 * /api/puppets2/:id/…. Adult layers are only allowed in an 18+ pack, and the minor guard keeps such a
 * puppet off any character who is, or is described as, a minor (minor-guard.ts).
 */
import { ADULT_MIN_HEADS, buildCharacter, headsTall, KeypointsSchema, LayerSchema, type CharacterInput } from '@everloom/engine/puppet2';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { z } from 'zod';
import { HttpError, type AppContext } from '../../context.js';
import { readContentFile, writeContentFile } from '../../vault/vault.js';

export const VIEWS = ['front', 'threeQuarter', 'side', 'back'] as const;
export type View = (typeof VIEWS)[number];

export interface Puppet2Meta {
  id: string;
  name: string;
  rating: 'all-ages' | '18+';
  views: View[];
  /** Outfit sets the layers belong to (wardrobe), and whether there is an adult (nude) layer. */
  outfits: string[];
  adult: boolean;
  layers: number;
  /** Per view, the wardrobe facts of each part (the stage hides other outfits and, dressed, the adult layers). */
  parts: Partial<Record<View, Array<{ id: string; outfit?: string; adult?: boolean }>>>;
  createdAt: number;
}

const SAFE = /^[A-Za-z0-9_-]{1,80}$/;
const FILE = /^[A-Za-z0-9_./-]{1,160}\.png$/;

const PackLayerSchema = LayerSchema.omit({ texture: true }).extend({ file: z.string().regex(FILE).optional() });
const ViewSchema = z.object({ keypoints: KeypointsSchema, layers: z.array(PackLayerSchema).min(1).max(1500) }).optional(); // (a whole wardrobe: its pictures load when worn)
const PackSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rating: z.enum(['all-ages', '18+']).default('all-ages'),
  physics: z.object({ bust: z.number().min(0).max(2), butt: z.number().min(0).max(2), hair: z.number().min(0).max(2) }).partial().optional(),
  views: z.object({ front: ViewSchema, threeQuarter: ViewSchema, side: ViewSchema, back: ViewSchema }),
});

export function puppets2Dir(ctx: AppContext, owner: string, ...parts: string[]) {
  if (!SAFE.test(owner) || parts.some((p) => !SAFE.test(p))) throw new HttpError(400, 'Bad id');
  const d = path.join(ctx.cfg.mediaDir, owner, 'puppets2', ...parts);
  mkdirSync(d, { recursive: true });
  return d;
}

export function listPuppets2(ctx: AppContext, owner: string): Puppet2Meta[] {
  const root = puppets2Dir(ctx, owner);
  const out: Puppet2Meta[] = [];
  for (const id of readdirSync(root)) {
    const f = path.join(root, id, 'meta.json');
    if (!SAFE.test(id) || !existsSync(f)) continue;
    try { out.push(JSON.parse(readContentFile(ctx.vault, f).toString('utf8')) as Puppet2Meta); } catch { /* being written */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function getPuppet2(ctx: AppContext, owner: string, id: string): Puppet2Meta | null {
  if (!SAFE.test(id)) return null;
  const f = path.join(ctx.cfg.mediaDir, owner, 'puppets2', id, 'meta.json');
  if (!existsSync(f)) return null;
  try { return JSON.parse(readContentFile(ctx.vault, f).toString('utf8')) as Puppet2Meta; } catch { return null; }
}

export function deletePuppet2(ctx: AppContext, owner: string, id: string) {
  rmSync(puppets2Dir(ctx, owner, id), { recursive: true, force: true });
}

/** Imports a character pack: validates it, auto-rigs every view and keeps the result. */
export async function importPuppet2(ctx: AppContext, owner: string, zip: Buffer, o: { name?: string; rating?: 'all-ages' | '18+' } = {}): Promise<Puppet2Meta> {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(zip); } catch { throw new HttpError(400, 'That is not a zip file'); }
  // The pack may sit in one folder inside the zip.
  const indexPath = Object.keys(files).find((p) => p === 'character.json' || /^[^/]+\/character\.json$/.test(p));
  if (!indexPath) throw new HttpError(400, 'No character.json in the zip');
  const base = indexPath.slice(0, -'character.json'.length);
  let raw: unknown;
  try { raw = JSON.parse(Buffer.from(files[indexPath]!).toString('utf8')); } catch { throw new HttpError(400, 'character.json is not valid JSON'); }
  const parsed = PackSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, `character.json: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const pack = parsed.data;
  const rating = o.rating ?? pack.rating;
  const views = VIEWS.filter((v) => pack.views[v]);
  if (!views.length) throw new HttpError(400, 'The pack has no views');
  const id = `p2_${randomUUID().slice(0, 12)}`;
  const dir = puppets2Dir(ctx, owner, id);
  const outfits = new Set<string>();
  let adult = false, layerCount = 0;
  const partsByView: Puppet2Meta['parts'] = {};
  try {
    for (const view of views) {
      const v = pack.views[view]!;
      const layers: CharacterInput['layers'] = [];
      const textures: CharacterInput['textures'] = [];
      let width = 0, height = 0;
      for (const l of v.layers) {
        const name = l.file ?? `${view}/${l.id}.png`;
        const png = files[`${base}${name}`];
        if (!png) throw new HttpError(400, `Missing picture ${name} for layer ${l.id}`);
        const meta = await sharp(Buffer.from(png)).metadata();
        if (meta.format !== 'png' || !meta.width || !meta.height) throw new HttpError(400, `${name} is not a PNG`);
        if (l.adult) {
          if (rating !== '18+') throw new HttpError(400, `Layer ${l.id} is marked adult: adult layers belong in an 18+ pack`);
          adult = true;
        }
        if (l.outfit) outfits.add(l.outfit);
        const tex = `${view}_${l.id}`;
        // Re-encoded: only the pixels are kept (no metadata, no trailing data).
        writeContentFile(ctx.vault, path.join(dir, `t_${tex}.png`), await sharp(Buffer.from(png)).png().toBuffer());
        textures.push({ id: tex, path: `t_${tex}.png`, width: meta.width, height: meta.height });
        const { file: _f, ...rest } = l;
        layers.push({ ...rest, texture: tex });
        width = Math.max(width, Math.ceil(l.rect[0] + l.rect[2]));
        height = Math.max(height, Math.ceil(l.rect[1] + l.rect[3]));
      }
      // Child proportions never carry an 18+ rating or adult layers (measured here, from the pack's own
      // landmarks: a pack can't claim its way past it).
      if ((rating === '18+' || layers.some((l) => l.adult)) && view !== 'side' && headsTall(v.keypoints) < ADULT_MIN_HEADS) {
        throw new HttpError(400, `The ${view} view is drawn with child proportions (${headsTall(v.keypoints).toFixed(1)} heads tall): 18+ packs and adult layers need an adult body (${ADULT_MIN_HEADS}+ heads).`);
      }
      layerCount += layers.length;
      partsByView[view] = layers.map((l) => ({ id: l.id, ...(l.outfit ? { outfit: l.outfit } : {}), ...(l.adult ? { adult: true } : {}) }));
      let model;
      try {
        // A child-proportioned body never gets bust or butt physics, whatever the pack asks for.
        const childlike = view !== 'side' && headsTall(v.keypoints) < ADULT_MIN_HEADS;
        model = buildCharacter({ name: pack.name, width, height, keypoints: { ...v.keypoints, view }, layers, textures, physics: { bust: 1, butt: 1, hair: 1, ...pack.physics, ...(childlike ? { bust: 0, butt: 0 } : {}) } });
      } catch (e) { throw new HttpError(400, `The ${view} view could not be rigged: ${(e as Error).message.slice(0, 300)}`); }
      writeContentFile(ctx.vault, path.join(dir, `${view}.r2d.json`), Buffer.from(JSON.stringify(model)));
    }
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  const meta: Puppet2Meta = { id, name: (o.name ?? pack.name).slice(0, 80), rating, views, outfits: [...outfits], adult, layers: layerCount, parts: partsByView, createdAt: Date.now() };
  writeContentFile(ctx.vault, path.join(dir, 'meta.json'), Buffer.from(JSON.stringify(meta)));
  return meta;
}
