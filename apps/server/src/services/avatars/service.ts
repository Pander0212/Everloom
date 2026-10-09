/**
 * 3D avatars: upload, conversion (Blender, for FBX/PMX/OBJ/DAE), inspection, optimization and the
 * saved settings. Processing happens in the background, one model at a time; the row's status
 * says where it is (processing → ready, or failed with a readable reason).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { allowedPaired, AvatarConfigSchema, BUILTIN_PAIRED, installedEmotes, modelUrl, PairedClipSchema, regionOfBone, type AvatarConfig, type AvatarKind, type GarmentSlot, type HumanBone, type PairedInfo } from '@everloom/engine';
import { assertAdultAvatar } from './adult.js';
import { HttpError, type AppContext } from '../../context.js';
import { newId } from '../../security/crypto.js';
import { deleteMedia, mediaUrl, readMedia, saveImage, saveModelFile } from '../media.js';
import { findBlender, runBlenderJob } from '../blender.js';
import { blendJobFiles, blendNotes, blendVersion, isBlend, newerThan, zipHasBlend } from './blendfile.js';
import { isGlb, parseGlb } from './glb.js';
import { inspectModel, type ModelInfo } from './inspect.js';
import { optimizeModel, type OptimizeOptions, type OptimizeResult } from './optimize.js';
import sharp from 'sharp';

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

export type SourceType = 'glb' | 'fbx' | 'pmx' | 'pmd' | 'obj' | 'dae' | 'blend' | 'zip';
const BLENDER_TYPES = new Set<SourceType>(['fbx', 'pmx', 'pmd', 'obj', 'dae', 'blend', 'zip']);

/** What kind of 3D file this is, by its bytes (the name only breaks ties for text formats). */
export function sniffModel(b: Buffer, filename = ''): SourceType | null {
  if (isGlb(b)) return 'glb';
  const head = b.subarray(0, 64).toString('latin1');
  if (head.startsWith('Kaydara FBX Binary')) return 'fbx';
  if (/^\s*; FBX \d/.test(head)) return 'fbx';
  if (head.startsWith('PMX ')) return 'pmx';
  if (head.startsWith('Pmd')) return 'pmd';
  if (isBlend(b, filename)) return 'blend';
  // A zip with a .blend and the folders its textures are in.
  if (/\.zip$/i.test(filename) && zipHasBlend(b)) return 'zip';
  const text = b.subarray(0, 4096).toString('utf8');
  if (/<COLLADA[\s>]/.test(text)) return 'dae';
  if (/\.obj$/i.test(filename) && /^(v|vt|vn|f|o|g|mtllib|#)\s/m.test(text) && !/\u0000/.test(text)) return 'obj';
  return null;
}

export function avatarSummary(r: AvatarRow) {
  const info = safeJson<Partial<ModelInfo> & { report?: OptimizeResult['report']; processingStage?: string }>(r.info, {});
  // Parts-made avatars wear their body straight from the pack (a built-in pack's file, or media).
  const body = r.kind === 'parts' && !r.model_media ? (safeJson<{ maker?: { body?: string } }>(r.config, {}).maker?.body ?? null) : null;
  return {
    id: r.id,
    name: r.name,
    adult: parseConfig(r.config).content.adult,
    kind: r.kind,
    status: r.status,
    error: r.error,
    processingStage: info.processingStage ?? (r.status === 'processing' ? 'Queued for preparation' : null),
    format: r.format,
    model: body ? modelUrl(body) : mediaUrl(r.model_media),
    low: body ? modelUrl(body) : mediaUrl(r.low_media),
    thumb: mediaUrl(r.thumb_media),
    triangles: info.triangles ?? null,
    size: info.report?.after ?? info.bytes ?? null,
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
const settled = new Map<string, Promise<void>>();

function enqueue(ctx: AppContext, owner: string, id: string, opts: Partial<OptimizeOptions> = {}) {
  queued.add(id);
  // Inspection must not queue behind an optional encoder for another avatar.
  const p = processAvatar(ctx, owner, id, opts).finally(() => queued.delete(id));
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
    // Source previews can use the built worker too. Encoding on the HTTP thread stalls the
    // editor's navigation and polling even when the character itself is already valid.
    const candidates = [path.join(path.dirname(fileURLToPath(import.meta.url)), 'avatar-worker.js'), fileURLToPath(new URL('../../../dist/avatar-worker.js', import.meta.url))];
    workerFile = candidates.find(f => existsSync(f)) ?? null;
  }
  return workerFile;
}

export function optimizeOffThread(bytes: Buffer, opts: OptimizeOptions): Promise<OptimizeResult> {
  const file = workerPath();
  if (!file) return optimizeModel(bytes, opts);
  return new Promise((resolve, reject) => {
    const w = new Worker(file, { stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 2048 } });
    let received = false;
    const timer = setTimeout(() => {
      void w.terminate();
      reject(new Error('Optimizing took too long'));
    }, 10 * 60_000);
    w.once('message', (m: { ok: boolean; main?: Uint8Array; low?: Uint8Array; report?: OptimizeResult['report']; error?: string }) => {
      received = true;
      clearTimeout(timer);
      void w.terminate();
      if (m.ok) resolve({ main: Buffer.from(m.main!), low: Buffer.from(m.low!), report: m.report! });
      else reject(new Error(m.error ?? 'Optimizing failed'));
    });
    w.once('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    w.once('exit', (code) => {
      clearTimeout(timer);
      if (!received) reject(new Error(`The optimizer worker stopped (exit ${code}). The original model can still be used.`));
    });
    w.postMessage({ bytes, opts });
  });
}

let optimizationChain: Promise<unknown> = Promise.resolve(), pendingOptimizations = 0;
function optionalOptimization(bytes: Buffer, opts: OptimizeOptions) {
  if (pendingOptimizations >= 2) return Promise.reject(new Error('The optimizer is busy. The original model is ready; optimize it later from the editor.'));
  pendingOptimizations++;
  const job = optimizationChain.then(() => optimizeOffThread(bytes, opts)).finally(() => pendingOptimizations--);
  optimizationChain = job.catch(() => {});
  return job;
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
  let step = 'Reading stored source';
  const progress = (label: string) => {
    step = label;
    const current = getAvatarRow(ctx, owner, id);
    setStatus(ctx, owner, id, { info: JSON.stringify({ ...safeJson<Record<string, unknown>>(current.info, {}), processingStage: label }) });
  };
  try {
    progress(step);
    if (!row.source_media) throw new Error('The original file is missing');
    const src = readMedia(ctx, owner, row.source_media);
    const ext = path.extname(src.row.filename).slice(1) as SourceType;
    let glb = src.bytes;
    let conversion: Record<string, unknown> | null = null;
    let fileVersion: string | null = null;
    if (ext === 'blend' || ext === 'zip') {
      progress('Optional Blender conversion');
      const job = blendJobFiles(src.bytes, `model.${ext === 'zip' ? 'zip' : 'blend'}`);
      fileVersion = blendVersion(job.files[job.input]!);
      try {
        const r = await runBlenderJob(ctx, owner, { op: 'convert', files: job.files, input: job.input, output: 'output.glb', timeoutMs: 8 * 60_000 });
        glb = r.output;
        conversion = r.result;
      } catch (e) {
        // Say plainly when the file is newer than the Blender that tried to open it.
        const info = await findBlender(ctx, owner).catch(() => null);
        const have = info?.version?.replace(/\s.*$/, '') ?? null;
        if (newerThan(fileVersion, have)) throw new Error(`This .blend was saved with Blender ${fileVersion}; the Blender here is ${have}, which couldn't open it. Install Blender ${fileVersion} or newer (Settings › 3D characters › Blender), or export the character as GLB from Blender.`);
        throw e;
      }
    } else if (BLENDER_TYPES.has(ext)) {
      progress('Optional Blender conversion');
      const r = await runBlenderJob(ctx, owner, { op: 'convert', files: { [`input.${ext}`]: src.bytes }, input: `input.${ext}`, output: 'output.glb' });
      glb = r.output;
      conversion = r.result;
    }
    progress('Inspecting meshes, bones and expressions');
    const info = await inspectModel(glb);
    if (conversion) info.warnings.push(...blendNotes(conversion, fileVersion));
    const basic = conversion ? saveModelFile(ctx, owner, glb, { kind: 'model', ext: 'glb', meta: { avatar: id, basic: true } }).id : src.row.id;
    const initialConfig = parseConfig(getAvatarRow(ctx, owner, id).config);
    const mappedConfig = { ...initialConfig, rig: initialConfig.rig ?? info.rig, boneMap: Object.keys(initialConfig.boneMap).length ? initialConfig.boneMap : info.boneMap, expressionMap: Object.keys(initialConfig.expressionMap).length ? initialConfig.expressionMap : info.expressionMap };
    // The validated original is usable now. Optional compression never gates the
    // editor or stage, even when encoding takes minutes or another job is busy.
    setStatus(ctx, owner, id, { status: 'ready', error: null, format: info.format, model_media: basic, low_media: basic, config: JSON.stringify(mappedConfig), info: JSON.stringify({ ...info, processingStage: 'Preparing optional optimized copies', conversion }) });
    // Compression is optional. Keep a valid original even when an encoder cannot handle it.
    let result: OptimizeResult;
    progress('Preparing optional optimized copies');
    try {
      result = await optionalOptimization(glb, { format: info.format, ktx2: false, ...opts });
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Unknown optimizer error';
      info.warnings.push({ code: 'optimization_skipped', message: `Imported the original model. Optimization failed: ${reason.slice(0, 240)}`, level: 'info' });
      result = { main: glb, low: glb, report: { before: glb.length, after: glb.length, low: glb.length, textures: 'original', ktx2: 0, webp: 0, ms: 0, notes: ['Optimization skipped; the original remains usable.'] } };
    }
    // The row may have been deleted while this ran.
    if (!ctx.db.prepare('SELECT 1 FROM avatars WHERE id = ? AND owner_id = ?').get(id, owner)) return;
    progress('Saving prepared media');
    const main = saveModelFile(ctx, owner, result.main, { kind: 'model', ext: info.format === 'glb' ? 'glb' : 'vrm', meta: { avatar: id } });
    const low = saveModelFile(ctx, owner, result.low, { kind: 'model-low', ext: info.format === 'glb' ? 'glb' : 'vrm', meta: { avatar: id } });
    // Size is left at 1: the browser measures the rendered model (root scales included) and fits it.
    // Settings may be edited while optimization runs. Never replace those edits with the
    // processing job's initial snapshot.
    const currentConfig = parseConfig(getAvatarRow(ctx, owner, id).config);
    const next: AvatarConfig = { ...currentConfig, rig: currentConfig.rig ?? info.rig, boneMap: Object.keys(currentConfig.boneMap).length ? currentConfig.boneMap : info.boneMap, expressionMap: Object.keys(currentConfig.expressionMap).length ? currentConfig.expressionMap : info.expressionMap };
    setStatus(ctx, owner, id, {
      status: 'ready',
      error: null,
      format: info.format,
      model_media: main.id,
      low_media: low.id,
      config: JSON.stringify(next),
      info: JSON.stringify({ ...info, report: result.report, conversion, optimize: opts }),
    });
    for (const m of new Set([old.model, old.low, conversion ? basic : null])) if (m && m !== row.source_media) deleteMedia(ctx, owner, m);
  } catch (e) {
    const msg = e instanceof HttpError || e instanceof Error ? e.message : String(e);
    try {
      const current = getAvatarRow(ctx, owner, id);
      if (current.status === 'ready' && current.model_media) {
        const preserved = safeJson<Record<string, unknown>>(current.info, {});
        delete preserved.processingStage;
        setStatus(ctx, owner, id, { info: JSON.stringify({ ...preserved, preparationError: `${step}: ${msg}`.slice(0, 400) }) });
      } else setStatus(ctx, owner, id, { status: 'failed', error: `${step}: ${msg}`.slice(0, 400) });
    } catch {
      /* deleted */
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------------------------

export function createAvatar(ctx: AppContext, owner: string, bytes: Buffer, opts: { name?: string; filename?: string; kind?: AvatarKind; config?: Partial<AvatarConfig>; id?: string }) {
  if (bytes.length < 64) throw new HttpError(400, 'The file is empty');
  const type = sniffModel(bytes, opts.filename);
  if (!type) throw new HttpError(415, 'Unsupported 3D file. Use GLB, VRM (0.x or 1.0), .blend (or a zip with a .blend and its textures), FBX, PMX/PMD, OBJ or DAE.');
  if (type === 'glb') {
    try {
      parseGlb(bytes);
    } catch (e) {
      throw new HttpError(400, `The file could not be read: ${(e as Error).message}`);
    }
  }
  const ext = type === 'glb' ? (/\.vrm$/i.test(opts.filename ?? '') ? 'vrm' : 'glb') : type;
  const config = AvatarConfigSchema.parse(opts.config ?? {});
  if (config.makehuman && !config.family) config.family = `makehuman:${config.makehuman.rig.split('/').pop()!.replace(/^rig\.|\.json$/g, '')}`.slice(0, 40);
  assertAdultAvatar(ctx, owner, config);
  assertConfigMedia(ctx, owner, config);
  const src = saveModelFile(ctx, owner, bytes, { kind: 'model-source', ext, meta: { filename: (opts.filename ?? '').slice(0, 200) } });
  const id = opts.id ?? newId('av_');
  const now = Date.now();
  const name = (opts.name || (opts.filename ?? '').replace(/\.[^.]+$/, '') || 'New avatar').trim().slice(0, 80);
  ctx.db
    .prepare('INSERT INTO avatars (id, owner_id, name, kind, status, format, source_media, config, info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner, name, opts.kind ?? 'imported', 'processing', type === 'glb' ? 'glb' : type, src.id, JSON.stringify(config), '{}', now, now);
  enqueue(ctx, owner, id);
  return avatarSummary(getAvatarRow(ctx, owner, id));
}

export function reprocessAvatar(ctx: AppContext, owner: string, id: string, opts: Partial<OptimizeOptions>) {
  const row = getAvatarRow(ctx, owner, id);
  if (row.kind === 'code') throw new HttpError(400, 'Code-made characters have no model file to optimize');
  if (queued.has(id)) throw new HttpError(409, 'This avatar is already being processed');
  setStatus(ctx, owner, id, { status: 'processing', error: null });
  enqueue(ctx, owner, id, opts);
  return avatarSummary(getAvatarRow(ctx, owner, id));
}

/** Save a browser-built native body and its recipe together, so bundles carry the latest shape. */
function assertConfigMedia(ctx: AppContext, owner: string, config: AvatarConfig) {
  const textures = new Set<string>();
  for (const overrides of [config.materialOverrides, ...config.outfits.map(o => o.materialOverrides ?? {})]) for (const value of Object.values(overrides)) for (const texture of [value.texture, value.shadeTexture]) if (texture) textures.add(texture);
  for (const garment of config.garments) for (const variant of garment.variants) if (variant.texture) textures.add(variant.texture);
  for (const texture of textures) {
    const media = ctx.db.prepare("SELECT meta FROM media WHERE id = ? AND owner_id = ? AND mime LIKE 'image/%'").get(texture, owner) as { meta: string } | undefined;
    if (!media) throw new HttpError(400, 'A material texture is missing or belongs to another account.');
    if (safeJson<{ adult?: boolean }>(media.meta, {}).adult === true && !config.content.adult) throw new HttpError(403, 'Adult textures can only be applied to an eligible adult character.');
  }
  for (const outfit of config.outfits) for (const media of [outfit.model, outfit.modelLow]) if (media && !ctx.db.prepare("SELECT 1 FROM media WHERE id = ? AND owner_id = ? AND kind LIKE 'model%'").get(media, owner)) throw new HttpError(400, 'An outfit points at a missing model file');
}

export async function replaceNativeBody(ctx: AppContext, owner: string, id: string, bytes: Buffer) {
  const row = getAvatarRow(ctx, owner, id);
  if (queued.has(id)) throw new HttpError(409, 'Wait for the current model preparation to finish.');
  const glb = parseGlb(bytes);
  const input = (glb.json.nodes ?? []).map(node => (node as { extras?: { everloom?: { config?: unknown } } }).extras?.everloom?.config).find(Boolean);
  const parsed = AvatarConfigSchema.safeParse(input);
  if (!parsed.success || !parsed.data.makehuman) throw new HttpError(400, 'The native model is missing its MakeHuman recipe.');
  assertAdultAvatar(ctx, owner, parsed.data, id);
  assertConfigMedia(ctx, owner, parsed.data);
  await inspectModel(bytes, glb);
  const source = saveModelFile(ctx, owner, bytes, { kind: 'model-source', ext: 'glb', meta: { avatar: id, native: true } });
  setStatus(ctx, owner, id, { source_media: source.id, config: JSON.stringify(parsed.data), kind: 'makehuman', status: 'processing', error: null });
  enqueue(ctx, owner, id);
  if (row.source_media) deleteMedia(ctx, owner, row.source_media);
  return avatarDetail(getAvatarRow(ctx, owner, id));
}

export function updateAvatar(ctx: AppContext, owner: string, id: string, patch: { name?: string; config?: unknown }) {
  const row = getAvatarRow(ctx, owner, id);
  const set: Partial<AvatarRow> = {};
  if (patch.name !== undefined) set.name = patch.name.trim().slice(0, 80) || row.name;
  if (patch.config !== undefined) {
    const r = AvatarConfigSchema.safeParse(patch.config);
    if (!r.success) throw new HttpError(400, `Invalid avatar settings: ${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
    assertAdultAvatar(ctx, owner, r.data, id);
    assertConfigMedia(ctx, owner, r.data);
    set.config = JSON.stringify(r.data);
    if (r.data.makehuman) set.kind = 'makehuman';
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
  // A parts-made avatar's body belongs to its pack, not to the avatar.
  const own = row.kind === 'parts' ? [] : [row.model_media, row.low_media];
  // A realistic avatar's clothes were made for its body alone.
  const garments = row.kind === 'realistic' ? cfg.garments.filter((g) => cfg.family && g.family === cfg.family).flatMap((g) => [g.model, g.modelLow]) : [];
  const files = [row.source_media, ...own, row.thumb_media, ...cfg.outfits.flatMap((o) => [o.model, o.modelLow]), ...garments].filter((x): x is string => !!x && !x.startsWith('/'));
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
  return saveOutfitFiles(ctx, owner, id, bytes, filename);
}

/** Optimizes a model that goes with an avatar (an outfit or garment) and saves it with a phone copy. */
export async function saveOutfitFiles(ctx: AppContext, owner: string, id: string, bytes: Buffer, filename: string) {
  if (!isGlb(bytes)) throw new HttpError(415, 'Outfit models must be GLB or VRM (convert other formats by importing them as an avatar first)');
  const info = await inspectModel(bytes);
  let r: Pick<OptimizeResult, 'main' | 'low'>;
  try { r = await optionalOptimization(bytes, { format: info.format, ktx2: false }); }
  catch (error) {
    r = { main: bytes, low: bytes };
    info.warnings.push({ code: 'optimization_skipped', level: 'info', message: `Kept the original outfit model: ${(error as Error).message.slice(0, 240)}` });
  }
  const ext = info.format === 'glb' ? 'glb' : 'vrm';
  const main = saveModelFile(ctx, owner, r.main, { kind: 'model', ext, meta: { avatar: id, outfit: filename.slice(0, 120) } });
  const low = saveModelFile(ctx, owner, r.low, { kind: 'model-low', ext, meta: { avatar: id } });
  return { model: main.id, modelLow: low.id, url: mediaUrl(main.id), triangles: info.triangles, warnings: info.warnings };
}

/** The emotes the story may use: built-in plus the owner's imported clips. */
export function emotesFor(ctx: AppContext, owner: string) {
  const rows = ctx.db.prepare("SELECT emote AS id, label, category, data FROM avatar_clips WHERE owner_id = ? AND category != 'paired'").all(owner) as Array<{ id: string; label: string; category: string; data: string }>;
  return installedEmotes(rows.map((r) => ({ id: r.id, label: r.label, category: r.category, loop: safeJson<{ loop?: boolean }>(r.data, {}).loop })));
}

/**
 * Paired animations the story may use: built-in plus the owner's imported ones. Adult-rated ones only
 * with adult content on and confirmed; the stage still plays them only for adult characters.
 */
export function pairedFor(ctx: AppContext, owner: string): PairedInfo[] {
  const rows = ctx.db.prepare("SELECT emote AS id, label, data FROM avatar_clips WHERE owner_id = ? AND category = 'paired'").all(owner) as Array<{ id: string; label: string; data: string }>;
  const imported: PairedInfo[] = rows.flatMap((r) => {
    const p = PairedClipSchema.safeParse(safeJson(r.data, {}));
    return p.success ? [{ id: r.id, label: r.label, participants: p.data.roles.length, loop: p.data.loop, adult: p.data.adult, aliases: p.data.aliases, source: 'imported' as const }] : [];
  });
  return allowedPaired([...BUILTIN_PAIRED, ...imported.filter((p) => !BUILTIN_PAIRED.some((b) => b.id === p.id))], { adultMode: true, everyoneAdult: true });
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

/** Body presets saved on any of the owner's avatars made from the same base (same morphs and bones). */
export function morphPresetLibrary(ctx: AppContext, owner: string, base: string) {
  const rows = ctx.db.prepare('SELECT id, name, config FROM avatars WHERE owner_id = ?').all(owner) as Array<{ id: string; name: string; config: string }>;
  const out: Array<{ avatarId: string; avatarName: string; preset: NonNullable<AvatarConfig['morphs']>['presets'][number]; current: boolean }> = [];
  for (const r of rows) {
    const cfg = parseConfig(r.config);
    if (cfg.morphs?.base !== base) continue;
    // Each character's current shape is offered too, as if it were a preset.
    out.push({ avatarId: r.id, avatarName: r.name, preset: { id: 'current', name: `${r.name} (as now)`, values: cfg.morphs.values }, current: true });
    for (const p of cfg.morphs.presets) out.push({ avatarId: r.id, avatarName: r.name, preset: p, current: false });
  }
  return out;
}

/**
 * Garments that fit a body family, from all of the owner's avatars of that family (so a jacket made
 * for one fits the others). Deduplicated by model file.
 */
export function garmentLibrary(ctx: AppContext, owner: string, family: string) {
  const rows = ctx.db.prepare('SELECT id, name, config FROM avatars WHERE owner_id = ?').all(owner) as Array<{ id: string; name: string; config: string }>;
  const seen = new Set<string>();
  const out: Array<{ avatarId: string; avatarName: string; garment: AvatarConfig['garments'][number] }> = [];
  for (const r of rows) {
    const cfg = parseConfig(r.config);
    for (const g of cfg.garments) {
      if ((g.family ?? cfg.family) !== family || seen.has(g.model)) continue;
      seen.add(g.model);
      out.push({ avatarId: r.id, avatarName: r.name, garment: g });
    }
  }
  return out;
}

const FIT_INPUT = /\.(glb|gltf|obj|fbx|dae|blend)$/i;

/**
 * Fits a garment mesh (from a modelling tool or an image-to-3D service) to this avatar's body with
 * the Blender worker: aligned to its slot, wrapped just outside the skin, weighted to the skeleton.
 * Returns the garment model and the body regions it covers (for hiding skin).
 */
export async function fitGarment(ctx: AppContext, owner: string, id: string, bytes: Buffer, opts: { filename: string; slot: GarmentSlot; offset?: number }) {
  const row = getAvatarRow(ctx, owner, id);
  if (!FIT_INPUT.test(opts.filename)) throw new HttpError(415, 'Garments to fit can be GLB, OBJ, FBX, DAE or .blend files');
  const src = row.source_media ? readMedia(ctx, owner, row.source_media) : row.model_media ? readMedia(ctx, owner, row.model_media) : null;
  if (!src) throw new HttpError(400, 'This avatar has no model file to fit to');
  const bodyExt = (src.row.meta as { filename?: string } | null)?.filename?.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? 'glb';
  const cfg = parseConfig(row.config);
  // A .blend garment is turned into a GLB first (the fitting job opens the body, not the .blend).
  if (/\.blend$/i.test(opts.filename)) {
    const job = blendJobFiles(bytes, opts.filename);
    bytes = (await runBlenderJob(ctx, owner, { op: 'convert', files: job.files, input: job.input, output: 'garment.glb' })).output;
    opts = { ...opts, filename: opts.filename.replace(/\.blend$/i, '.glb') };
  }
  const garmentName = `garment.${opts.filename.split('.').pop()!.toLowerCase()}`;
  const r = await runBlenderJob(ctx, owner, {
    op: 'fit',
    files: { [`body.${['glb', 'vrm', 'fbx', 'obj', 'dae'].includes(bodyExt) ? (bodyExt === 'vrm' ? 'glb' : bodyExt) : 'glb'}`]: src.bytes, [garmentName]: bytes },
    input: garmentName,
    output: 'fitted.glb',
    extra: { body: `body.${['glb', 'vrm', 'fbx', 'obj', 'dae'].includes(bodyExt) ? (bodyExt === 'vrm' ? 'glb' : bodyExt) : 'glb'}`, slot: opts.slot, offset: opts.offset ?? 0.006, bones: cfg.boneMap, name: opts.filename.replace(/\.[^.]+$/, '').slice(0, 60) },
    timeoutMs: 4 * 60_000,
  });
  // Covered regions: bones (by the file's names) whose skin is mostly under the garment.
  const byFileName = new Map(Object.entries(cfg.boneMap).map(([canon, file]) => [file, canon as HumanBone]));
  const coverage = (r.result.coverage ?? {}) as Record<string, number>;
  const regions = new Set<string>();
  for (const [bone, frac] of Object.entries(coverage)) {
    const canon = byFileName.get(bone);
    if (canon && frac >= 0.6) regions.add(regionOfBone(canon));
  }
  const saved = await addOutfitModel(ctx, owner, id, r.output, opts.filename);
  return { ...saved, hides: [...regions], coverage, triangles: r.result.triangles as number };
}

/** Cleans up the avatar's source with Blender (merge, decimate to a budget, shrink textures) and prepares it again. */
export async function cleanupAvatar(ctx: AppContext, owner: string, id: string, opts: { maxTriangles: number; maxTexture: number }) {
  const row = getAvatarRow(ctx, owner, id);
  if (!row.source_media || row.kind !== 'imported') throw new HttpError(400, 'Only imported models can be cleaned up');
  const src = readMedia(ctx, owner, row.source_media);
  const name = (src.row.meta as { filename?: string } | null)?.filename ?? 'model.glb';
  const ext = (name.match(/\.(\w+)$/)?.[1] ?? 'glb').toLowerCase();
  const input = `source.${['fbx', 'obj', 'dae', 'pmx', 'pmd'].includes(ext) ? ext : 'glb'}`;
  const r = await runBlenderJob(ctx, owner, { op: 'optimize', files: { [input]: src.bytes }, input, output: 'clean.glb', extra: { maxTriangles: opts.maxTriangles, maxTexture: opts.maxTexture } });
  const saved = saveModelFile(ctx, owner, r.output, { kind: 'model-source', ext: 'glb', meta: { filename: name.replace(/\.\w+$/, '.glb'), cleaned: true } });
  setStatus(ctx, owner, id, { source_media: saved.id, format: 'glb' });
  deleteMedia(ctx, owner, row.source_media);
  reprocessAvatar(ctx, owner, id, {});
  return { ...r.result, avatar: avatarSummary(getAvatarRow(ctx, owner, id)) };
}

/** A turntable (8 views in a strip) rendered by Blender, saved as a picture. */
export async function renderTurntable(ctx: AppContext, owner: string, id: string) {
  const row = getAvatarRow(ctx, owner, id);
  const mediaId = row.source_media ?? row.model_media;
  if (!mediaId) throw new HttpError(400, 'This avatar has no model file to render');
  const src = readMedia(ctx, owner, mediaId);
  const name = (src.row.meta as { filename?: string } | null)?.filename ?? 'model.glb';
  const ext = (name.match(/\.(\w+)$/)?.[1] ?? 'glb').toLowerCase();
  const input = `model.${['fbx', 'obj', 'dae'].includes(ext) ? ext : 'glb'}`;
  const r = await runBlenderJob(ctx, owner, { op: 'render', files: { [input]: src.bytes }, input, output: 'turntable.zip', extra: { frames: 8, size: 256, samples: 12 }, timeoutMs: 6 * 60_000 });
  const { unzipSync } = await import('fflate');
  const frames = Object.entries(unzipSync(new Uint8Array(r.output))).sort(([a], [b]) => a.localeCompare(b)).map(([, b]) => Buffer.from(b));
  const strip = await sharp({ create: { width: 256 * frames.length, height: 256, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(frames.map((input, i) => ({ input, left: i * 256, top: 0 })))
    .png()
    .toBuffer();
  const img = await saveImage(ctx, owner, strip, { kind: 'avatar-turntable', maxDim: 4096, meta: { avatar: id } });
  return { url: mediaUrl(img.id), frames: frames.length };
}
