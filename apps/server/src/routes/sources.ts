/** Online character sources: browse, preview, import, link, and update checks. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { owner, type AppContext } from '../context.js';
import { sniffImageType } from '@everloom/engine';
import { applyUpdate, sourceImage, checkUpdates, importFromSource, listProviders, provider, scanLinks, searchSource, setLink, setToken, sourceDetail } from '../services/sources.js';
import { parse } from '../util/validate.js';

const key = z.string().trim().min(3).max(200).regex(/^[^/\s]+\/[^\s]+$/, 'Expected creator/name');

export function registerSources(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/sources', async (req) => listProviders(ctx, owner(req)));
  app.get('/api/sources/:provider/search', async (req) => {
    const q = parse(
      z.object({
        q: z.string().max(200).default(''),
        page: z.coerce.number().int().min(1).max(500).default(1),
        sort: z.enum(['popular', 'new', 'updated', 'stars']).default('popular'),
        nsfw: z.enum(['0', '1']).default('0'),
        hideOwned: z.enum(['0', '1']).default('0'),
        tags: z.string().max(300).optional(),
      }),
      req.query,
    );
    return searchSource(ctx, owner(req), (req.params as { provider: string }).provider, { query: q.q, page: q.page, sort: q.sort, nsfw: q.nsfw === '1', hideOwned: q.hideOwned === '1', tags: q.tags?.split(',').map((t) => t.trim()).filter(Boolean) });
  });
  app.get('/api/sources/:provider/image', async (req, reply) => {
    const bytes = await sourceImage(ctx, owner(req), (req.params as { provider: string }).provider, parse(z.object({ url: z.string().max(1000) }), req.query).url);
    const type = sniffImageType(new Uint8Array(bytes.subarray(0, 16)));
    if (!type) return reply.code(415).send({ error: 'Not an image' });
    return reply.header('content-type', `image/${type}`).header('cache-control', 'private, max-age=86400').header('x-content-type-options', 'nosniff').send(bytes);
  });
  app.get('/api/sources/:provider/item', async (req) => sourceDetail(ctx, owner(req), (req.params as { provider: string }).provider, parse(z.object({ key }), req.query).key));
  app.post('/api/sources/:provider/import', async (req) => {
    const c = await importFromSource(ctx, owner(req), (req.params as { provider: string }).provider, parse(z.object({ key }), req.body).key);
    ctx.bus.publish(owner(req), 'characters.changed', {}, req.clientId);
    return c;
  });
  // The token is stored encrypted and never sent back; only whether one is set.
  app.put('/api/sources/:provider/token', async (req) => {
    setToken(ctx, owner(req), (req.params as { provider: string }).provider, parse(z.object({ token: z.string().max(500).nullable() }), req.body).token);
    return listProviders(ctx, owner(req));
  });
  app.post('/api/sources/link', async (req) => {
    const b = parse(z.object({ characterId: z.string().max(80), provider: z.string().max(40), key: key.nullable() }), req.body);
    if (b.key) {
      const p = provider(b.provider);
      setLink(ctx, owner(req), b.characterId, { provider: p.id, key: b.key, url: `${p.site}/characters/${b.key}`, version: '' });
    } else setLink(ctx, owner(req), b.characterId, null);
    ctx.bus.publish(owner(req), 'characters.changed', {}, req.clientId);
    return { ok: true };
  });
  app.get('/api/sources/scan-links', async (req) => scanLinks(ctx, owner(req)));
  app.post('/api/sources/updates', async (req) => checkUpdates(ctx, owner(req), parse(z.object({ ids: z.array(z.string().max(80)).max(2000).optional() }), req.body ?? {}).ids));
  app.post('/api/sources/updates/apply', async (req) => {
    const b = parse(z.object({ characterId: z.string().max(80), fields: z.array(z.string().max(40)).max(30).optional() }), req.body);
    const r = await applyUpdate(ctx, owner(req), b.characterId, b.fields);
    ctx.bus.publish(owner(req), 'characters.changed', {}, req.clientId);
    return r;
  });
}
