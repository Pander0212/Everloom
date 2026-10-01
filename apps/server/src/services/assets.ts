/**
 * The asset library: sprites, backgrounds, CGs and item icons shared across characters and
 * campaigns. Each asset is an ordinary media row (kind "asset", so it is served, backed up and
 * checked like any picture) with a name, a type, tags and, for sprites, an optional expression set
 * (one picture per emotion) that can be given to any character in one go.
 */
import { EMOTIONS, sniffImageType } from '@everloom/engine';
import { unzipSync } from 'fflate';
import { HttpError, type AppContext } from '../context.js';
import { mediaUrl, saveMedia } from './media.js';

export const ASSET_TYPES = ['sprite', 'background', 'cg', 'icon'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export interface AssetMeta {
  name: string;
  type: AssetType;
  tags: string[];
  /** Expression set this sprite belongs to, and which emotion it shows. */
  set?: string;
  expression?: string;
}

export interface AssetDTO extends AssetMeta {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  createdAt: number;
}

interface Row {
  id: string;
  meta: string;
  width: number | null;
  height: number | null;
  created_at: number;
}

const clean = (s: string, max = 60) => s.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const cleanTags = (tags: string[]) => [...new Set(tags.map((t) => clean(t, 30).toLowerCase()).filter(Boolean))].slice(0, 12);

function toDTO(r: Row): AssetDTO {
  const m = JSON.parse(r.meta) as Partial<AssetMeta>;
  return {
    id: r.id,
    url: mediaUrl(r.id)!,
    name: m.name ?? 'Untitled',
    type: ASSET_TYPES.includes(m.type as AssetType) ? (m.type as AssetType) : 'sprite',
    tags: Array.isArray(m.tags) ? m.tags : [],
    ...(m.set ? { set: m.set } : {}),
    ...(m.expression ? { expression: m.expression } : {}),
    width: r.width,
    height: r.height,
    createdAt: r.created_at,
  };
}

/** Every asset (newest first), filtered by words in the name, tags or set, by type and by tag. */
export function listAssets(ctx: AppContext, owner: string, f: { q?: string; type?: string; tag?: string } = {}) {
  const rows = ctx.db.prepare("SELECT id, meta, width, height, created_at FROM media WHERE owner_id = ? AND kind = 'asset' ORDER BY created_at DESC LIMIT 5000").all(owner) as Row[];
  const all = rows.map(toDTO);
  const words = (f.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const assets = all.filter((a) => {
    if (f.type && a.type !== f.type) return false;
    if (f.tag && !a.tags.includes(f.tag.toLowerCase())) return false;
    const hay = `${a.name} ${a.tags.join(' ')} ${a.set ?? ''} ${a.expression ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  // Expression sets: one picture per emotion, ready to hand to a character.
  const sets = new Map<string, Record<string, string>>();
  for (const a of all) if (a.set && a.expression) (sets.get(a.set) ?? sets.set(a.set, {}).get(a.set)!)[a.expression] = a.id;
  const tags = [...new Set(all.flatMap((a) => a.tags))].sort();
  return { assets, sets: [...sets].map(([name, expressions]) => ({ name, expressions })).sort((a, b) => a.name.localeCompare(b.name)), tags };
}

export async function addAsset(ctx: AppContext, owner: string, bytes: Buffer, meta: Partial<AssetMeta>): Promise<AssetDTO> {
  if (!sniffImageType(new Uint8Array(bytes.subarray(0, 16)))) throw new HttpError(415, 'Assets are pictures: PNG, JPEG, WebP or GIF.');
  const m: AssetMeta = {
    name: clean(meta.name ?? '') || 'Untitled',
    type: ASSET_TYPES.includes(meta.type as AssetType) ? (meta.type as AssetType) : 'sprite',
    tags: cleanTags(meta.tags ?? []),
    ...(meta.set ? { set: clean(meta.set) } : {}),
    ...(meta.expression && (EMOTIONS as readonly string[]).includes(meta.expression) ? { expression: meta.expression } : {}),
  };
  const row = await saveMedia(ctx, owner, bytes, { kind: 'asset', meta: m as unknown as Record<string, unknown>, maxDim: m.type === 'background' || m.type === 'cg' ? 2560 : 1600 });
  return toDTO({ id: row.id, meta: row.meta, width: row.width, height: row.height, created_at: row.created_at });
}

export function updateAsset(ctx: AppContext, owner: string, id: string, patch: Partial<AssetMeta>): AssetDTO {
  const r = ctx.db.prepare("SELECT id, meta, width, height, created_at FROM media WHERE id = ? AND owner_id = ? AND kind = 'asset'").get(id, owner) as Row | undefined;
  if (!r) throw new HttpError(404, 'Asset not found');
  const cur = toDTO(r);
  const next: AssetMeta = {
    name: patch.name !== undefined ? clean(patch.name) || cur.name : cur.name,
    type: patch.type && ASSET_TYPES.includes(patch.type) ? patch.type : cur.type,
    tags: patch.tags ? cleanTags(patch.tags) : cur.tags,
  };
  const set = patch.set !== undefined ? clean(patch.set) : cur.set;
  const expression = patch.expression !== undefined ? patch.expression : cur.expression;
  if (set) next.set = set;
  if (expression && (EMOTIONS as readonly string[]).includes(expression)) next.expression = expression;
  ctx.db.prepare('UPDATE media SET meta = ? WHERE id = ? AND owner_id = ?').run(JSON.stringify(next), id, owner);
  return { ...cur, ...next, set: next.set, expression: next.expression };
}

const ALIASES: Record<string, string> = { happy: 'joy', smile: 'joy', sad: 'sadness', angry: 'anger', mad: 'anger', scared: 'fear', afraid: 'fear', surprised: 'surprise', shy: 'embarrassment', blush: 'embarrassment', default: 'neutral', idle: 'neutral', normal: 'neutral', confused: 'confusion', curious: 'curiosity', proud: 'pride', nervous: 'nervousness', disgusted: 'disgust', amused: 'amusement', laugh: 'amusement', loving: 'love' };
const TYPE_FOLDERS: Record<string, AssetType> = { background: 'background', backgrounds: 'background', bg: 'background', bgs: 'background', cg: 'cg', cgs: 'cg', icon: 'icon', icons: 'icon', items: 'icon', sprite: 'sprite', sprites: 'sprite' };

/** The emotion a file name stands for ("happy.png", "Mara_joy.webp"), if any. */
export function emotionOf(file: string): string | null {
  const base = file.toLowerCase().replace(/\.[^.]+$/, '');
  for (const part of [base, ...base.split(/[\s_\-.]+/).reverse()]) {
    if ((EMOTIONS as readonly string[]).includes(part)) return part;
    if (ALIASES[part]) return ALIASES[part]!;
  }
  return null;
}

/**
 * Import a zip of pictures. Folder names become tags; a folder called backgrounds, cgs or icons
 * sets the type; pictures named after emotions form an expression set named after their folder
 * (or after the zip). Anything that isn't a picture is skipped.
 */
export async function importAssetZip(ctx: AppContext, owner: string, bytes: Buffer, zipName = 'Imported'): Promise<{ added: number; skipped: number; sets: string[] }> {
  if (bytes.length > 300 * 1024 * 1024) throw new HttpError(413, 'Zip is larger than 300 MB');
  let files: Record<string, Uint8Array>;
  try {
    let total = 0;
    let count = 0;
    files = unzipSync(new Uint8Array(bytes), {
      filter: (f) => {
        if (f.name.endsWith('/') || f.name.startsWith('__MACOSX/') || f.name.split('/').some((p) => p.startsWith('.'))) return false;
        count++;
        total += f.originalSize;
        if (count > 2000 || total > 1024 * 1024 * 1024) throw new Error('the zip unpacks to too much');
        return true;
      },
    });
  } catch (e) {
    throw new HttpError(400, `Not a readable zip: ${(e as Error).message}`);
  }
  const fallbackSet = clean(zipName.replace(/\.zip$/i, '')) || 'Imported';
  let added = 0;
  let skipped = 0;
  const sets = new Set<string>();
  for (const [path, data] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const buf = Buffer.from(data);
    if (!sniffImageType(new Uint8Array(buf.subarray(0, 16)))) {
      skipped++;
      continue;
    }
    const parts = path.split('/');
    const file = parts.pop()!;
    const folders = parts.map((p) => clean(p, 30)).filter(Boolean);
    const typeFolder = folders.map((f) => TYPE_FOLDERS[f.toLowerCase()]).find(Boolean);
    const emotion = typeFolder && typeFolder !== 'sprite' ? null : emotionOf(file);
    const owners = folders.filter((f) => !TYPE_FOLDERS[f.toLowerCase()]);
    const set = emotion ? (owners.at(-1) ?? fallbackSet) : undefined;
    if (set) sets.add(set);
    try {
      await addAsset(ctx, owner, buf, {
        name: emotion && set ? `${set} · ${emotion}` : file.replace(/\.[^.]+$/, ''),
        type: typeFolder ?? 'sprite',
        tags: folders.filter((f) => !TYPE_FOLDERS[f.toLowerCase()]),
        ...(set ? { set } : {}),
        ...(emotion ? { expression: emotion } : {}),
      });
      added++;
    } catch {
      skipped++;
    }
  }
  return { added, skipped, sets: [...sets] };
}
