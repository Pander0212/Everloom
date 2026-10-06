/**
 * A character's 3D avatar inside a bundle: its settings, its original model file (prepared again on
 * import) and the files its outfits, garments, accessories and textures use. Media ids are kept in
 * the settings and remapped to the new copies on import.
 *
 *   avatars/<slug>/avatar.json      name, kind, settings, which file is which
 *   avatars/<slug>/<file>           the source model and the other files
 */
import { AvatarConfigSchema, type AvatarConfig, type AvatarKind } from '@everloom/engine';
import type { Zippable } from 'fflate';
import { strToU8 } from 'fflate';
import { HttpError, type AppContext } from '../../context.js';
import { newId } from '../../security/crypto.js';
import { readMedia, saveMedia, saveModelFile } from '../media.js';
import { createCodeAvatar, createPartsAvatar } from './recipes.js';
import { createAvatar, getAvatarRow, parseConfig, updateAvatar } from './service.js';

interface Avatar3dEntry {
  id: string;
  name: string;
  kind: AvatarKind;
  config: AvatarConfig;
  source: string | null;
  sourceName: string | null;
  media: Array<{ id: string; path: string; kind: string; filename: string }>;
}

const MODEL_EXT = /\.(glb|vrm|fbx|pmx|pmd|obj|dae)$/i;

/** Media ids the settings point at (not built-in pack files). */
export function avatarMediaRefs(cfg: AvatarConfig): string[] {
  const ids = [
    ...cfg.outfits.flatMap((o) => [o.model, o.modelLow]),
    ...cfg.garments.flatMap((g) => [g.model, g.modelLow, ...g.variants.map((v) => v.texture)]),
    ...cfg.accessories.map((a) => a.model),
    cfg.maker?.body,
    ...Object.values(cfg.maker?.textures ?? {}),
  ];
  return [...new Set(ids.filter((x): x is string => typeof x === 'string' && !!x && !x.startsWith('/')))];
}

export function exportAvatar3d(ctx: AppContext, owner: string, avatarId: string, slug: string, files: Zippable): string | null {
  let row;
  try {
    row = getAvatarRow(ctx, owner, avatarId);
  } catch {
    return null;
  }
  const cfg = parseConfig(row.config);
  const dir = `avatars/${slug}`;
  const entry: Avatar3dEntry = { id: row.id, name: row.name, kind: row.kind, config: cfg, source: null, sourceName: null, media: [] };
  if (row.source_media) {
    try {
      const src = readMedia(ctx, owner, row.source_media);
      entry.source = `${dir}/source-${src.row.filename.replace(/[^\w.-]/g, '_')}`;
      entry.sourceName = src.row.filename;
      files[entry.source] = [new Uint8Array(src.bytes), { level: 0 }];
    } catch {
      /* missing file: the avatar comes without its model */
    }
  }
  for (const id of avatarMediaRefs(cfg)) {
    try {
      const m = readMedia(ctx, owner, id);
      const path = `${dir}/${id}-${m.row.filename.replace(/[^\w.-]/g, '_')}`;
      files[path] = [new Uint8Array(m.bytes), { level: 0 }];
      entry.media.push({ id, path, kind: m.row.kind, filename: m.row.filename });
    } catch {
      /* missing: skipped */
    }
  }
  files[`${dir}/avatar.json`] = strToU8(JSON.stringify(entry, null, 2));
  return `${dir}/avatar.json`;
}

/** Recreates the avatar from a bundle; returns its new id (null when it can't be made here). */
export async function importAvatar3d(ctx: AppContext, owner: string, files: Record<string, Uint8Array>, path: string): Promise<string | null> {
  const raw = files[path];
  if (!raw) return null;
  let entry: Avatar3dEntry;
  try {
    entry = JSON.parse(new TextDecoder().decode(raw)) as Avatar3dEntry;
  } catch {
    return null;
  }
  const id = newId('av_');
  let json = JSON.stringify(entry.config ?? {});
  // The realistic body family is named after the avatar.
  if (typeof entry.id === 'string' && /^av_[\w-]+$/.test(entry.id)) json = json.split(entry.id).join(id);
  for (const m of Array.isArray(entry.media) ? entry.media.slice(0, 200) : []) {
    const bytes = files[m.path];
    if (!bytes || typeof m.id !== 'string') continue;
    try {
      const ext = MODEL_EXT.exec(m.filename ?? '')?.[1]?.toLowerCase();
      const saved = ext ? saveModelFile(ctx, owner, Buffer.from(bytes), { kind: m.kind || 'model', ext, meta: { avatar: id } }) : await saveMedia(ctx, owner, Buffer.from(bytes), { kind: m.kind || 'avatar-texture' });
      json = json.split(`"${m.id}"`).join(`"${saved.id}"`);
    } catch {
      /* unsupported: the garment that used it won't load */
    }
  }
  const parsed = AvatarConfigSchema.safeParse(JSON.parse(json));
  if (!parsed.success) return null;
  const config = parsed.data;
  const name = String(entry.name ?? 'Imported avatar').slice(0, 80);
  try {
    if (entry.kind === 'code') {
      const a = createCodeAvatar(ctx, owner, { name, recipe: config.recipe ?? {} });
      updateAvatar(ctx, owner, a.id, { config });
      return a.id;
    }
    if (entry.kind === 'parts') return createPartsAvatar(ctx, owner, { name, config }).id;
    const src = entry.source ? files[entry.source] : null;
    if (!src) return null;
    return createAvatar(ctx, owner, Buffer.from(src), { id, name, filename: entry.sourceName ?? 'model.glb', kind: entry.kind === 'realistic' ? 'realistic' : 'imported', config }).id;
  } catch (e) {
    if (e instanceof HttpError) return null;
    throw e;
  }
}
