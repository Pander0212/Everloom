/**
 * Optional Live2D. The Cubism Core runtime is proprietary, so Everloom never ships it: the owner
 * uploads their own copy (from Live2D's site, under Live2D's license) and it's served only to them.
 * Models are uploaded per character as a zip holding a .model3.json and its files.
 */
import { readContentFile, writeContentFile } from '../vault/vault.js';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { unzipSync } from 'fflate';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { getCharacter } from '../services/characters.js';
import { parse } from '../util/validate.js';

const SAFE = /^[A-Za-z0-9_-]{1,80}$/;
const TYPES: Record<string, string> = { '.json': 'application/json', '.moc3': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.motion3.json': 'application/json' };

function dir(ctx: AppContext, o: string, ...parts: string[]) {
  if (!SAFE.test(o)) throw new HttpError(400, 'Bad owner id');
  const d = path.join(ctx.cfg.mediaDir, o, 'live2d', ...parts);
  mkdirSync(d, { recursive: true });
  return d;
}

/** The first *.model3.json inside a model folder, relative to it. */
function findModel(root: string): string | null {
  const walk = (d: string, depth: number): string | null => {
    if (depth > 4) return null;
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) {
        const r = walk(p, depth + 1);
        if (r) return r;
      } else if (f.endsWith('.model3.json')) return path.relative(root, p).split(path.sep).join('/');
    }
    return null;
  };
  return existsSync(root) ? walk(root, 0) : null;
}

export function registerLive2d(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/live2d', async (req) => {
    const core = path.join(dir(ctx, owner(req)), 'core.js');
    const models: Record<string, string> = {};
    const mroot = dir(ctx, owner(req), 'models');
    for (const id of readdirSync(mroot)) {
      const m = findModel(path.join(mroot, id));
      if (m) models[id] = `/api/live2d/models/${id}/${m}`;
    }
    return { coreInstalled: existsSync(core), coreUrl: existsSync(core) ? '/api/live2d/core.js' : null, models };
  });

  app.post('/api/live2d/core', { bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const b = parse(z.object({ source: z.string().min(1000).max(3_500_000) }), req.body);
    // A light sanity check that this is the Cubism Core for Web, not some other script.
    if (!/Live2DCubismCore/.test(b.source)) throw new HttpError(400, "That doesn't look like live2dcubismcore.min.js (Cubism Core for Web).");
    writeContentFile(ctx.vault, path.join(dir(ctx, owner(req)), 'core.js'), Buffer.from(b.source));
    return { coreInstalled: true };
  });
  app.delete('/api/live2d/core', async (req) => {
    rmSync(path.join(dir(ctx, owner(req)), 'core.js'), { force: true });
    return { coreInstalled: false };
  });
  app.get('/api/live2d/core.js', async (req, reply) => {
    const f = path.join(dir(ctx, owner(req)), 'core.js');
    if (!existsSync(f)) throw new HttpError(404, 'Upload the Cubism Core first');
    return reply.header('content-type', 'text/javascript; charset=utf-8').header('cache-control', ctx.vault.enabled ? 'no-store' : 'private, no-cache').send(readContentFile(ctx.vault, f));
  });

  app.post('/api/live2d/models/:characterId', { bodyLimit: 60 * 1024 * 1024 }, async (req) => {
    const id = (req.params as { characterId: string }).characterId;
    getCharacter(ctx, owner(req), id);
    if (!SAFE.test(id)) throw new HttpError(400, 'Bad id');
    const b = parse(z.object({ zip: z.string().min(100).max(80_000_000) }), req.body);
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(Buffer.from(b.zip.replace(/^data:[^;,]+;base64,/, ''), 'base64'));
    } catch {
      throw new HttpError(400, 'That is not a zip file');
    }
    const names = Object.keys(files).filter((n) => !n.endsWith('/'));
    if (!names.some((n) => n.endsWith('.model3.json'))) throw new HttpError(400, 'The zip needs a .model3.json (a Cubism 3+ model)');
    if (names.length > 400) throw new HttpError(400, 'Too many files in the zip');
    const root = dir(ctx, owner(req), 'models', id);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });
    for (const n of names) {
      const target = path.resolve(root, n);
      if (!target.startsWith(root + path.sep)) throw new HttpError(400, 'Unsafe path in the zip');
      if (!Object.keys(TYPES).some((ext) => n.toLowerCase().endsWith(ext))) continue;
      mkdirSync(path.dirname(target), { recursive: true });
      writeContentFile(ctx.vault, target, Buffer.from(files[n]!));
    }
    return { model: `/api/live2d/models/${id}/${findModel(root)}` };
  });
  app.delete('/api/live2d/models/:characterId', async (req) => {
    const id = (req.params as { characterId: string }).characterId;
    if (!SAFE.test(id)) throw new HttpError(400, 'Bad id');
    rmSync(path.join(dir(ctx, owner(req), 'models'), id), { recursive: true, force: true });
    return { ok: true };
  });
  app.get('/api/live2d/models/:characterId/*', async (req, reply) => {
    const { characterId: id, '*': rest } = req.params as { characterId: string; '*': string };
    if (!SAFE.test(id)) throw new HttpError(404, 'Not found');
    const root = path.join(dir(ctx, owner(req), 'models'), id);
    const f = path.resolve(root, decodeURIComponent(rest));
    if (!f.startsWith(root + path.sep) || !existsSync(f) || statSync(f).isDirectory()) throw new HttpError(404, 'Not found');
    const ext = Object.keys(TYPES).find((e) => f.toLowerCase().endsWith(e)) ?? '';
    return reply.header('content-type', TYPES[ext] ?? 'application/octet-stream').header('cache-control', ctx.vault.enabled ? 'no-store' : 'private, max-age=3600').header('x-content-type-options', 'nosniff').send(readContentFile(ctx.vault, f));
  });
}
