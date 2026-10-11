/**
 * Part packs for the parts maker: a zip in the CharacterStudio layout (manifest.json beside the part
 * files). On import every part, thumbnail and texture is checked and stored as media (so the vault
 * and backups cover them); the manifest keeps its own paths and a map from each path to its file.
 * The built-in pack ships with the web app and only has an on/off switch here.
 */
import { unzipSync } from 'fflate';
import { packPath, packProblems, PackManifestSchema, type PackManifest } from '@everloom/engine';
import { HttpError, type AppContext } from '../../context.js';
import { newId } from '../../security/crypto.js';
import { deleteMedia, mediaUrl, saveImage, saveModelFile } from '../media.js';
import { isGlb, parseGlb } from './glb.js';

export const BUILTIN_PACKS = [{ id: 'basics', name: 'Everloom Basics', license: 'CC0 1.0', credits: 'Made by Everloom’s code-made character generator.', base: '/avatar/packs/basics/' }] as const;

export interface PackDTO {
  id: string;
  name: string;
  builtin: boolean;
  enabled: boolean;
  license: string;
  credits: string;
  /** Built-in packs: where their files are served. */
  base: string | null;
  /** Imported packs: each path in the pack → its file's URL. */
  files: Record<string, string> | null;
  manifest: PackManifest | null;
  parts: number;
  size: number;
  createdAt: number;
}

interface PackRow {
  id: string;
  owner_id: string;
  name: string;
  manifest: string | null;
  files: string;
  license: string;
  credits: string;
  enabled: number;
  size: number;
  created_at: number;
}

const MAX_FILES = 2000;

function dto(r: PackRow): PackDTO {
  const files = JSON.parse(r.files || '{}') as Record<string, string>;
  const manifest = r.manifest ? (JSON.parse(r.manifest) as PackManifest) : null;
  return {
    id: r.id,
    name: r.name,
    builtin: false,
    enabled: !!r.enabled,
    license: r.license,
    credits: r.credits,
    base: null,
    files: Object.fromEntries(Object.entries(files).map(([p, id]) => [p, mediaUrl(id)!])),
    manifest,
    parts: manifest?.traits.reduce((a, g) => a + g.collection.length, 0) ?? 0,
    size: r.size,
    createdAt: r.created_at,
  };
}

export function listPacks(ctx: AppContext, owner: string): PackDTO[] {
  const rows = ctx.db.prepare('SELECT * FROM avatar_packs WHERE owner_id = ? ORDER BY created_at').all(owner) as PackRow[];
  const builtin = BUILTIN_PACKS.map((b) => {
    const flag = rows.find((r) => r.id === b.id);
    return { id: b.id, name: `${b.name} (experimental)`, builtin: true, enabled: flag ? !!flag.enabled : false, license: b.license, credits: b.credits, base: b.base, files: null, manifest: null, parts: 0, size: 0, createdAt: 0 } satisfies PackDTO;
  });
  return [...builtin, ...rows.filter((r) => r.manifest).map(dto)];
}

/** Finds the manifest (at the root or in one top folder) and returns paths relative to it. */
function locate(files: Record<string, Uint8Array>): { manifest: unknown; root: string } {
  const names = Object.keys(files).filter((n) => !n.startsWith('__MACOSX/') && !n.endsWith('/'));
  const cands = names.filter((n) => /(^|\/)manifest\.json$/i.test(n)).sort((a, b) => a.split('/').length - b.split('/').length);
  if (!cands.length) throw new HttpError(400, 'This zip has no manifest.json (the CharacterStudio pack format needs one next to the parts).');
  const at = cands[0]!;
  try {
    return { manifest: JSON.parse(Buffer.from(files[at]!).toString('utf8')), root: at.slice(0, at.length - 'manifest.json'.length) };
  } catch {
    throw new HttpError(400, 'manifest.json is not valid JSON.');
  }
}

/** The license text that came with the pack (manifest, a LICENSE or README file, or the VRM's own meta). */
function findLicense(m: PackManifest, inZip: (p: string) => Uint8Array | undefined, names: string[], vrmLicense: string | null): string {
  if (m.everloom?.license) return m.everloom.license;
  const file = names.find((n) => /(^|\/)(licen[cs]e|copying)(\.(txt|md))?$/i.test(n));
  if (file) return Buffer.from(inZip(file)!).toString('utf8').trim().slice(0, 600);
  if (vrmLicense) return `From the models' own metadata: ${vrmLicense}`;
  return 'Not stated. Only use packs you have the rights to.';
}

function vrmLicenseOf(bytes: Uint8Array): string | null {
  try {
    const g = parseGlb(Buffer.from(bytes));
    const ext = g.json.extensions as Record<string, any> | undefined;
    const m0 = ext?.VRM?.meta;
    const m1 = ext?.VRMC_vrm?.meta;
    if (m1) return [m1.licenseUrl, m1.commercialUsage && `commercial use: ${m1.commercialUsage}`, m1.allowRedistribution === false && 'no redistribution'].filter(Boolean).join(', ') || null;
    if (m0) return [m0.licenseName, m0.otherLicenseUrl, m0.commercialUssageName && `commercial use: ${m0.commercialUssageName}`].filter(Boolean).join(', ') || null;
  } catch {
    /* not a VRM */
  }
  return null;
}

export async function importPack(ctx: AppContext, owner: string, zip: Buffer, opts: { name?: string } = {}): Promise<PackDTO> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(zip));
  } catch {
    throw new HttpError(400, 'This file is not a zip.');
  }
  if (Object.keys(files).length > MAX_FILES) throw new HttpError(400, `A pack can hold up to ${MAX_FILES} files.`);
  const { manifest: raw, root } = locate(files);
  const parsed = PackManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0]!;
    throw new HttpError(400, `manifest.json doesn't match the pack format: ${i.path.join('.') || 'top level'} — ${i.message}`);
  }
  const m = parsed.data;
  const inZip = (p: string) => files[root + p];
  const problems = packProblems(m, (p) => !!inZip(p));
  // Every part must really be a GLB/VRM (by its bytes).
  for (const g of m.traits)
    for (const p of g.collection) {
      const b = inZip(packPath(m, p.directory));
      if (b && !isGlb(Buffer.from(b))) problems.push(`${g.trait}/${p.id}: "${p.directory}" is not a GLB or VRM file.`);
    }
  if (problems.length) throw new HttpError(400, `This pack can't be used:\n${problems.slice(0, 8).join('\n')}`);

  const id = newId('pk_');
  const map: Record<string, string> = {};
  const saved: string[] = [];
  let size = 0;
  let vrmLicense: string | null = null;
  try {
    for (const g of m.traits)
      for (const p of g.collection) {
        const rel = packPath(m, p.directory);
        if (map[rel]) continue;
        const bytes = Buffer.from(inZip(rel)!);
        vrmLicense ??= vrmLicenseOf(bytes);
        const row = saveModelFile(ctx, owner, bytes, { kind: 'model-part', ext: /\.vrm$/i.test(rel) ? 'vrm' : 'glb', meta: { pack: id, path: rel } });
        map[rel] = row.id;
        saved.push(row.id);
        size += bytes.length;
      }
    // Pictures: part thumbnails, texture choices, group icons. A missing or broken picture is skipped.
    const pics = new Set<string>();
    for (const g of m.traits) for (const p of g.collection) if (p.thumbnail) pics.add(packPath(m, p.thumbnail, m.thumbnailsDirectory ? 'thumbnail' : 'trait'));
    for (const t of m.textureCollections ?? []) for (const c of t.collection) pics.add(packPath(m, c.directory, 'asset'));
    for (const rel of pics) {
      const bytes = inZip(rel);
      if (!bytes || map[rel]) continue;
      try {
        const row = await saveImage(ctx, owner, Buffer.from(bytes), { kind: 'model-part-image', maxDim: 1024, meta: { pack: id, path: rel } });
        map[rel] = row.id;
        saved.push(row.id);
        size += row.size;
      } catch {
        /* skipped */
      }
    }
  } catch (e) {
    for (const s of saved) deleteMedia(ctx, owner, s);
    throw e;
  }
  const names = Object.keys(files);
  const name = (opts.name || m.everloom?.name || root.replace(/\/$/, '').split('/').pop() || 'Part pack').slice(0, 80);
  const license = findLicense(m, (p) => files[p], names, vrmLicense);
  const credits = (m.everloom?.credits ?? (Array.isArray(m.vrmMeta?.authors) ? `By ${(m.vrmMeta!.authors as string[]).join(', ')}` : '')).slice(0, 4000);
  ctx.db
    .prepare('INSERT INTO avatar_packs (id, owner_id, name, manifest, files, license, credits, enabled, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .run(id, owner, name, JSON.stringify(m), JSON.stringify(map), license, credits, size, Date.now());
  return dto(ctx.db.prepare('SELECT * FROM avatar_packs WHERE id = ?').get(id) as PackRow);
}

export function setPackEnabled(ctx: AppContext, owner: string, id: string, enabled: boolean) {
  const builtin = BUILTIN_PACKS.find((b) => b.id === id);
  if (builtin) {
    ctx.db
      .prepare("INSERT INTO avatar_packs (id, owner_id, name, manifest, files, license, credits, enabled, size, created_at) VALUES (?, ?, ?, NULL, '{}', '', '', ?, 0, ?) ON CONFLICT(owner_id, id) DO UPDATE SET enabled = excluded.enabled")
      .run(id, owner, builtin.name, enabled ? 1 : 0, Date.now());
  } else {
    const r = ctx.db.prepare('UPDATE avatar_packs SET enabled = ? WHERE id = ? AND owner_id = ?').run(enabled ? 1 : 0, id, owner);
    if (!r.changes) throw new HttpError(404, 'Pack not found');
  }
  return listPacks(ctx, owner).find((p) => p.id === id)!;
}

export function deletePack(ctx: AppContext, owner: string, id: string) {
  if (BUILTIN_PACKS.some((b) => b.id === id)) throw new HttpError(400, 'The built-in pack can be turned off, not deleted');
  const r = ctx.db.prepare('SELECT * FROM avatar_packs WHERE id = ? AND owner_id = ?').get(id, owner) as PackRow | undefined;
  if (!r) throw new HttpError(404, 'Pack not found');
  // Characters made from it keep working: their parts are their own copies (see the maker's save).
  for (const mediaId of Object.values(JSON.parse(r.files) as Record<string, string>)) {
    const used = ctx.db.prepare("SELECT 1 FROM avatars WHERE owner_id = ? AND (model_media = ? OR config LIKE '%' || ? || '%') LIMIT 1").get(owner, mediaId, mediaId);
    if (!used) deleteMedia(ctx, owner, mediaId);
  }
  ctx.db.prepare('DELETE FROM avatar_packs WHERE id = ? AND owner_id = ?').run(id, owner);
  return { ok: true };
}
