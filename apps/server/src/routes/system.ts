import { createReadStream, createWriteStream, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError, owner, type AppContext } from '../context.js';
import { backupPath, createBackup, listBackups, stageRestore } from '../services/backup.js';
import { search } from '../services/search.js';
import { registerImport } from './import.js';

/** Stream a raw request body to a temp file with a size cap. */
export async function bodyToTempFile(req: FastifyRequest, maxBytes: number, suffix = '.zip'): Promise<string> {
  const dir = path.join(os.tmpdir(), 'everloom-upload');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
  let total = 0;
  const cap = new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) return cb(new HttpError(413, 'Upload too large'));
      cb(null, chunk);
    },
  });
  try {
    await pipeline(req.body as NodeJS.ReadableStream, cap, createWriteStream(file));
  } catch (e) {
    rmSync(file, { force: true });
    throw e;
  }
  return file;
}

export function registerSystem(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/search', async (req) => {
    const q = req.query as { q?: string; campaignId?: string; kinds?: string };
    return search(ctx, owner(req), String(q.q ?? ''), { campaignId: q.campaignId, kinds: q.kinds ? q.kinds.split(',') : undefined, limit: 30 });
  });

  app.get('/api/backups', async (req) => {
    owner(req);
    return listBackups(ctx);
  });
  app.post('/api/backups', async (req) => {
    owner(req);
    return createBackup(ctx, 'manual');
  });
  app.get('/api/backups/:name', async (req, reply) => {
    owner(req);
    const file = backupPath(ctx, (req.params as any).name);
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="${(req.params as any).name}"`);
    return reply.send(createReadStream(file));
  });
  app.delete('/api/backups/:name', async (req) => {
    owner(req);
    rmSync(backupPath(ctx, (req.params as any).name));
    return { ok: true };
  });

  // Large uploads are streamed to disk instead of buffered.
  app.register(async (sub) => {
    sub.removeContentTypeParser(['application/zip', 'application/octet-stream', 'application/x-zip-compressed']);
    sub.addContentTypeParser(['application/zip', 'application/octet-stream', 'application/x-zip-compressed'], { bodyLimit: 8 * 1024 * 1024 * 1024 }, (_req, payload, done) => done(null, payload));
    sub.post('/api/backups/restore', async (req) => {
      owner(req);
      const file = await bodyToTempFile(req, 4 * 1024 * 1024 * 1024);
      try {
        await stageRestore(ctx, file);
      } finally {
        rmSync(file, { force: true });
      }
      // Exit so the process manager restarts us; the restore is applied before the DB opens.
      setTimeout(() => process.exit(0), 500).unref();
      return { ok: true, restarting: true };
    });
    registerImport(sub, ctx);
  });
}
