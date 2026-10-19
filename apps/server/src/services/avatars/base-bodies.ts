/**
 * The base-body pack: improved bodies for the character creator, made by Everloom's 3D generation
 * pipeline (docs/3d-gen) from Everloom's own bases, so they are generated assets and live in a
 * separate download, never in the repository. When installed, the creator builds new characters on
 * them instead of the bundled CC0 bases. They keep the bundled bases' topology, skeleton and shape
 * keys, so sliders, clothes, the anatomy pack and saved characters keep working.
 *
 * Pack format (a zip):
 *   bodies.json  { "format": "everloom-base-bodies", "version": 1, "name", "license",
 *                  "underwearFixed": false,                    // the all-ages pack sets true
 *                  "bases": { "<base id>": "<file>.glb" } }
 *   the GLBs it names.
 */
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { HttpError, type AppContext } from '../../context.js';
import { deleteMedia, mediaUrl, saveModelFile } from '../media.js';
import { getKv, setKv } from '../settings.js';

const KEY = 'base-body-pack';
const SAFE = /^[A-Za-z0-9_.-]{1,80}$/;

const ManifestSchema = z.object({
  format: z.literal('everloom-base-bodies'),
  version: z.literal(1),
  name: z.string().max(80).default('Base bodies'),
  license: z.string().max(300).default(''),
  underwearFixed: z.boolean().default(false),
  bases: z.partialRecord(z.enum(['anime-f', 'anime-m']), z.string().regex(SAFE)),
});

interface Installed { name: string; license: string; underwearFixed: boolean; installedAt: number; bases: Record<string, string> }

export function baseBodyPackStatus(ctx: AppContext, owner: string) {
  const p = getKv<Installed | null>(ctx, owner, KEY, null);
  if (!p) return { installed: false as const };
  return { installed: true as const, name: p.name, license: p.license, underwearFixed: p.underwearFixed, installedAt: p.installedAt, bases: Object.fromEntries(Object.entries(p.bases).map(([b, id]) => [b, mediaUrl(id)])) };
}

export function installBaseBodyPack(ctx: AppContext, owner: string, zip: Buffer) {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(zip); } catch { throw new HttpError(400, 'That is not a zip file.'); }
  if (Object.values(files).reduce((n, f) => n + f.length, 0) > 200 * 1024 * 1024) throw new HttpError(413, 'The pack is larger than 200 MB.');
  const json = files['bodies.json'];
  if (!json) throw new HttpError(400, 'This zip has no bodies.json: is it an Everloom base-body pack?');
  let manifest: z.infer<typeof ManifestSchema>;
  try { manifest = ManifestSchema.parse(JSON.parse(Buffer.from(json).toString('utf8'))); } catch (e) { throw new HttpError(400, `bodies.json is not valid: ${(e as Error).message.slice(0, 200)}`); }
  if (!Object.keys(manifest.bases).length) throw new HttpError(400, 'The pack names no bodies.');
  const created: string[] = [];
  try {
    const bases: Record<string, string> = {};
    for (const [base, file] of Object.entries(manifest.bases)) {
      const data = files[file];
      if (!data || Buffer.from(data.subarray(0, 4)).toString('latin1') !== 'glTF') throw new HttpError(400, `The ${base} body (${file}) is missing or not a GLB.`);
      const m = saveModelFile(ctx, owner, Buffer.from(data), { kind: 'model-base-body', ext: 'glb', meta: { base, pack: manifest.name } });
      created.push(m.id);
      bases[base] = m.id;
    }
    removeBaseBodyPack(ctx, owner);
    setKv(ctx, owner, KEY, { name: manifest.name, license: manifest.license, underwearFixed: manifest.underwearFixed, installedAt: Date.now(), bases } satisfies Installed);
  } catch (e) {
    for (const id of created) deleteMedia(ctx, owner, id);
    throw e;
  }
  return baseBodyPackStatus(ctx, owner);
}

export function removeBaseBodyPack(ctx: AppContext, owner: string) {
  const p = getKv<Installed | null>(ctx, owner, KEY, null);
  if (p) for (const id of Object.values(p.bases)) deleteMedia(ctx, owner, id);
  setKv(ctx, owner, KEY, null);
  return baseBodyPackStatus(ctx, owner);
}
