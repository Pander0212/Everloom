/**
 * 3D avatars: upload, conversion (Blender, for FBX/PMX/OBJ/DAE), inspection, optimization and the
 * saved settings. Processing happens in the background, one model at a time; the row's status
 * says where it is (processing → ready, or failed with a readable reason).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { AvatarConfigSchema, installedEmotes, type AvatarConfig, type AvatarKind } from '@everloom/engine';
import { HttpError, type AppContext } from '../../context.js';
import { newId } from '../../security/crypto.js';
import { deleteMedia, mediaUrl, readMedia, saveImage, saveModelFile } from '../media.js';
import { runBlenderJob } from '../blender.js';
import { isGlb, parseGlb } from './glb.js';
import { inspectModel, type ModelInfo } from './inspect.js';
import { optimizeModel, type OptimizeOptions, type OptimizeResult } from './optimize.js';

export interface AvatarRow {
  id: string;
  owner_id: string;
  name: string;
  kind: AvatarKind;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  format: string;
  source_media: string | null;
  model_media: string | null;
  low_media: string | null;
  thumb_media: string | null;
  config: string;
  info: string;
  created_at: number;
  updated_at: number;
}

export type SourceType = 'glb' | 'fbx' | 'pmx' | 'pmd' | 'obj' | 'dae';
const BLENDER_TYPES = new Set<SourceType>(['fbx', 'pmx', 'pmd', 'obj', 'dae']);

/** What kind of 3D file this is, by its bytes (the name only breaks ties for text formats). */
export function sniffModel(b: Buffer, filename = ''): SourceType | null {
  if (isGlb(b)) return 'glb';
  const head = b.subarray(0, 64).toString('latin1');
  if (head.startsWith('Kaydara FBX Binary')) return 'fbx';
  if (/^\s*; FBX \d/.test(head)) return 'fbx';
  if (head.startsWith('PMX ')) return 'pmx';
  if (head.startsWith('Pmd')) return 'pmd';
  const text = b.subarray(0, 4096).toString('utf8');
  if (/<COLLADA[\s>]/.test(text)) return 'dae';
  if (/\.obj$/i.test(filename) && /^(v|vt|vn|f|o|g|mtllib|#)\s/m.test(text) && !/\u0000/.test(text)) return 'obj';
  return null;
}

export function avatarSummary(r: AvatarRow) {
  const info = safeJson<Partial<ModelInfo> & { report?: OptimizeResult['report'] }>(r.info, {});
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    status: r.status,
    error: r.error,
    format: r.format,
    model: mediaUrl(r.model_media),
    low: mediaUrl(r.low_media),
    thumb: mediaUrl(r.thumb_media),
    triangles: info.triangles ?? null,
    size: info.report?.after ?? null,
    warnings: (info.warnings ?? []).length,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
export type AvatarSummary = ReturnType<typeof avatarSummary>;

export function avatarDetail(r: AvatarRow) {
  return { ...avatarSummary(r), config: parseConfig(r.config), info: safeJson<Record<string, unknown>>(r.info, {}), source: mediaUrl(r.source_media) };
}

function safeJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function parseConfig(s: string): AvatarConfig {
  const r = AvatarConfigSchema.safeParse(safeJson(s, {}));
  return r.success ? r.data : AvatarConfigSchema.parse({});
}

export function getAvatarRow(ctx: AppContext, owner: string, id: string): AvatarRow {
  const r = ctx.db.prepare('SELECT * FROM avatars WHERE id = ? AND owner_id = ?').get(id, owner) as AvatarRow | undefined;
  if (!r) throw new HttpError(404, 'Avatar not found');
  return r;
}

export function listAvatars(ctx: AppContext, owner: string) {
  const rows = ctx.db.prepare('SELECT * FROM avatars WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 500').all(owner) as AvatarRow[];
  // A model left "processing" by a restart is picked up again.
  for (const r of rows) if (r.status === 'processing' && !queued.has(r.id)) enqueue(ctx, owner, r.id);
  return rows.map(avatarSummary);
}

// ---------------------------------------------------------------------------------------------
// Processing queue
// ---------------------------------------------------------------------------------------------

const queued = new Set<string>();
let chain: Promise<unknown> = Promise.resolve();
const settled = new Map<string, Promise<void>>();

function enqueue(ctx: AppContext, owner: string, id: string, opts: Partial<OptimizeOptions> = {}) {
  queued.add(id);
  const p = chain.then(() => processAvatar(ctx, owner, id, opts)).finally(() => queued.delete(id));
  chain = p.catch(() => undefined);
  settled.set(
    id,
    p.catch(() => undefined),
  );
}

/** Resolves when the avatar's current processing finishes (tests and the CLI use this). */
export async function avatarSettled(id: string) {
  await settled.get(id);
}

let workerFile: string | null | undefined;
function workerPath(): string | null {
  if (workerFile === undefined) {
    // The built server has dist/avatar-worker.js beside it; from source, optimize on this thread.
    const f = path.join(path.dirname(fileURLToPath(import.meta.url)), 'avatar-worker.js');
    workerFile = existsSync(f) ? f : null;
  }
  return workerFile;
}

function optimizeOffThread(bytes: Buffer, opts: OptimizeOptions): Promise<OptimizeResult> {
  const file = workerPath();
  if (!file) return optimizeModel(bytes, opts);
  return new Promise((resolve, reject) => {
    const w = new Worker(file, { stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 2048 } });
    const timer = setTimeout(() => {
      void w.terminate();
      reject(new Error('Optimizing took too long'));
    }, 10 * 60_000);
    w.once('message', (m: { ok: boolean; main?: Uint8Array; low?: Uint8Array; report?: OptimizeResult['report']; error?: string }) => {
      clearTimeout(timer);
      void w.terminate();
      if (m.ok) resolve({ main: Buffer.from(m.main!), low: Buffer.from(m.low!), report: m.report! });
      else reject(new Error(m.error ?? 'Optimizing failed'));
    });
    w.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    w.postMessage({ bytes, opts });
  });
}

function setStatus(ctx: AppContext, owner: string, id: string, patch: Partial<AvatarRow>) {
  const keys = Object.keys(patch);
  ctx.db.prepare(`UPDATE avatars SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @now WHERE id = @id AND owner_id = @owner`).run({ ...patch, now: Date.now(), id, owner });
}

async function processAvatar(ctx: AppContext, owner: string, id: string, opts: Partial<OptimizeOptions>) {
  let row: AvatarRow;
  try {
    row = getAvatarRow(ctx, owner, id);
  } catch {
    return; // deleted while waiting
  }
  const old = { model: row.model_media, low: row.low_media };
  try {
    if (!row.source_media) throw new Error('The original file is missing');
    const src = readMedia(ctx, owner, row.source_media);
    const ext = path.extname(src.row.filename).slice(1) as SourceType;
    let glb = src.bytes;
    let conversion: Record<string, unknown> | null = null;
    if (BLENDER_TYPES.has(ext)) {
      const r = await runBlenderJob(ctx, owner, { op: 'convert', files: { [`input.${ext}`]: src.bytes }, input: `input.${ext}`, output: 'output.glb' });
      glb = r.output;
      conversion = r.result;
    }
    const info = await inspectModel(glb);
    const result = await optimizeOffThread(glb, { format: info.format, ...opts });
    // The row may have been deleted while this ran.
    if (!ctx.db.prepare('SELECT 1 FROM avatars WHERE id = ? AND owner_id = ?').get(id, owner)) return;
    const main = saveModelFile(ctx, owner, result.main, { kind: 'model', ext: info.format === 'glb' ? 'glb' : 'vrm', meta: { avatar: id } });
    const low = saveModelFile(ctx, owner, result.low, { kind: 'model-low', ext: info.format === 'glb' ? 'glb' : 'vrm', meta: { avatar: id } });
    const config = parseConfig(row.config);
    // First run: start from the automatic mapping and the detected units.
    const fresh = !Object.keys(config.boneMap).length;
    // Size is left at 1: the browser measures the rendered model (root scales included) and fits it.
    const next: AvatarConfig = fresh ? { ...config, boneMap: info.boneMap, expressionMap: info.expressionMap } : config;
    setStatus(ctx, owner, id, {
      status: 'ready',
      error: null,
      format: info.format,
      model_media: main.id,
      low_media: low.id,
      config: JSON.stringify(next),
      info: JSON.stringify({ ...info, report: result.report, conversion, optimize: opts }),
    });
    for (const m of [old.model, old.low]) if (m) deleteMedia(ctx, owner, m);
  } catch (e) {
    const msg = e instanceof HttpError || e instanceof Error ? e.message : String(e);
    try {
      setStatus(ctx, owner, id, { status: 'failed', error: msg.slice(0, 400) });
    } catch {
      /* deleted */
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------------------------

export function createAvatar(ctx: AppContext, owner: string, bytes: Buffer, opts: { name?: string; filename?: string; kind?: AvatarKind; config?: Partial<AvatarConfig> }) {
  if (bytes.length < 64) throw new HttpError(400, 'The file is empty');
  const type = sniffModel(bytes, opts.filename);
  if (!type) throw new HttpError(415, 'Unsupported 3D file. Use GLB, VRM (0.x or 1.0), FBX, PMX/PMD, OBJ or DAE.');
  if (type === 'glb') {
    try {
      parseGlb(bytes);
    } catch (e) {
      throw new HttpError(400, `The file could not be read: ${(e as Error).message}`);
    }
  }
  const ext = type === 'glb' ? (/\.vrm$/i.test(opts.filename ?? '') ? 'vrm' : 'glb') : type;
  const src = saveModelFile(ctx, owner, bytes, { kind: 'model-source', ext, meta: { filename: (opts.filename ?? '').slice(0, 200) } });
  const id = newId('av_');
  const now = Date.now();
  const name = (opts.name || (opts.filename ?? '').replace(/\.[^.]+$/, '') || 'New avatar').trim().slice(0, 80);
  const config = AvatarConfigSchema.parse(opts.config ?? {});
  ctx.db
    .prepare('INSERT INTO avatars (id, owner_id, name, kind, status, format, source_media, config, info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner, name, opts.kind ?? 'imported', 'processing', type === 'glb' ? 'glb' : type, src.id, JSON.stringify(config), '{}', now, now);
  enqueue(ctx, owner, id);
  return avatarSummary(getAvatarRow(ctx, owner, id));
}

export function reprocessAvatar(ctx: AppContext, owner: string, id: string, opts: Partial<OptimizeOptions>) {
  const row = getAvatarRow(ctx, owner, id);
  if (row.status === 'processing' && queued.has(id)) throw new HttpError(409, 'This avatar is already being processed');
  setStatus(ctx, owner, id, { status: 'processing', error: null });
  enqueue(ctx, owner, id, opts);
  return avatarSummary(getAvatarRow(ctx, owner, id));
}

export function updateAvatar(ctx: AppContext, owner: string, id: string, patch: { name?: string; config?: unknown }) {
  const row = getAvatarRow(ctx, owner, id);
  const set: Partial<AvatarRow> = {};
  if (patch.name !== undefined) set.name = patch.name.trim().slice(0, 80) || row.name;
  if (patch.config !== undefined) {
    const r = AvatarConfigSchema.safeParse(patch.config);
    if (!r.success) throw new HttpError(400, `Invalid avatar settings: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
    // Outfit models must be this owner's model files.
    for (const o of r.data.outfits) for (const m of [o.model, o.modelLow]) if (m && !ctx.db.prepare("SELECT 1 FROM media WHERE id = ? AND owner_id = ? AND kind LIKE 'model%'").get(m, owner)) throw new HttpError(400, 'An outfit points at a missing model file');
    set.config = JSON.stringify(r.data);
  }
  if (Object.keys(set).length) setStatus(ctx, owner, id, set);
  return avatarDetail(getAvatarRow(ctx, owner, id));
}

export async function setAvatarThumbnail(ctx: AppContext, owner: string, id: string, bytes: Buffer) {
  const row = getAvatarRow(ctx, owner, id);
  const img = await saveImage(ctx, owner, bytes, { kind: 'avatar-thumb', maxDim: 512, meta: { avatar: id } });
  setStatus(ctx, owner, id, { thumb_media: img.id });
  if (row.thumb_media) deleteMedia(ctx, owner, row.thumb_media);
  return avatarSummary(getAvatarRow(ctx, owner, id));
}

/** Deletes the avatar, its files and outfit files, and unlinks characters that used it. */
export function deleteAvatar(ctx: AppContext, owner: string, id: string) {
  const row = getAvatarRow(ctx, owner, id);
  const cfg = parseConfig(row.config);
  const files = [row.source_media, row.model_media, row.low_media, row.thumb_media, ...cfg.outfits.flatMap((o) => [o.model, o.modelLow])].filter((x): x is string => !!x);
  ctx.db.prepare('DELETE FROM avatars WHERE id = ? AND owner_id = ?').run(id, owner);
  for (const f of files) deleteMedia(ctx, owner, f);
  const chars = ctx.db.prepare("SELECT id, game FROM characters WHERE owner_id = ? AND json_extract(game, '$.avatar3d') = ?").all(owner, id) as Array<{ id: string; game: string }>;
  for (const c of chars) {
    const game = safeJson<Record<string, unknown>>(c.game, {});
    delete game.avatar3d;
    ctx.db.prepare('UPDATE characters SET game = ? WHERE id = ?').run(JSON.stringify(game), c.id);
  }
  return { ok: true, unlinked: chars.length };
}

/** Adds a whole-model outfit (level 1): a model file with the same skeleton. */
export async function addOutfitModel(ctx: AppContext, owner: string, id: string, bytes: Buffer, filename: string) {
  getAvatarRow(ctx, owner, id);
  if (!isGlb(bytes)) throw new HttpError(415, 'Outfit models must be GLB or VRM (convert other formats by importing them as an avatar first)');
  const info = await inspectModel(bytes);
  const r = await optimizeOffThread(bytes, { format: info.format });
  const ext = info.format === 'glb' ? 'glb' : 'vrm';
  const main = saveModelFile(ctx, owner, r.main, { kind: 'model', ext, meta: { avatar: id, outfit: filename.slice(0, 120) } });
  const low = saveModelFile(ctx, owner, r.low, { kind: 'model-low', ext, meta: { avatar: id } });
  return { model: main.id, modelLow: low.id, url: mediaUrl(main.id), triangles: info.triangles, warnings: info.warnings };
}

/** The emotes the story may use: built-in plus the owner's imported clips. */
export function emotesFor(ctx: AppContext, owner: string) {
  const rows = ctx.db.prepare('SELECT emote AS id, label, category, data FROM avatar_clips WHERE owner_id = ?').all(owner) as Array<{ id: string; label: string; category: string; data: string }>;
  return installedEmotes(rows.map((r) => ({ id: r.id, label: r.label, category: r.category, loop: safeJson<{ loop?: boolean }>(r.data, {}).loop })));
}

/**
 * Emotes to offer in a chat's prompts: only when one of its characters has a 3D avatar (otherwise
 * the avatar ops aren't described at all, which keeps the prompt shorter).
 */
export function emotesForChat(ctx: AppContext, owner: string, characterIds: string[]) {
  if (!characterIds.length) return [];
  const has = ctx.db.prepare(`SELECT 1 FROM characters WHERE owner_id = ? AND id IN (${characterIds.map(() => '?').join(',')}) AND json_extract(game, '$.avatar3d') IS NOT NULL LIMIT 1`).get(owner, ...characterIds);
  return has ? emotesFor(ctx, owner) : [];
}
