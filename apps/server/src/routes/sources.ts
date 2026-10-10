/** Online character sources: browse, preview, import, link, update checks, accounts and diagnostics. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { owner, type AppContext } from '../context.js';
import { SOURCE_SORTS, sniffImageType, TIME_RANGES, type SourceQuery } from '@everloom/engine';
import {
  acceptNotice,
  applyUpdate,
  buildQuery,
  checkUpdates,
  deleteSavedSearch,
  importFromSource,
  importFromUrl,
  listProviders,
  listSavedSearches,
  provider,
  recordFixtures,
  saveSearch,
  scanLinks,
  searchAll,
  searchSource,
  selfTest,
  setLink,
  setToken,
  signIn,
  signOut,
  sourceDetail,
  sourceImage,
  sourceTags,
  testAccount,
} from '../services/sources.js';
import { parse } from '../util/validate.js';

const key = z.string().trim().min(3).max(200).regex(/^[^\s]+$/, 'Expected an id from the source');
const list = z
  .string()
  .max(600)
  .optional()
  .transform((v) => (v ? v.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20) : undefined));
const tri = z
  .enum(['', '0', '1'])
  .optional()
  .transform((v) => (v === '1' ? true : v === '0' ? false : undefined));
const int = z.coerce.number().int().min(0).max(1_000_000).optional();

/** The search box text plus the filter bar, as query-string fields. */
const SearchQuery = z.object({
  q: z.string().max(400).default(''),
  page: z.coerce.number().int().min(1).max(500).default(1),
  sort: z.enum(SOURCE_SORTS).optional(),
  time: z.enum(TIME_RANGES).optional(),
  tags: list,
  exclude: list,
  creator: z.string().max(80).optional(),
  minTokens: int,
  maxTokens: int,
  lorebook: tri,
  greetings: tri,
  lang: z.string().max(12).optional(),
  nsfw: z.enum(['0', '1']).default('1'),
  hideOwned: z.enum(['0', '1']).default('0'),
});

function readQuery(raw: unknown) {
  const s = parse(SearchQuery, raw);
  const extra: Partial<SourceQuery> = {
    page: s.page,
    nsfw: s.nsfw === '1',
    sort: s.sort,
    time: s.time,
    includeTags: s.tags,
    excludeTags: s.exclude,
    creator: s.creator?.trim() || undefined,
    minTokens: s.minTokens,
    maxTokens: s.maxTokens,
    hasLorebook: s.lorebook,
    hasGreetings: s.greetings,
    language: s.lang?.trim().toLowerCase() || undefined,
  };
  return { ...buildQuery(s.q, extra), hideOwned: s.hideOwned === '1' };
}

export function registerSources(app: FastifyInstance, ctx: AppContext) {
  const pid = (req: { params: unknown }) => (req.params as { provider: string }).provider;
  app.get('/api/sources', async (req) => listProviders(ctx, owner(req)));
  app.get('/api/sources/all/search', async (req) => {
    const r = readQuery(req.query);
    return { ...(await searchAll(ctx, owner(req), r.query, { hideOwned: r.hideOwned })), errors: r.errors };
  });
  app.get('/api/sources/:provider/search', async (req) => {
    const r = readQuery(req.query);
    return { ...(await searchSource(ctx, owner(req), pid(req), r.query, { hideOwned: r.hideOwned })), errors: r.errors };
  });
  app.get('/api/sources/:provider/tags', async (req) => sourceTags(ctx, owner(req), pid(req), parse(z.object({ q: z.string().max(60).default('') }), req.query).q));
  app.get('/api/sources/:provider/image', async (req, reply) => {
    const q = parse(z.object({ url: z.string().max(1000), w: z.coerce.number().int().min(32).max(2048).optional() }), req.query);
    const bytes = await sourceImage(ctx, owner(req), pid(req), q.url, q.w);
    const type = sniffImageType(new Uint8Array(bytes.subarray(0, 16)));
    if (!type) return reply.code(415).send({ error: 'Not an image' });
    return reply.header('content-type', `image/${type}`).header('cache-control', 'private, max-age=86400').header('x-content-type-options', 'nosniff').send(bytes);
  });
  app.get('/api/sources/:provider/item', async (req) => sourceDetail(ctx, owner(req), pid(req), parse(z.object({ key }), req.query).key));
  app.post('/api/sources/:provider/import', async (req) => {
    const c = await importFromSource(ctx, owner(req), pid(req), parse(z.object({ key }), req.body).key);
    ctx.bus.publish(owner(req), 'characters.changed', {}, req.clientId);
    return c;
  });
  app.post('/api/sources/import-url', async (req) => {
    const r = await importFromUrl(ctx, owner(req), parse(z.object({ url: z.string().trim().min(8).max(2000) }), req.body).url);
    ctx.bus.publish(owner(req), 'characters.changed', {}, req.clientId);
    return r;
  });
  app.post('/api/sources/:provider/notice', async (req) => {
    acceptNotice(ctx, owner(req), pid(req));
    return listProviders(ctx, owner(req));
  });

  // Accounts. Credentials are stored encrypted and never sent back; only whether one is set and its status.
  app.put('/api/sources/:provider/token', async (req) => {
    setToken(ctx, owner(req), pid(req), parse(z.object({ token: z.string().max(500).nullable() }), req.body).token);
    return listProviders(ctx, owner(req));
  });
  app.post('/api/sources/:provider/account', async (req) => {
    const b = parse(z.object({ username: z.string().trim().min(1).max(120), password: z.string().min(1).max(500), remember: z.boolean().default(true) }), req.body);
    await signIn(ctx, owner(req), pid(req), b.username, b.password, b.remember);
    return listProviders(ctx, owner(req));
  });
  app.post('/api/sources/:provider/account/test', async (req) => {
    await testAccount(ctx, owner(req), pid(req));
    return listProviders(ctx, owner(req));
  });
  app.delete('/api/sources/:provider/account', async (req) => {
    signOut(ctx, owner(req), pid(req));
    return listProviders(ctx, owner(req));
  });

  // Saved searches.
  app.get('/api/sources/saved', async (req) => listSavedSearches(ctx, owner(req)));
  app.post('/api/sources/saved', async (req) => {
    const b = parse(z.object({ provider: z.string().max(40), name: z.string().max(80), q: z.string().max(400) }), req.body);
    return saveSearch(ctx, owner(req), b.provider, b.name, buildQuery(b.q, {}).query);
  });
  app.delete('/api/sources/saved/:id', async (req) => deleteSavedSearch(ctx, owner(req), (req.params as { id: string }).id));

  // Diagnostics.
  app.post('/api/sources/:provider/self-test', async (req) => selfTest(ctx, owner(req), pid(req)));
  app.post('/api/sources/:provider/record-fixtures', async (req, reply) => {
    const zip = await recordFixtures(ctx, owner(req), pid(req));
    return reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="everloom-fixtures-${pid(req)}.zip"`).send(zip);
  });

  app.post('/api/sources/link', async (req) => {
    const b = parse(z.object({ characterId: z.string().max(80), provider: z.string().max(40), key: key.nullable() }), req.body);
    if (b.key) {
      const p = provider(b.provider);
      setLink(ctx, owner(req), b.characterId, { provider: p.id, key: b.key, url: p.urlFor(b.key), version: '' });
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
