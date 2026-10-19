/**
 * Puppets v2 (full-body, auto-rigged): character packs imported, listed, served and deleted. See
 * services/puppets2/store.ts.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { deletePuppet2, importPuppet2, listPuppets2, puppets2Dir } from '../services/puppets2/store.js';
import { parse } from '../util/validate.js';
import { readContentFile } from '../vault/vault.js';

const opts = z.object({ name: z.string().trim().min(1).max(80).optional(), rating: z.enum(['all-ages', '18+']).optional() });
const FILE = /^((front|threeQuarter|side|back)\.r2d\.json|t_[A-Za-z0-9_-]{1,120}\.png)$/;

export function registerPuppets2(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/puppets2', async (req) => listPuppets2(ctx, owner(req)).map((p) => ({ ...p, base: `/api/puppets2/${p.id}/` })));
  /** A character pack (zip with character.json and the layer pictures) as the body, with ?name=&rating=. */
  app.post('/api/puppets2/import', { bodyLimit: 200 * 1024 * 1024 }, async (req) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the character pack (zip) as the request body');
    const o = parse(opts, req.query ?? {});
    return importPuppet2(ctx, owner(req), req.body as Buffer, o);
  });
  app.delete('/api/puppets2/:id', async (req) => {
    deletePuppet2(ctx, owner(req), (req.params as { id: string }).id);
    return { ok: true };
  });
  app.get('/api/puppets2/:id/:file', async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    if (!FILE.test(file)) throw new HttpError(404, 'Not found');
    const f = path.join(puppets2Dir(ctx, owner(req), id), file);
    if (!existsSync(f) || statSync(f).isDirectory()) throw new HttpError(404, 'Not found');
    const type = file.endsWith('.png') ? 'image/png' : 'application/json';
    return reply.header('content-type', type).header('cache-control', ctx.vault.enabled ? 'no-store' : 'private, max-age=3600').header('x-content-type-options', 'nosniff').send(readContentFile(ctx.vault, f));
  });
}
