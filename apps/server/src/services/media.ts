import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { readContentFile, writeContentFile } from '../vault/vault.js';
import path from 'node:path';
import sharp from 'sharp';
import { sniffImageType } from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { newId } from '../security/crypto.js';

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const SAFE_ID = /^[A-Za-z0-9_-]{4,64}$/;

export interface MediaRow {
  id: string;
  owner_id: string;
  kind: string;
  filename: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  character_id: string | null;
  meta: string;
  created_at: number;
}

export function mediaUrl(id: string | null | undefined): string | null {
  return id ? `/media/${id}` : null;
}

function ownerDir(ctx: AppContext, owner: string): string {
  if (!SAFE_ID.test(owner)) throw new HttpError(400, 'Bad owner id');
  const dir = path.join(ctx.cfg.mediaDir, owner);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Validate an uploaded image by magic bytes, re-encode it to strip EXIF/metadata (including GPS),
 * normalise orientation and cap its size, then store it.
 */
export async function saveImage(
  ctx: AppContext,
  owner: string,
  bytes: Buffer,
  opts: { kind: string; characterId?: string | null; maxDim?: number; meta?: Record<string, unknown> },
): Promise<MediaRow> {
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image is larger than 15 MB');
  const type = sniffImageType(new Uint8Array(bytes.subarray(0, 16)));
  if (!type) throw new HttpError(415, 'Unsupported file type. Use PNG, JPEG, WebP or GIF.');
  const maxDim = opts.maxDim ?? 2048;
  let out: Buffer;
  let info: { width?: number; height?: number };
  try {
    const img = sharp(bytes, { animated: type === 'gif' || type === 'webp', limitInputPixels: 64_000_000 }).rotate();
    const resized = img.resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true });
    // Re-encoding drops all metadata (sharp does not copy EXIF unless asked).
    const encoded = type === 'png' ? resized.png({ compressionLevel: 8 }) : type === 'gif' ? resized.gif() : type === 'jpeg' ? resized.jpeg({ quality: 88, mozjpeg: true }) : resized.webp({ quality: 88 });
    ({ data: out, info } = await encoded.toBuffer({ resolveWithObject: true }));
  } catch {
    throw new HttpError(415, 'The image could not be read');
  }
  const id = newId('m_');
  const filename = `${id}.${type === 'jpeg' ? 'jpg' : type}`;
  writeContentFile(ctx.vault, path.join(ownerDir(ctx, owner), filename), out);
  const row: MediaRow = {
    id,
    owner_id: owner,
    kind: opts.kind,
    filename,
    mime: MIME[type],
    size: out.length,
    width: info.width ?? null,
    height: info.height ?? null,
    character_id: opts.characterId ?? null,
    meta: JSON.stringify(opts.meta ?? {}),
    created_at: Date.now(),
  };
  ctx.db
    .prepare('INSERT INTO media (id, owner_id, kind, filename, mime, size, width, height, character_id, meta, created_at) VALUES (@id, @owner_id, @kind, @filename, @mime, @size, @width, @height, @character_id, @meta, @created_at)')
    .run(row);
  return row;
}

export const MAX_AV_BYTES = 60 * 1024 * 1024;
const AV_MIME: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' };

/** Video and audio by magic bytes (never by the name or the declared type). */
export function sniffAvType(b: Uint8Array): keyof typeof AV_MIME | null {
  const s = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length < 12) return null;
  if (s(4, 4) === 'ftyp') return /M4A|M4B/.test(s(8, 4)) ? 'm4a' : 'mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (s(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return 'wav';
  if (s(0, 4) === 'OggS') return 'ogg';
  return null;
}

/** Store any gallery file: images are re-encoded (metadata stripped), video and audio stored as sent. */
export async function saveMedia(ctx: AppContext, owner: string, bytes: Buffer, opts: { kind: string; characterId?: string | null; maxDim?: number; meta?: Record<string, unknown> }): Promise<MediaRow> {
  if (sniffImageType(new Uint8Array(bytes.subarray(0, 16)))) return saveImage(ctx, owner, bytes, opts);
  const type = sniffAvType(new Uint8Array(bytes.subarray(0, 16)));
  if (!type) throw new HttpError(415, 'Unsupported file type. Use an image (PNG, JPEG, WebP, GIF), video (MP4, WebM) or audio (MP3, WAV, OGG, M4A).');
  if (bytes.length > MAX_AV_BYTES) throw new HttpError(413, 'File is larger than 60 MB');
  const id = newId('m_');
  const filename = `${id}.${type}`;
  writeContentFile(ctx.vault, path.join(ownerDir(ctx, owner), filename), bytes);
  const row: MediaRow = { id, owner_id: owner, kind: opts.kind, filename, mime: AV_MIME[type], size: bytes.length, width: null, height: null, character_id: opts.characterId ?? null, meta: JSON.stringify(opts.meta ?? {}), created_at: Date.now() };
  ctx.db
    .prepare('INSERT INTO media (id, owner_id, kind, filename, mime, size, width, height, character_id, meta, created_at) VALUES (@id, @owner_id, @kind, @filename, @mime, @size, @width, @height, @character_id, @meta, @created_at)')
    .run(row);
  return row;
}

export const MAX_MODEL_BYTES = 200 * 1024 * 1024;
const MODEL_MIME: Record<string, string> = { glb: 'model/gltf-binary', vrm: 'model/gltf-binary', fbx: 'application/octet-stream', pmx: 'application/octet-stream', pmd: 'application/octet-stream', bvh: 'text/plain', vmd: 'application/octet-stream', vrma: 'model/gltf-binary', obj: 'text/plain', zip: 'application/zip', blend: 'application/x-blender', dae: 'model/vnd.collada+xml' };
Object.assign(MODEL_MIME, { json: 'application/json', gz: 'application/gzip', target: 'text/plain', mhclo: 'text/plain', mhmat: 'text/plain', mhskel: 'application/json', mhw: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bin: 'application/octet-stream' });

/**
 * Store a 3D file (model, motion or source file) as a media row so the vault, backups and
 * deletion cover it. The caller has already checked what it is; `ext` only names the file.
 */
export function saveModelFile(ctx: AppContext, owner: string, bytes: Buffer, opts: { kind: string; ext: string; meta?: Record<string, unknown> }): MediaRow {
  if (bytes.length > MAX_MODEL_BYTES) throw new HttpError(413, 'File is larger than 200 MB');
  const ext = opts.ext.toLowerCase();
  if (!MODEL_MIME[ext]) throw new HttpError(415, 'Unsupported 3D file');
  const id = newId('m_');
  const filename = `${id}.${ext}`;
  writeContentFile(ctx.vault, path.join(ownerDir(ctx, owner), filename), bytes);
  const row: MediaRow = { id, owner_id: owner, kind: opts.kind, filename, mime: MODEL_MIME[ext]!, size: bytes.length, width: null, height: null, character_id: null, meta: JSON.stringify(opts.meta ?? {}), created_at: Date.now() };
  ctx.db
    .prepare('INSERT INTO media (id, owner_id, kind, filename, mime, size, width, height, character_id, meta, created_at) VALUES (@id, @owner_id, @kind, @filename, @mime, @size, @width, @height, @character_id, @meta, @created_at)')
    .run(row);
  return row;
}

export function getMedia(ctx: AppContext, owner: string, id: string): { row: MediaRow; file: string } {
  if (!SAFE_ID.test(id)) throw new HttpError(404, 'Not found');
  const row = ctx.db.prepare('SELECT * FROM media WHERE id = ? AND owner_id = ?').get(id, owner) as MediaRow | undefined;
  if (!row) throw new HttpError(404, 'Not found');
  const dir = ownerDir(ctx, owner);
  const file = path.resolve(dir, row.filename);
  if (!file.startsWith(dir + path.sep) || !existsSync(file)) throw new HttpError(404, 'Not found');
  return { row, file };
}

/** A media file's bytes (decrypted when the vault wrote it). */
export function readMedia(ctx: AppContext, owner: string, id: string): { row: MediaRow; bytes: Buffer } {
  const { row, file } = getMedia(ctx, owner, id);
  return { row, bytes: readContentFile(ctx.vault, file) };
}

export function deleteMedia(ctx: AppContext, owner: string, id: string) {
  try {
    const { file } = getMedia(ctx, owner, id);
    unlinkSync(file);
  } catch {
    /* already gone */
  }
  ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM media WHERE id = ? AND owner_id = ?').run(id, owner);
    // Drop references so nothing points at a missing file.
    ctx.db.prepare('UPDATE characters SET avatar = NULL WHERE owner_id = ? AND avatar = ?').run(owner, id);
    ctx.db.prepare('UPDATE personas SET avatar = NULL WHERE owner_id = ? AND avatar = ?').run(owner, id);
    ctx.db.prepare("UPDATE chats SET metadata = json_remove(metadata, '$.background') WHERE owner_id = ? AND json_extract(metadata, '$.background') = ?").run(owner, id);
    const rows = ctx.db.prepare('SELECT id, game FROM characters WHERE owner_id = ? AND instr(game, ?) > 0').all(owner, id) as Array<{ id: string; game: string }>;
    for (const r of rows) {
      try {
        const game = JSON.parse(r.game);
        for (const [k, v] of Object.entries(game.expressions ?? {})) if (v === id) delete game.expressions[k];
        if (Array.isArray(game.gallery)) game.gallery = game.gallery.filter((g: string) => g !== id);
        ctx.db.prepare('UPDATE characters SET game = ? WHERE id = ?').run(JSON.stringify(game), r.id);
      } catch {
        /* leave malformed rows alone */
      }
    }
  })();
}

export function listMedia(ctx: AppContext, owner: string, filter: { kind?: string; characterId?: string } = {}) {
  const where = ['owner_id = ?'];
  const args: unknown[] = [owner];
  if (filter.kind) {
    where.push('kind = ?');
    args.push(filter.kind);
  } else where.push("kind NOT LIKE 'model%'"); // 3D files belong to their avatars, not the gallery
  if (filter.characterId) {
    where.push('character_id = ?');
    args.push(filter.characterId);
  }
  const rows = ctx.db.prepare(`SELECT * FROM media WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 500`).all(...args) as MediaRow[];
  return rows.map((r) => ({ id: r.id, url: mediaUrl(r.id)!, kind: r.kind, mime: r.mime, size: r.size, width: r.width, height: r.height, characterId: r.character_id, meta: JSON.parse(r.meta), createdAt: r.created_at }));
}
