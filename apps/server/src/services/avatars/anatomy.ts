/**
 * The anatomy pack: shape keys and texture layers for the character creator's bases, in a separate
 * download (never in Everloom's repository). Installing it needs no unlock; it is used directly by
 * the creator's Anatomy tab. The minor guard (services/minor-guard.ts) still refuses anatomy on a
 * character under 18 or described as a child, whatever the request.
 *
 * Pack format (a zip):
 *   anatomy.json  { "format": "everloom-anatomy", "version": 1, "name", "license",
 *                   "bases": { "<base id>": { "vertices": <body vertex count>,
 *                     "shapeKeys": { "<name>": "<file>.bin" },      // Float32 xyz per body vertex
 *                     "layers": { "<name>": "<file>.png" } } } }   // in the body's UV layout
 *   the .bin and .png files it names.
 * tools/anatomy/build-pack.ts makes one from the CC0 MakeHuman data (written outside the repo).
 */
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { HttpError, type AppContext } from '../../context.js';
import { deleteMedia, mediaUrl, saveModelFile } from '../media.js';
import { getKv, setKv } from '../settings.js';

const KEY = 'anatomy-pack';
const SAFE = /^[A-Za-z0-9_.-]{1,80}$/;

const ManifestSchema = z.object({
  format: z.literal('everloom-anatomy'),
  version: z.literal(1),
  name: z.string().max(80).default('Anatomy pack'),
  license: z.string().max(200).default(''),
  bases: z.record(z.enum(['anime-f', 'anime-m']), z.object({
    vertices: z.number().int().positive().max(100000),
    shapeKeys: z.record(z.string().regex(SAFE), z.string().regex(SAFE)).default({}),
    layers: z.record(z.string().regex(SAFE), z.string().regex(SAFE)).default({}),
  })),
});

interface Installed { name: string; license: string; installedAt: number; bases: Record<string, { vertices: number; shapeKeys: Record<string, string>; layers: Record<string, string> }> }

export function anatomyPackStatus(ctx: AppContext, owner: string) {
  const p = getKv<Installed | null>(ctx, owner, KEY, null);
  if (!p) return { installed: false as const };
  const urls = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, id]) => [k, mediaUrl(id)]));
  return { installed: true as const, name: p.name, license: p.license, installedAt: p.installedAt, bases: Object.fromEntries(Object.entries(p.bases).map(([b, v]) => [b, { vertices: v.vertices, shapeKeys: urls(v.shapeKeys), layers: urls(v.layers) }])) };
}

export function installAnatomyPack(ctx: AppContext, owner: string, zip: Buffer) {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(zip); } catch { throw new HttpError(400, 'That is not a zip file.'); }
  const total = Object.values(files).reduce((n, f) => n + f.length, 0);
  if (total > 300 * 1024 * 1024) throw new HttpError(413, 'The pack is larger than 300 MB.');
  const json = files['anatomy.json'];
  if (!json) throw new HttpError(400, 'This zip has no anatomy.json: is it an Everloom anatomy pack?');
  let manifest: z.infer<typeof ManifestSchema>;
  try { manifest = ManifestSchema.parse(JSON.parse(Buffer.from(json).toString('utf8'))); } catch (e) { throw new HttpError(400, `anatomy.json is not valid: ${(e as Error).message.slice(0, 200)}`); }
  const created: string[] = [];
  try {
    const bases: Installed['bases'] = {};
    for (const [base, b] of Object.entries(manifest.bases)) {
      const keys: Record<string, string> = {}, layers: Record<string, string> = {};
      for (const [name, file] of Object.entries(b.shapeKeys)) {
        const data = files[file];
        if (!data || data.length !== b.vertices * 12) throw new HttpError(400, `Shape key ${name} (${file}) is missing or not ${b.vertices} vertices.`);
        const m = saveModelFile(ctx, owner, Buffer.from(data), { kind: 'model-anatomy', ext: 'bin', meta: { adult: true, anatomy: name, base } });
        created.push(m.id); keys[name] = m.id;
      }
      for (const [name, file] of Object.entries(b.layers)) {
        const data = files[file];
        if (!data || Buffer.from(data.subarray(0, 4)).toString('hex') !== '89504e47') throw new HttpError(400, `Layer ${name} (${file}) is missing or not a PNG.`);
        const m = saveModelFile(ctx, owner, Buffer.from(data), { kind: 'model-anatomy', ext: 'png', meta: { adult: true, anatomy: name, base } });
        created.push(m.id); layers[name] = m.id;
      }
      bases[base] = { vertices: b.vertices, shapeKeys: keys, layers };
    }
    removeAnatomyPack(ctx, owner);
    setKv(ctx, owner, KEY, { name: manifest.name, license: manifest.license, installedAt: Date.now(), bases } satisfies Installed);
  } catch (e) {
    for (const id of created) deleteMedia(ctx, owner, id);
    throw e;
  }
  return anatomyPackStatus(ctx, owner);
}

export function removeAnatomyPack(ctx: AppContext, owner: string) {
  const p = getKv<Installed | null>(ctx, owner, KEY, null);
  if (!p) return anatomyPackStatus(ctx, owner);
  for (const b of Object.values(p.bases)) for (const id of [...Object.values(b.shapeKeys), ...Object.values(b.layers)]) deleteMedia(ctx, owner, id);
  setKv(ctx, owner, KEY, null);
  return anatomyPackStatus(ctx, owner);
}
