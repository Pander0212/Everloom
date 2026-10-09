/**
 * "Make a puppet from a picture" (docs/puppets.md › Making a puppet in the app). The owner gives a
 * character picture (one character, facing the viewer, full body, arms a little away from the
 * body; a plain background or a transparent one). The server:
 *
 * 1. removes the background (`keyBackground`) unless the picture is already transparent;
 * 2. sends it to the owner's layering connection (role "Puppet layering": a See-through worker,
 *    tools/see-through-worker, on their own GPU or a rented one): POST /reset, PUT /images/…,
 *    POST /run, poll GET /health, GET /result.zip; every call carries the worker's token;
 * 3. maps the layers onto the part schema and rigs them (`puppetFromLayers`);
 * 4. keeps the puppet in the owner's media folder (vault-aware), served at /api/puppets/:id/….
 *
 * A layering result made elsewhere (a See-through zip) can be imported the same way, without the
 * worker: `importPuppetZip`.
 */
import { keyBackground, parsePuppet, type PuppetModel } from '@everloom/engine';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import sharp from 'sharp';
import { HttpError, type AppContext } from '../../context.js';
import type { ResolvedConnection } from '../../llm/providers.js';
import { readCapped, safeFetch } from '../../util/fetch.js';
import { readContentFile, writeContentFile } from '../../vault/vault.js';
import { connectionForRole } from '../connections.js';
import { puppetFromLayers } from './build.js';

export interface PuppetJob {
  id: string;
  owner: string;
  name: string;
  state: 'running' | 'done' | 'failed';
  progress: number;
  stage: string;
  error: string | null;
  puppet: string | null;
  createdAt: number;
}

export interface PuppetMeta { id: string; name: string; rating: 'all-ages' | '18+'; createdAt: number; parts: number; source: 'picture' | 'import' }

const SAFE = /^[A-Za-z0-9_-]{1,80}$/;
const jobs = new Map<string, PuppetJob>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function puppetsDir(ctx: AppContext, owner: string, ...parts: string[]) {
  if (!SAFE.test(owner) || parts.some((p) => !SAFE.test(p))) throw new HttpError(400, 'Bad id');
  const d = path.join(ctx.cfg.mediaDir, owner, 'puppets', ...parts);
  mkdirSync(d, { recursive: true });
  return d;
}

export function getPuppetJob(owner: string, id: string): PuppetJob {
  const j = jobs.get(id);
  if (!j || j.owner !== owner) throw new HttpError(404, 'Job not found');
  return j;
}

export function listPuppets(ctx: AppContext, owner: string): PuppetMeta[] {
  const root = puppetsDir(ctx, owner);
  const out: PuppetMeta[] = [];
  for (const id of readdirSync(root)) {
    const f = path.join(root, id, 'meta.json');
    if (!SAFE.test(id) || !existsSync(f)) continue;
    try { out.push(JSON.parse(readContentFile(ctx.vault, f).toString('utf8')) as PuppetMeta); } catch { /* a puppet being written */ }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function deletePuppet(ctx: AppContext, owner: string, id: string) {
  rmSync(puppetsDir(ctx, owner, id), { recursive: true, force: true });
}

async function store(ctx: AppContext, owner: string, read: (p: string) => Buffer | null, name: string, o: { title: string; rating: 'all-ages' | '18+'; bounce?: number; source: PuppetMeta['source'] }): Promise<string> {
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  const built = await puppetFromLayers(read, name, { id, title: o.title, rating: o.rating, bounce: o.bounce });
  const dir = puppetsDir(ctx, owner, id);
  writeContentFile(ctx.vault, path.join(dir, 'puppet.json'), Buffer.from(built.json));
  built.pages.forEach((p, i) => writeContentFile(ctx.vault, path.join(dir, `page${i}.png`), p));
  const meta: PuppetMeta = { id, name: o.title, rating: o.rating, createdAt: Date.now(), parts: built.model.parts.length, source: o.source };
  writeContentFile(ctx.vault, path.join(dir, 'meta.json'), Buffer.from(JSON.stringify(meta)));
  return id;
}

/** Files of a zip, by path (folders flattened to their relative paths), with a size guard. */
function unzip(buf: Buffer): (p: string) => Buffer | null {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(buf); } catch { throw new HttpError(400, 'That is not a zip file'); }
  const total = Object.values(files).reduce((s, f) => s + f.length, 0);
  if (total > 600 * 1024 * 1024) throw new HttpError(413, 'The layering result is too large');
  return (p: string) => (files[p] ? Buffer.from(files[p]!) : null);
}

/** The name of the (first) layered picture in a result: the folder holding layers.json. */
function resultName(read: (p: string) => Buffer | null, names: string[]): string {
  for (const n of names) { const m = /^([^/]+)\/layers\.json$/.exec(n); if (m && read(n)) return m[1]!; }
  throw new HttpError(400, 'The zip has no <name>/layers.json (a See-through result from tools/see-through-worker)');
}

/**
 * A zip of finished puppets (each folder or the root holding a puppet.json and its pages), or a
 * layering result (<name>/layers.json), which is mapped and rigged here. Returns what was added.
 */
export async function importPuppetZip(ctx: AppContext, owner: string, zip: Buffer, o: { title: string; rating: 'all-ages' | '18+'; bounce?: number }): Promise<PuppetMeta[]> {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(zip); } catch { throw new HttpError(400, 'That is not a zip file'); }
  const read = (p: string) => (files[p] ? Buffer.from(files[p]!) : null);
  const finished = Object.keys(files).filter((n) => /(^|\/)puppet\.json$/.test(n));
  if (finished.length) {
    if (finished.length > 200) throw new HttpError(400, 'Too many puppets in one zip (200 at most)');
    const ids: string[] = [];
    for (const n of finished) ids.push(storeFinished(ctx, owner, read, n.slice(0, n.length - 'puppet.json'.length)));
    const all = listPuppets(ctx, owner);
    return ids.map((id) => all.find((p) => p.id === id)!);
  }
  const id = await store(ctx, owner, read, resultName(read, Object.keys(files)), { ...o, source: 'import' });
  return [listPuppets(ctx, owner).find((p) => p.id === id)!];
}

/** A finished puppet (checked against the format; its pages must be PNGs) kept as it is. */
function storeFinished(ctx: AppContext, owner: string, read: (p: string) => Buffer | null, dir: string): string {
  let model: PuppetModel;
  try { model = parsePuppet(JSON.parse(read(`${dir}puppet.json`)!.toString('utf8'))); } catch (e) { throw new HttpError(400, `${dir}puppet.json is not an Everloom puppet: ${(e as Error).message.slice(0, 200)}`); }
  const pages = model.textures.map((t) => {
    if (!/^[A-Za-z0-9_.-]{1,80}\.png$/.test(t)) throw new HttpError(400, `${dir}puppet.json names an odd texture (${t.slice(0, 40)})`);
    const b = read(`${dir}${t}`);
    if (!b || b.readUInt32BE(0) !== 0x89504e47) throw new HttpError(400, `${dir}${t} is missing or not a PNG`);
    return b;
  });
  const id = randomUUID().replace(/-/g, '').slice(0, 16);
  const out = puppetsDir(ctx, owner, id);
  // Pages are stored under the names the puppet uses; the model keeps its own name and rating.
  writeContentFile(ctx.vault, path.join(out, 'puppet.json'), Buffer.from(JSON.stringify({ ...model, textures: model.textures.map((_, i) => `page${i}.png`) })));
  pages.forEach((b, i) => writeContentFile(ctx.vault, path.join(out, `page${i}.png`), b));
  const meta: PuppetMeta = { id, name: model.name, rating: model.rating, createdAt: Date.now(), parts: model.parts.length, source: 'import' };
  writeContentFile(ctx.vault, path.join(out, 'meta.json'), Buffer.from(JSON.stringify(meta)));
  return id;
}

async function worker(conn: ResolvedConnection, p: string, init: { method?: string; body?: Buffer; timeoutMs?: number } = {}) {
  const base = (conn.baseUrl || '').replace(/\/$/, '');
  return safeFetch(`${base}${p}`, { method: init.method ?? 'GET', body: init.body ? new Blob([new Uint8Array(init.body)]) : undefined, headers: { 'x-token': conn.apiKey }, shield: false, timeoutMs: init.timeoutMs ?? 60_000 });
}

export async function testLayeringConnection(conn: ResolvedConnection): Promise<{ ok: boolean; message: string }> {
  try {
    const r = await worker(conn, '/health', { timeoutMs: 15_000 });
    if (r.status === 401) return { ok: false, message: 'The worker refused the key (its WORKER_TOKEN).' };
    if (!r.ok) return { ok: false, message: `The worker said ${r.status}.` };
    const h = (await r.json()) as { ready?: boolean; stage?: string };
    return h.ready ? { ok: true, message: 'Connected: the layering worker is ready.' } : { ok: true, message: `Connected; the worker is still setting up (${h.stage ?? 'starting'}).` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export function startPuppetJob(ctx: AppContext, owner: string, input: { image: Buffer; title: string; rating: 'all-ages' | '18+'; bounce?: number }): PuppetJob {
  const conn = connectionForRole(ctx, owner, 'layering');
  if (!conn) throw new HttpError(400, 'Add a puppet layering connection first (Settings › Connections › Puppet layering)', 'no_connection');
  const job: PuppetJob = { id: randomUUID(), owner, name: input.title, state: 'running', progress: 0, stage: 'Starting', error: null, puppet: null, createdAt: Date.now() };
  jobs.set(job.id, job);
  for (const [id, j] of jobs) if (Date.now() - j.createdAt > 86_400_000) jobs.delete(id);
  const step = (p: number, stage: string) => { job.progress = Math.round(p); job.stage = stage; };
  void (async () => {
    try {
      step(2, 'Removing the background');
      const img = sharp(input.image).rotate().ensureAlpha();
      const meta = await img.metadata();
      if (!meta.width || !meta.height) throw new HttpError(400, 'That picture could not be read');
      // Large pictures gain nothing: See-through works at 1280 px.
      const scale = Math.min(1, 2048 / Math.max(meta.width, meta.height));
      const { data, info } = await img.resize(Math.round(meta.width * scale), Math.round(meta.height * scale)).raw().toBuffer({ resolveWithObject: true });
      const keyed = keyBackground(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, info.height);
      const png = await sharp(Buffer.from(keyed), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();

      step(5, 'Waiting for the layering worker');
      const deadline = Date.now() + 40 * 60_000;
      for (;;) {
        const h = await worker(conn, '/health').then((r) => (r.ok ? r.json() as Promise<{ ready: boolean; busy: boolean; stage: string }> : null)).catch(() => null);
        if (h?.ready && !h.busy) break;
        if (Date.now() > deadline) throw new HttpError(504, 'The layering worker did not become ready');
        step(5, h ? `The worker is ${h.busy ? 'busy' : `setting up (${h.stage})`}` : 'Waiting for the layering worker');
        await sleep(10_000);
      }
      const name = `p${job.id.replace(/-/g, '').slice(0, 12)}`;
      await worker(conn, '/reset', { method: 'POST' });
      step(8, 'Uploading');
      const up = await worker(conn, `/images/${name}.png`, { method: 'PUT', body: png, timeoutMs: 120_000 });
      if (!up.ok) throw new HttpError(502, `Uploading to the worker failed (${up.status})`, 'upstream');
      const run = await worker(conn, '/run', { method: 'POST' });
      if (!run.ok) throw new HttpError(502, `The worker would not start (${run.status})`, 'upstream');
      // Layering takes a few minutes on a good GPU; progress is an estimate.
      const t0 = Date.now();
      for (;;) {
        await sleep(8_000);
        const h = await worker(conn, '/health').then((r) => (r.ok ? r.json() as Promise<{ busy: boolean; error: string | null }> : null)).catch(() => null);
        step(Math.min(85, 10 + ((Date.now() - t0) / (6 * 60_000)) * 75), 'Splitting the picture into layers');
        if (h && !h.busy) { if (h.error) throw new HttpError(502, `Layering failed: ${h.error}`, 'upstream'); break; }
        if (Date.now() > deadline) throw new HttpError(504, 'Layering took too long');
      }
      step(88, 'Downloading the layers');
      const z = await worker(conn, '/result.zip', { timeoutMs: 300_000 });
      if (!z.ok) throw new HttpError(502, `Downloading the layers failed (${z.status})`, 'upstream');
      const read = unzip(await readCapped(z, 400 * 1024 * 1024));
      step(94, 'Rigging');
      job.puppet = await store(ctx, owner, read, name, { title: input.title, rating: input.rating, bounce: input.bounce, source: 'picture' });
      job.state = 'done';
      step(100, 'Ready');
    } catch (e) {
      job.state = 'failed';
      job.error = (e as Error).message.slice(0, 300);
    }
  })();
  return job;
}
