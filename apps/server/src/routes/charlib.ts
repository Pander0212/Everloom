/** Character library routes: collections, batch actions, undo, duplicates, related, versions. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { owner, type AppContext } from '../context.js';
import { getCharacter, refreshMeta } from '../services/characters.js';
import { batch, deleteCollection, duplicates, editCollection, listCollections, mergeDuplicates, related, reorderCollections, saveCollection, undoDelete } from '../services/charlib.js';
import { deleteVersion, listVersions, restoreVersion, snapshot, versionDiff } from '../services/versions.js';
import { parse } from '../util/validate.js';
import { exportBundle, importBundle, previewBundle } from '../services/bundle.js';
import { HttpError } from '../context.js';

const ids = z.array(z.string().max(80)).max(5000);
const collectionInput = z.object({ name: z.string().trim().min(1).max(80), icon: z.string().max(40).optional(), color: z.string().max(40).optional() });

export function registerCharLib(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/library/collections', async (req) => listCollections(ctx, owner(req)));
  app.post('/api/library/collections', async (req) => saveCollection(ctx, owner(req), parse(collectionInput, req.body)));
  app.patch('/api/library/collections/:id', async (req) => saveCollection(ctx, owner(req), parse(collectionInput, req.body), (req.params as { id: string }).id));
  app.delete('/api/library/collections/:id', async (req) => {
    deleteCollection(ctx, owner(req), (req.params as { id: string }).id);
    return { ok: true };
  });
  app.post('/api/library/collections/reorder', async (req) => {
    reorderCollections(ctx, owner(req), parse(z.object({ ids }), req.body).ids);
    return listCollections(ctx, owner(req));
  });
  app.post('/api/library/collections/:id/items', async (req) => editCollection(ctx, owner(req), (req.params as { id: string }).id, parse(z.object({ add: ids.optional(), remove: ids.optional(), order: ids.optional() }), req.body)));

  app.post('/api/library/batch', async (req) => {
    const b = parse(
      z.object({
        ids,
        action: z.discriminatedUnion('action', [
          z.object({ action: z.literal('tag'), tags: z.array(z.string().max(60)).min(1).max(50) }),
          z.object({ action: z.literal('untag'), tags: z.array(z.string().max(60)).min(1).max(50) }),
          z.object({ action: z.literal('fav'), value: z.boolean() }),
          z.object({ action: z.literal('delete') }),
          z.object({ action: z.literal('collect'), collectionId: z.string().max(80) }),
          z.object({ action: z.literal('uncollect'), collectionId: z.string().max(80) }),
        ]),
      }),
      req.body,
    );
    const r = batch(ctx, owner(req), b.ids, b.action);
    ctx.bus.publish(owner(req), 'characters.changed', {}, req.clientId);
    return r;
  });
  app.post('/api/library/undo/:trashId', async (req) => {
    const n = undoDelete(ctx, owner(req), (req.params as { trashId: string }).trashId);
    ctx.bus.publish(owner(req), 'characters.changed', {}, req.clientId);
    return { restored: n };
  });

  app.get('/api/library/duplicates', async (req) => duplicates(ctx, owner(req)));
  app.post('/api/library/duplicates/merge', async (req) => {
    const b = parse(z.object({ keep: z.string().max(80), remove: ids }), req.body);
    const r = mergeDuplicates(ctx, owner(req), b.keep, b.remove);
    ctx.bus.publish(owner(req), 'characters.changed', {}, req.clientId);
    return r;
  });

  app.get('/api/characters/:id/related', async (req) => related(ctx, owner(req), (req.params as { id: string }).id));

  app.get('/api/characters/:id/versions', async (req) => listVersions(ctx, owner(req), (req.params as { id: string }).id));
  app.post('/api/characters/:id/versions', async (req) => {
    const b = parse(z.object({ label: z.string().max(120).default('') }), req.body ?? {});
    const id = snapshot(ctx, owner(req), (req.params as { id: string }).id, 'manual', b.label);
    return { id };
  });
  app.get('/api/characters/:id/versions/:vid/diff', async (req) => {
    const { id, vid } = req.params as { id: string; vid: string };
    return versionDiff(ctx, owner(req), id, vid);
  });
  app.post('/api/characters/:id/versions/:vid/restore', async (req) => {
    const { id, vid } = req.params as { id: string; vid: string };
    restoreVersion(ctx, owner(req), id, vid);
    refreshMeta(ctx, id);
    const c = getCharacter(ctx, owner(req), id);
    ctx.bus.publish(owner(req), 'characters.changed', { id }, req.clientId);
    return c;
  });
  app.delete('/api/character-versions/:vid', async (req) => {
    deleteVersion(ctx, owner(req), (req.params as { vid: string }).vid);
    return { ok: true };
  });

  app.post('/api/library/bundle', async (req, reply) => {
    const b = parse(z.object({ ids: ids.min(1), chats: z.boolean().default(true), gallery: z.boolean().default(true), lorebooks: z.boolean().default(true) }), req.body);
    const zip = await exportBundle(ctx, owner(req), b.ids, b);
    reply.header('content-type', 'application/zip');
    reply.header('content-disposition', `attachment; filename="everloom-characters-${new Date().toISOString().slice(0, 10)}.zip"`);
    return reply.send(zip);
  });
  app.post('/api/library/bundle/preview', async (req) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the zip as the request body');
    return previewBundle(ctx, owner(req), req.body as Buffer);
  });
  app.post('/api/library/bundle/import', async (req) => {
    const b = parse(z.object({ token: z.string().max(80), choices: z.record(z.string(), z.enum(['new', 'replace', 'skip'])).default({}) }), req.body);
    const r = await importBundle(ctx, owner(req), b.token, Object.fromEntries(Object.entries(b.choices).map(([k, v]) => [Number(k), v])));
    ctx.bus.publish(owner(req), 'characters.changed', {}, req.clientId);
    return r;
  });
}
