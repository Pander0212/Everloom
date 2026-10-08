/**
 * Everloom Puppets made by the owner: from a picture (through the layering connection) or from a
 * layering result zip; listed, served (puppet.json and its pages) and deleted. See
 * services/puppets/maker.ts.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { deletePuppet, getPuppetJob, importPuppetZip, listPuppets, puppetsDir, startPuppetJob } from '../services/puppets/maker.js';
import { parse } from '../util/validate.js';
import { readContentFile } from '../vault/vault.js';

const opts = z.object({ name: z.string().trim().min(1).max(80).default('My puppet'), rating: z.enum(['all-ages', '18+']).default('all-ages'), bounce: z.coerce.number().min(0).max(2).optional() });
const TYPES: Record<string, string> = { '.json': 'application/json', '.png': 'image/png' };

export function registerPuppets(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/puppets', async (req) => listPuppets(ctx, owner(req)).map((p) => ({ ...p, url: `/api/puppets/${p.id}/puppet.json` })));
  /** A character picture as the body, with ?name=&rating=&bounce=. */
  app.post('/api/puppets/make', { bodyLimit: 25 * 1024 * 1024 }, async (req) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the picture as the request body');
    const o = parse(opts, req.query ?? {});
    return startPuppetJob(ctx, owner(req), { image: req.body as Buffer, title: o.name, rating: o.rating, bounce: o.bounce });
  });
  app.get('/api/puppets/make/:job', async (req) => getPuppetJob(owner(req), (req.params as { job: string }).job));
  /** A layering result (a zip with <name>/layers.json) as the body, with ?name=&rating=&bounce=. */
  app.post('/api/puppets/import', { bodyLimit: 400 * 1024 * 1024 }, async (req) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the zip as the request body');
    const o = parse(opts, req.query ?? {});
    return importPuppetZip(ctx, owner(req), req.body as Buffer, { title: o.name, rating: o.rating, bounce: o.bounce });
  });
  app.delete('/api/puppets/:id', async (req) => {
    deletePuppet(ctx, owner(req), (req.params as { id: string }).id);
    return { ok: true };
  });
  app.get('/api/puppets/:id/:file', async (req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    if (!/^(puppet\.json|page\d{1,2}\.png)$/.test(file)) throw new HttpError(404, 'Not found');
    const f = path.join(puppetsDir(ctx, owner(req), id), file);
    if (!existsSync(f) || statSync(f).isDirectory()) throw new HttpError(404, 'Not found');
    return reply.header('content-type', TYPES[path.extname(f)] ?? 'application/octet-stream').header('cache-control', ctx.vault.enabled ? 'no-store' : 'private, max-age=3600').header('x-content-type-options', 'nosniff').send(readContentFile(ctx.vault, f));
  });
}
