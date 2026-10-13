/** Resumable 4 MiB uploads. Every chunk is ordinary Vault-covered media; metadata is in the content DB. */
import { createHash } from 'node:crypto';
import { statfsSync } from 'node:fs';
import type { AppContext } from '../../context.js';
import { HttpError } from '../../context.js';
import { newId } from '../../security/crypto.js';
import { getKv, setKv } from '../settings.js';
import { deleteMedia, readMedia, saveModelFile } from '../media.js';
export const UPLOAD_CHUNK = 4 * 1024 * 1024;
export interface BlobRecord { size: number; chunks: string[] }
export interface UploadRecord extends BlobRecord { id: string; name: string; fingerprint: string; offset: number; created: number; state: 'uploading' | 'processing' | 'done' | 'failed'; progress: number; error?: string; result?: unknown; stagedChunks?: string[] }
const key = (id: string) => `3d-upload:${id}`;
export function uploadLimit() {
  const configured = Number(process.env.EVERLOOM_UPLOAD_MAX_BYTES ?? 4 * 1024 ** 3);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 4 * 1024 ** 3;
}
export function getUpload(ctx: AppContext, owner: string, id: string): UploadRecord {
  if (!/^up_[a-zA-Z0-9_-]+$/.test(id)) throw new HttpError(404, 'Upload not found');
  const record = getKv<UploadRecord | null>(ctx, owner, key(id), null);
  if (!record) throw new HttpError(404, 'Upload not found');
  return record;
}
export const storeUpload = (ctx: AppContext, owner: string, u: UploadRecord) => setKv(ctx, owner, key(u.id), u);
export function beginUpload(ctx: AppContext, owner: string, opts: { name: string; size: number; fingerprint: string }) {
  if (opts.size > uploadLimit()) throw new HttpError(413, `File exceeds the ${uploadLimit()} byte limit. Set EVERLOOM_UPLOAD_MAX_BYTES to raise it.`);
  const rows = ctx.db.prepare("SELECT value FROM settings WHERE owner_id = ? AND key LIKE '3d-upload:%'").all(owner) as { value: string }[];
  let reserved = 0, active = 0;
  for (const row of rows) {
    const old = JSON.parse(row.value) as UploadRecord;
    if (old.created < Date.now() - 7 * 86400_000 && old.state !== 'processing') { removeUpload(ctx, owner, old.id); continue; }
    if (old.fingerprint === opts.fingerprint && old.size === opts.size && old.name === opts.name) return old;
    if (old.state !== 'done') { reserved += old.size - old.offset; active++; }
  }
  if (active >= 8) throw new HttpError(429, 'Finish or cancel an existing 3D upload first.');
  const disk = statfsSync(ctx.cfg.dataDir);
  if (disk.bavail * disk.bsize < opts.size + reserved + 128 * 1024 ** 2) throw new HttpError(507, 'Not enough free disk for this upload.');
  const u: UploadRecord = { ...opts, id: newId('up_'), offset: 0, chunks: [], created: Date.now(), state: 'uploading', progress: 0 };
  storeUpload(ctx, owner, u); return u;
}
export function appendUpload(ctx: AppContext, owner: string, id: string, offset: number, bytes: Buffer) {
  const u = getUpload(ctx, owner, id);
  if (!bytes.length || bytes.length > UPLOAD_CHUNK || offset % UPLOAD_CHUNK !== 0 || offset + bytes.length > u.size || (bytes.length !== UPLOAD_CHUNK && offset + bytes.length !== u.size)) throw new HttpError(400, 'Invalid upload chunk');
  if (offset < u.offset) {
    const stored = readMedia(ctx, owner, u.chunks[offset / UPLOAD_CHUNK]!).bytes;
    if (createHash('sha256').update(stored).digest('hex') !== createHash('sha256').update(bytes).digest('hex')) throw new HttpError(409, 'This chunk differs from the uploaded file');
    return u;
  }
  if (u.state !== 'uploading' || offset !== u.offset) throw new HttpError(409, `Resume at byte ${u.offset}`);
  const media = saveModelFile(ctx, owner, bytes, { kind: 'model-upload-chunk', ext: 'bin' });
  u.chunks.push(media.id); u.offset += bytes.length; u.progress = u.offset / u.size;
  storeUpload(ctx, owner, u); return u;
}
export async function* readBlob(ctx: AppContext, owner: string, blob: BlobRecord) {
  for (const id of blob.chunks) { if (ctx.vault.locked) throw new HttpError(423, 'The vault is locked', 'locked'); yield readMedia(ctx, owner, id).bytes; }
}
export async function storeBlob(ctx: AppContext, owner: string, source: AsyncIterable<Uint8Array>, max = uploadLimit(), journal?: (id: string) => void): Promise<BlobRecord> {
  const out: BlobRecord = { size: 0, chunks: [] };
  let buffer = Buffer.allocUnsafe(UPLOAD_CHUNK), offset = 0;
  const flush = () => {
    const id = saveModelFile(ctx, owner, buffer.subarray(0, offset), { kind: 'model-unity-chunk', ext: 'bin' }).id;
    out.chunks.push(id); journal?.(id); offset = 0;
  };
  try {
    for await (const chunk of source) {
      if ((out.size += chunk.length) > max) throw new HttpError(413, 'Unpacked file exceeds the configured limit');
      for (let at = 0; at < chunk.length;) { const n = Math.min(buffer.length - offset, chunk.length - at); buffer.set(chunk.subarray(at, at + n), offset); offset += n; at += n; if (offset === buffer.length) flush(); }
    }
    if (offset) flush();
    return out;
  } catch (e) { if (!ctx.vault.locked) for (const id of out.chunks) deleteMedia(ctx, owner, id); throw e; }
}
export function removeUpload(ctx: AppContext, owner: string, id: string) {
  const u = getUpload(ctx, owner, id);
  if (u.state === 'processing') throw new HttpError(409, 'Cancel processing before deleting this upload');
  for (const chunk of [...u.chunks, ...(u.stagedChunks ?? [])]) deleteMedia(ctx, owner, chunk);
  ctx.db.prepare('DELETE FROM settings WHERE owner_id = ? AND key = ?').run(owner, key(id));
}
