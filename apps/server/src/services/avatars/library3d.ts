/**
 * 3D in the asset library: avatar models, the garments and accessories they wear, and motion clips,
 * listed together with tags and search, exported as a zip and imported from one.
 *
 * Zip layout (the same avatar folders as character bundles):
 *   assets3d.json                 what is inside, with tags
 *   avatars/<slug>/avatar.json    a model with its garments and accessories (avatars/bundle3d.ts)
 *   animations/<emote>.json       a motion clip: { label, category, source, clip }
 *
 * Garments and accessories travel with the avatar they belong to (they fit that body).
 */
import { ClipSchema, EMOTE_CATEGORIES, EMOTE_ID } from '@everloom/engine';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { HttpError, type AppContext } from '../../context.js';
import { mediaUrl } from '../media.js';
import { getKv, setKv } from '../settings.js';
import { exportAvatar3d, importAvatar3d } from './bundle3d.js';
import { parseConfig, type AvatarRow } from './service.js';

export const ASSET3D_TYPES = ['model', 'garment', 'accessory', 'animation'] as const;
export type Asset3dType = (typeof ASSET3D_TYPES)[number];

export interface Asset3d {
  /** model:<avatar>, garment:<avatar>:<garment>, accessory:<avatar>:<id>, animation:<emote>. */
  key: string;
  type: Asset3dType;
  name: string;
  tags: string[];
  /** The avatar it belongs to (models, garments, accessories). */
  avatar: { id: string; name: string } | null;
  detail: string;
  thumb: string | null;
}

const clean = (s: string, max = 30) => s.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const cleanTags = (tags: string[]) => [...new Set(tags.map((t) => clean(t).toLowerCase()).filter(Boolean))].slice(0, 12);
const slugify = (s: string) => s.normalize('NFKD').replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '-').slice(0, 48) || 'avatar';

function tagStore(ctx: AppContext, owner: string) {
  return getKv<Record<string, string[]>>(ctx, owner, 'assets3d.tags', {});
}

export function list3d(ctx: AppContext, owner: string, f: { q?: string; type?: string; tag?: string } = {}) {
  const tags = tagStore(ctx, owner);
  const out: Asset3d[] = [];
  const rows = ctx.db.prepare('SELECT * FROM avatars WHERE owner_id = ? ORDER BY updated_at DESC').all(owner) as AvatarRow[];
  for (const r of rows) {
    const cfg = parseConfig(r.config);
    const av = { id: r.id, name: r.name };
    const kind = { imported: 'Imported model', parts: 'Parts-made', code: 'Code-made', realistic: 'Realistic (MPFB)', makehuman: 'MakeHuman (native)', character: 'Character creator' }[r.kind] ?? r.kind;
    out.push({ key: `model:${r.id}`, type: 'model', name: r.name, tags: tags[`model:${r.id}`] ?? [], avatar: av, detail: kind, thumb: r.thumb_media ? mediaUrl(r.thumb_media) : null });
    for (const g of cfg.garments) {
      const key = `garment:${r.id}:${g.id}`;
      out.push({ key, type: 'garment', name: g.name, tags: tags[key] ?? [], avatar: av, detail: `${g.slot}${g.family && !g.family.startsWith('mpfb:') ? ` · ${g.family}` : ''}`, thumb: null });
    }
    for (const a of cfg.accessories) {
      const key = `accessory:${r.id}:${a.id}`;
      out.push({ key, type: 'accessory', name: a.name, tags: tags[key] ?? [], avatar: av, detail: a.bone, thumb: null });
    }
  }
  const clips = ctx.db.prepare('SELECT emote, label, category FROM avatar_clips WHERE owner_id = ? ORDER BY label').all(owner) as Array<{ emote: string; label: string; category: string }>;
  for (const c of clips) out.push({ key: `animation:${c.emote}`, type: 'animation', name: c.label, tags: tags[`animation:${c.emote}`] ?? [], avatar: null, detail: `${c.category} · ${c.emote}`, thumb: null });
  const words = (f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const items = out.filter((a) => {
    if (f.type && a.type !== f.type) return false;
    if (f.tag && !a.tags.includes(f.tag.toLowerCase())) return false;
    const hay = `${a.name} ${a.tags.join(' ')} ${a.detail} ${a.avatar?.name ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return { items, tags: [...new Set(out.flatMap((a) => a.tags))].sort() };
}

export function setTags3d(ctx: AppContext, owner: string, key: string, tags: string[]) {
  if (!/^(model|garment|accessory|animation):[\w:-]{1,140}$/.test(key)) throw new HttpError(400, 'Unknown 3D asset');
  const all = tagStore(ctx, owner);
  const next = cleanTags(tags);
  if (next.length) all[key] = next;
  else delete all[key];
  setKv(ctx, owner, 'assets3d.tags', all);
  return { key, tags: next };
}

/** A zip of the chosen assets (a garment or accessory brings its avatar along). */
export function export3d(ctx: AppContext, owner: string, keys: string[]): Buffer {
  const tags = tagStore(ctx, owner);
  const files: Zippable = {};
  const manifest: { format: string; version: number; avatars: Array<{ path: string; tags: string[] }>; animations: Array<{ path: string; tags: string[] }> } = { format: 'everloom-3d', version: 1, avatars: [], animations: [] };
  const avatars = new Set<string>();
  const clips = new Set<string>();
  for (const k of keys) {
    const [type, a] = k.split(':');
    if (type === 'animation' && a) clips.add(a);
    else if (a) avatars.add(a);
  }
  const used = new Set<string>();
  for (const id of avatars) {
    const row = ctx.db.prepare('SELECT name FROM avatars WHERE id = ? AND owner_id = ?').get(id, owner) as { name: string } | undefined;
    if (!row) continue;
    let slug = slugify(row.name);
    while (used.has(slug)) slug = `${slugify(row.name)}-${used.size}`;
    used.add(slug);
    const path = exportAvatar3d(ctx, owner, id, slug, files);
    if (path) manifest.avatars.push({ path, tags: tags[`model:${id}`] ?? [] });
  }
  for (const emote of clips) {
    const r = ctx.db.prepare('SELECT label, category, source, data FROM avatar_clips WHERE owner_id = ? AND emote = ?').get(owner, emote) as { label: string; category: string; source: string; data: string } | undefined;
    if (!r) continue;
    const path = `animations/${emote}.json`;
    files[path] = strToU8(JSON.stringify({ label: r.label, category: r.category, source: r.source, clip: JSON.parse(r.data) }));
    manifest.animations.push({ path, tags: tags[`animation:${emote}`] ?? [] });
  }
  if (!manifest.avatars.length && !manifest.animations.length) throw new HttpError(400, 'Nothing to export');
  files['assets3d.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return Buffer.from(zipSync(files, { level: 6 }));
}

/** Imports a 3D zip: avatars (with their garments) and motion clips. A clip with a taken name is skipped. */
export async function import3d(ctx: AppContext, owner: string, bytes: Buffer) {
  if (bytes.length > 512 * 1024 * 1024) throw new HttpError(413, 'Zip is larger than 512 MB');
  let files: Record<string, Uint8Array>;
  try {
    let total = 0;
    let count = 0;
    files = unzipSync(new Uint8Array(bytes), {
      filter: (f) => {
        count++;
        total += f.originalSize;
        if (count > 5000 || total > 2 * 1024 * 1024 * 1024) throw new Error('the zip unpacks to too much');
        return !f.name.endsWith('/') && !f.name.startsWith('__MACOSX/');
      },
    });
  } catch (e) {
    throw new HttpError(400, `Not a readable zip: ${(e as Error).message}`);
  }
  let manifest: { avatars?: Array<{ path: string; tags?: string[] }>; animations?: Array<{ path: string; tags?: string[] }> } = {};
  try {
    manifest = files['assets3d.json'] ? JSON.parse(new TextDecoder().decode(files['assets3d.json'])) : {};
  } catch {
    manifest = {};
  }
  // Without a manifest: every avatar.json and animations/*.json in the zip.
  const avatarPaths = manifest.avatars ?? Object.keys(files).filter((p) => p.endsWith('/avatar.json')).map((path) => ({ path, tags: [] }));
  const clipPaths = manifest.animations ?? Object.keys(files).filter((p) => /^animations\/[^/]+\.json$/.test(p)).map((path) => ({ path, tags: [] }));
  const res = { avatars: [] as string[], animations: [] as string[], skipped: 0 };
  for (const a of avatarPaths.slice(0, 100)) {
    const id = await importAvatar3d(ctx, owner, files, a.path);
    if (!id) {
      res.skipped++;
      continue;
    }
    res.avatars.push(id);
    if (a.tags?.length) setTags3d(ctx, owner, `model:${id}`, a.tags);
  }
  for (const c of clipPaths.slice(0, 500)) {
    try {
      const raw = JSON.parse(new TextDecoder().decode(files[c.path]!)) as { label?: string; category?: string; source?: string; clip?: unknown };
      const emote = c.path.split('/').pop()!.replace(/\.json$/, '');
      const clip = ClipSchema.parse(raw.clip);
      const category = (EMOTE_CATEGORIES as readonly string[]).includes(raw.category ?? '') ? raw.category! : 'social';
      if (!EMOTE_ID.test(emote) || ctx.db.prepare('SELECT 1 FROM avatar_clips WHERE owner_id = ? AND emote = ?').get(owner, emote)) {
        res.skipped++;
        continue;
      }
      ctx.db
        .prepare('INSERT INTO avatar_clips (id, owner_id, emote, label, category, data, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(`${owner}:${emote}`, owner, emote, clean(raw.label ?? emote, 40) || emote, category, JSON.stringify({ ...clip, id: emote }), clean(raw.source ?? '', 200), Date.now());
      res.animations.push(emote);
      if (c.tags?.length) setTags3d(ctx, owner, `animation:${emote}`, c.tags);
    } catch {
      res.skipped++;
    }
  }
  return res;
}
