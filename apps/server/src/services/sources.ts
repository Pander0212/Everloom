/**
 * Online character sources, behind one provider interface: search/browse, preview, import (which
 * links the character to its source), the latest version for update checks, and link scanning.
 *
 * Everything is fetched here on the server (no CORS trouble on phones), cached, and rate limited per
 * provider. Only public, openly accessible endpoints are used. A card whose creator hid its
 * definition can't be imported, and adult content stays out unless the owner turned it on.
 */
import {
  chubDetail,
  chubDetailUrl,
  chubKeyFromLink,
  chubSearchResults,
  chubSearchUrl,
  CHUB,
  CTAVERN,
  ctDetail,
  ctDetailUrl,
  ctKeyFromLink,
  ctSearchResults,
  ctSearchUrl,
  PYGMALION,
  pygDetail,
  pygDetailRequest,
  pygKeyFromLink,
  pygSearchRequest,
  pygSearchResults,
  RISU,
  risuDetail,
  risuDownloadUrl,
  risuKeyFromLink,
  risuMetaUrl,
  risuSearchResults,
  risuSearchUrl,
  unflattenPageData,
  WYVERN,
  wyvDetail,
  wyvDetailUrl,
  wyvKeyFromLink,
  wyvSearchResults,
  wyvSearchUrl,
  diffCards, type CardData, type FieldDiff, type SourceDetail, type SourceItem, type SourceSearch } from '@everloom/engine';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HttpError, type AppContext } from '../context.js';
import { decrypt, encrypt } from '../security/crypto.js';
import { fetchPublic } from '../util/public-fetch.js';
import { getCharacter, importCard, updateCharacter } from './characters.js';
import { saveImage } from './media.js';
import { getSettings } from './settings.js';

// ------------------------------------------------------------------ the provider interface

export interface ProviderIO {
  /** Cached, rate-limited JSON GET (or a JSON POST when `post` is given). */
  json(url: string, opts?: { ttlMs?: number; post?: unknown }): Promise<any>;
  bytes(url: string): Promise<Buffer>;
  token: string | null;
}

export interface SourceProvider {
  id: string;
  name: string;
  site: string;
  /** How a token is used, if the provider takes one (shown in settings). */
  tokenHint?: string;
  /** Hosts its pictures come from; the image proxy fetches nothing else. */
  imageHosts: string[];
  search(q: SourceSearch, io: ProviderIO): Promise<{ items: SourceItem[]; hasMore: boolean }>;
  get(key: string, io: ProviderIO, opts?: { fresh?: boolean }): Promise<SourceDetail | null>;
  keyFromLink(link: string): string | null;
  /** The character's page on the site. */
  urlFor(key: string): string;
}

const PER_PAGE = 24;

export const chubProvider: SourceProvider = {
  id: CHUB.id,
  name: CHUB.name,
  site: CHUB.site,
  tokenHint: 'Optional. Your Chub API key makes searches follow your Chub account settings.',
  imageHosts: ['avatars.charhub.io'],
  async search(q, io) {
    const body = await io.json(chubSearchUrl(q, PER_PAGE), { ttlMs: 10 * 60_000 });
    const r = chubSearchResults(body);
    return { items: r.items, hasMore: r.total != null ? q.page * PER_PAGE < r.total : r.items.length === PER_PAGE };
  },
  async get(key, io, opts) {
    return chubDetail(await io.json(chubDetailUrl(key), { ttlMs: opts?.fresh ? 0 : 30 * 60_000 }));
  },
  keyFromLink: chubKeyFromLink,
  urlFor: (key) => `${CHUB.site}/characters/${key}`,
};

export const ctavernProvider: SourceProvider = {
  id: CTAVERN.id,
  name: CTAVERN.name,
  site: CTAVERN.site,
  imageHosts: ['cards.character-tavern.com'],
  async search(q, io) {
    const r = ctSearchResults(await io.json(ctSearchUrl(q, PER_PAGE), { ttlMs: 10 * 60_000 }));
    return { items: q.nsfw ? r.items : r.items.filter((i) => !i.nsfw), hasMore: r.hasMore };
  },
  async get(key, io, opts) {
    return ctDetail(await io.json(ctDetailUrl(key), { ttlMs: opts?.fresh ? 0 : 30 * 60_000 }));
  },
  keyFromLink: ctKeyFromLink,
  urlFor: (key) => `${CTAVERN.site}/character/${key}`,
};

export const risuProvider: SourceProvider = {
  id: RISU.id,
  name: RISU.name,
  site: RISU.site,
  imageHosts: ['sv.risuai.xyz'],
  async search(q, io) {
    const r = risuSearchResults(await io.json(risuSearchUrl(q), { ttlMs: 10 * 60_000 }));
    return { items: q.nsfw ? r.items : r.items.filter((i) => !i.nsfw), hasMore: r.hasMore };
  },
  async get(key, io, opts) {
    const ttlMs = opts?.fresh ? 0 : 30 * 60_000;
    const meta = await io.json(risuMetaUrl(key), { ttlMs });
    if (!meta) return null;
    const hidden = unflattenPageData(meta)?.card?.hidden;
    // A hidden card's definition is never downloaded.
    return risuDetail(meta, hidden ? null : await io.json(risuDownloadUrl(key), { ttlMs }));
  },
  keyFromLink: risuKeyFromLink,
  urlFor: (key) => `${RISU.site}/character/${key}`,
};

export const pygmalionProvider: SourceProvider = {
  id: PYGMALION.id,
  name: PYGMALION.name,
  site: PYGMALION.site,
  imageHosts: ['assets.pygmalion.chat'],
  async search(q, io) {
    const req = pygSearchRequest(q, PER_PAGE);
    const r = pygSearchResults(await io.json(req.url, { ttlMs: 10 * 60_000, post: req.body }), q.page, PER_PAGE);
    return { items: q.nsfw ? r.items : r.items.filter((i) => !i.nsfw), hasMore: r.hasMore };
  },
  async get(key, io, opts) {
    const req = pygDetailRequest(key);
    return pygDetail(await io.json(req.url, { ttlMs: opts?.fresh ? 0 : 30 * 60_000, post: req.body }));
  },
  keyFromLink: pygKeyFromLink,
  urlFor: (key) => `${PYGMALION.site}/character/${key}`,
};

export const wyvernProvider: SourceProvider = {
  id: WYVERN.id,
  name: WYVERN.name,
  site: WYVERN.site,
  imageHosts: ['imagedelivery.net'],
  async search(q, io) {
    const r = wyvSearchResults(await io.json(wyvSearchUrl(q, PER_PAGE), { ttlMs: 10 * 60_000 }));
    return { items: q.nsfw ? r.items : r.items.filter((i) => !i.nsfw), hasMore: r.hasMore };
  },
  async get(key, io, opts) {
    return wyvDetail(await io.json(wyvDetailUrl(key), { ttlMs: opts?.fresh ? 0 : 30 * 60_000 }));
  },
  keyFromLink: wyvKeyFromLink,
  urlFor: (key) => `${WYVERN.site}/characters/${key}`,
};

/** Sites with a public API Everloom can use from the server. The rest are in CAPABILITIES. */
export const PROVIDERS: Record<string, SourceProvider> = Object.fromEntries([chubProvider, ctavernProvider, risuProvider, pygmalionProvider, wyvernProvider].map((p) => [p.id, p]));

export type Access = 'server' | 'bridge' | 'none';
export interface Capability {
  id: string;
  name: string;
  site: string;
  access: Access;
  search: boolean;
  preview: boolean;
  import: boolean;
  updates: boolean;
  /** Why it works the way it does (shown in the app and the docs). */
  note: string;
}

/**
 * What each site allows, checked in the order the Phase 3 brief lists them (see PHASE2_DECISIONS.md
 * › Phase 3 › Character sources). "bridge" means only the player's own browser, on a page they
 * opened, can send a card; the server never tries to get past a site's bot protection.
 */
export const CAPABILITIES: Capability[] = [
  { id: 'chub', name: 'Chub', site: 'https://chub.ai', access: 'server', search: true, preview: true, import: true, updates: true, note: 'Public API. An optional API key makes results follow your Chub account settings.' },
  { id: 'ctavern', name: 'Character Tavern', site: 'https://character-tavern.com', access: 'server', search: true, preview: true, import: true, updates: true, note: 'Public search and character API; robots.txt allows it.' },
  { id: 'risu', name: 'RisuRealm', site: 'https://realm.risuai.net', access: 'server', search: true, preview: true, import: true, updates: true, note: "Search reads the site's public page data; imports use the public download API RisuAI itself uses. Hidden cards are never downloaded." },
  { id: 'pygmalion', name: 'Pygmalion', site: 'https://pygmalion.chat', access: 'server', search: true, preview: true, import: true, updates: true, note: 'Public character API. Only public characters are listed.' },
  { id: 'wyvern', name: 'Wyvern', site: 'https://app.wyvern.chat', access: 'server', search: true, preview: true, import: true, updates: true, note: "Public explore API. Fields the creator marks secret are left out and the card is labelled 'definition hidden'." },
  { id: 'botbooru', name: 'Botbooru', site: 'https://botbooru.com', access: 'bridge', search: false, preview: false, import: true, updates: false, note: 'robots.txt disallows automated access to its API and character pages, so only the browser bridge can send a card you are viewing.' },
  { id: 'aicc', name: 'AI Character Cards', site: 'https://aicharactercards.com', access: 'bridge', search: false, preview: false, import: true, updates: false, note: 'Pages sit behind a browser check, so cards come in through the browser bridge (or paste a direct card-file link).' },
  { id: 'janitor', name: 'JanitorAI', site: 'https://janitorai.com', access: 'bridge', search: false, preview: false, import: true, updates: false, note: 'Behind Cloudflare: browser bridge only. A hidden definition stays hidden; only the public profile comes across.' },
  { id: 'jannyai', name: 'JannyAI', site: 'https://jannyai.com', access: 'bridge', search: false, preview: false, import: true, updates: false, note: 'Behind Cloudflare: browser bridge only.' },
  { id: 'datacat', name: 'DataCat', site: 'https://datacat.run', access: 'bridge', search: false, preview: false, import: true, updates: false, note: 'robots.txt disallows its API, so only the browser bridge can send a card from a page you opened.' },
  { id: 'saucepan', name: 'Saucepan', site: 'https://saucepan.ai', access: 'none', search: false, preview: false, import: false, updates: false, note: 'No public catalog or permission to import was found, so it is not supported.' },
  { id: 'url', name: 'Any link', site: '', access: 'server', search: false, preview: true, import: true, updates: false, note: 'A direct link to a card file (PNG, JSON or CHARX), or a link to a page on one of the sites above.' },
];

export function provider(id: string): SourceProvider {
  const p = PROVIDERS[id];
  if (!p) throw new HttpError(404, 'Unknown source');
  return p;
}

// ------------------------------------------------------------------ fetching: cache, rate limit, test hook

export type SourceFetcher = (url: string, headers: Record<string, string>, body?: string) => Promise<{ status: number; body: Buffer }>;
let fetcher: SourceFetcher | null = null;
/** Tests replace the network with recorded responses. */
export function setSourceFetcher(f: SourceFetcher | null) {
  fetcher = f;
}

/**
 * Test support only: EVERLOOM_SOURCE_FIXTURES=<folder> answers source requests from saved responses
 * (tests/fixtures/sources, one folder per provider) instead of the network. Unset in normal use.
 * Pointing it at the chub folder itself still works.
 */
export function fixtureFetcher(dir: string): SourceFetcher {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const root = existsSync(path.join(dir, 'search.json')) ? path.dirname(path.resolve(dir)) : path.resolve(dir);
  const file = (sub: string, name: string | null | undefined) => {
    if (!name) return null;
    const full = path.join(root, sub, name.endsWith('.json') ? name : `${name}.json`);
    return full.startsWith(path.join(root, sub) + path.sep) && existsSync(full) ? full : null;
  };
  const IMAGE_HOSTS = new Set(['avatars.charhub.io', 'cards.character-tavern.com', 'sv.risuai.xyz', 'assets.pygmalion.chat', 'imagedelivery.net']);
  return async (url, _headers, body) => {
    const u = new URL(url);
    if (IMAGE_HOSTS.has(u.hostname)) return { status: 200, body: PNG };
    let full: string | null = null;
    if (u.hostname === 'api.chub.ai') full = file('chub', u.pathname === '/search' ? 'search.json' : decodeURIComponent(/^\/api\/characters\/[^/]+\/([^/]+)$/.exec(u.pathname)?.[1] ?? ''));
    else if (u.hostname === 'character-tavern.com') full = file('ctavern', u.pathname === '/api/search/cards' ? 'search.json' : /^\/api\/character\/([^/]+)\/([^/]+)$/.exec(u.pathname)?.slice(1).map(decodeURIComponent).join('__'));
    else if (u.hostname === 'realm.risuai.net') {
      const id = /^\/(?:character|api\/v1\/download\/json-v2)\/([0-9a-f-]{36})/.exec(u.pathname)?.[1];
      full = file('risu', u.pathname === '/__data.json' ? 'search.json' : id ? (u.pathname.startsWith('/api/') ? `card-${id}` : `meta-${id}`) : null);
    } else if (u.hostname === 'server.pygmalion.chat') {
      const b = body ? (JSON.parse(body) as { characterMetaId?: string }) : {};
      full = file('pygmalion', u.pathname.endsWith('/CharacterSearch') ? 'search.json' : b.characterMetaId);
    } else if (u.hostname === 'api.wyvern.chat') full = file('wyvern', u.pathname.startsWith('/exploreSearch/') ? 'search.json' : /^\/characters\/([A-Za-z0-9_-]+)$/.exec(u.pathname)?.[1]);
    return full ? { status: 200, body: readFileSync(full) } : { status: 404, body: Buffer.from('{}') };
  };
}
if (process.env.EVERLOOM_SOURCE_FIXTURES) fetcher = fixtureFetcher(path.resolve(process.env.EVERLOOM_SOURCE_FIXTURES));

const buckets = new Map<string, { tokens: number; at: number }>();
/** Token bucket per provider: bursts of 5, then 2 requests a second (pictures: 24, then 8). Waits up to 10 s, then gives up. */
async function rateLimit(id: string, burst = 5, perSecond = 2) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const now = Date.now();
    const b = buckets.get(id) ?? { tokens: burst, at: now };
    b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * perSecond);
    b.at = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      buckets.set(id, b);
      return;
    }
    buckets.set(id, b);
    if (now > deadline) throw new HttpError(429, 'Too many requests to this source; try again in a moment');
    await new Promise((r) => setTimeout(r, 250));
  }
}
export const resetRateLimits = () => buckets.clear();

function io(ctx: AppContext, owner: string, p: SourceProvider): ProviderIO {
  const token = getToken(ctx, owner, p.id);
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token && p.id === 'chub') headers['CH-API-KEY'] = token;
  const get = async (url: string, accept?: string, post?: unknown) => {
    if (accept?.startsWith('image/')) await rateLimit(`${p.id}:img`, 24, 8);
    else await rateLimit(p.id);
    const h = accept ? { ...headers, accept } : headers;
    if (fetcher) return fetcher(url, h, post === undefined ? undefined : JSON.stringify(post));
    const r = await fetchPublic(url, { headers: h, maxBytes: 20 * 1024 * 1024, allowPrivate: ctx.cfg.fetchPrivate, timeoutMs: 20_000, ...(post === undefined ? {} : { postJson: post }) });
    return { status: r.status, body: r.body };
  };
  return {
    token,
    async json(url, opts = {}) {
      // The cache key includes whether a token was used, so a signed-in view never leaks to a signed-out one.
      const key = createHash('sha256').update(`${p.id}|${token ? createHash('sha256').update(token).digest('hex') : '-'}|${url}|${opts.post === undefined ? '' : JSON.stringify(opts.post)}`).digest('hex');
      const ttl = opts.ttlMs ?? 10 * 60_000;
      if (ttl > 0) {
        const hit = ctx.db.prepare('SELECT body, fetched_at FROM provider_cache WHERE key = ?').get(key) as { body: string; fetched_at: number } | undefined;
        if (hit && Date.now() - hit.fetched_at < ttl) return JSON.parse(hit.body);
      }
      const r = await get(url, undefined, opts.post);
      if (r.status === 404) return null;
      if (r.status === 401 || r.status === 403) throw new HttpError(502, `${p.name} refused the request (${r.status}). It may not be available where your server is, or your token may be wrong.`, 'upstream');
      if (r.status !== 200) throw new HttpError(502, `${p.name} answered ${r.status}`, 'upstream');
      let body: unknown;
      try {
        body = JSON.parse(r.body.toString('utf8'));
      } catch {
        throw new HttpError(502, `${p.name} sent something that isn't JSON`, 'upstream');
      }
      ctx.db.prepare('INSERT INTO provider_cache (key, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at').run(key, JSON.stringify(body), Date.now());
      if (Math.random() < 0.05) ctx.db.prepare('DELETE FROM provider_cache WHERE fetched_at < ?').run(Date.now() - 24 * 3600_000);
      return body;
    },
    async bytes(url) {
      const r = await get(url, 'image/*');
      if (r.status !== 200) throw new HttpError(502, `Image download failed (${r.status})`, 'upstream');
      return r.body;
    },
  };
}

// ------------------------------------------------------------------ tokens (encrypted, never sent back)

export function getToken(ctx: AppContext, owner: string, providerId: string): string | null {
  const r = ctx.db.prepare('SELECT token_enc FROM provider_accounts WHERE owner_id = ? AND provider = ?').get(owner, providerId) as { token_enc: string } | undefined;
  if (!r) return null;
  try {
    return decrypt(r.token_enc, ctx.cfg.secretKey);
  } catch {
    return null;
  }
}

export function setToken(ctx: AppContext, owner: string, providerId: string, token: string | null) {
  provider(providerId);
  if (!token?.trim()) ctx.db.prepare('DELETE FROM provider_accounts WHERE owner_id = ? AND provider = ?').run(owner, providerId);
  else
    ctx.db
      .prepare('INSERT INTO provider_accounts (owner_id, provider, token_enc, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(owner_id, provider) DO UPDATE SET token_enc = excluded.token_enc')
      .run(owner, providerId, encrypt(token.trim(), ctx.cfg.secretKey), Date.now());
}

export function listProviders(ctx: AppContext, owner: string) {
  return {
    nsfwAllowed: getSettings(ctx, owner).library.nsfw === true,
    providers: Object.values(PROVIDERS).map((p) => ({ id: p.id, name: p.name, site: p.site, tokenHint: p.tokenHint ?? null, hasToken: !!getToken(ctx, owner, p.id) })),
    capabilities: CAPABILITIES,
  };
}

// ------------------------------------------------------------------ links between library characters and sources

export interface SourceLink {
  provider: string;
  key: string;
  url: string;
  /** The source version the local card was last brought up to date with. */
  version: string;
  linkedAt: number;
}

function linksByKey(ctx: AppContext, owner: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of ctx.db.prepare('SELECT id, source FROM characters WHERE owner_id = ? AND source IS NOT NULL').all(owner) as Array<{ id: string; source: string }>) {
    try {
      const s = JSON.parse(r.source) as SourceLink;
      out.set(`${s.provider}:${s.key.toLowerCase()}`, r.id);
    } catch {
      /* bad json */
    }
  }
  return out;
}

export function getLink(ctx: AppContext, owner: string, characterId: string): SourceLink | null {
  const r = ctx.db.prepare('SELECT source FROM characters WHERE id = ? AND owner_id = ?').get(characterId, owner) as { source: string | null } | undefined;
  if (!r) throw new HttpError(404, 'Character not found');
  try {
    return r.source ? (JSON.parse(r.source) as SourceLink) : null;
  } catch {
    return null;
  }
}

export function setLink(ctx: AppContext, owner: string, characterId: string, link: Omit<SourceLink, 'linkedAt'> | null) {
  getLink(ctx, owner, characterId);
  ctx.db.prepare('UPDATE characters SET source = ? WHERE id = ? AND owner_id = ?').run(link ? JSON.stringify({ ...link, linkedAt: Date.now() }) : null, characterId, owner);
}

// ------------------------------------------------------------------ browse, preview, import

const allowNsfw = (ctx: AppContext, owner: string) => getSettings(ctx, owner).library.nsfw === true;

export async function searchSource(ctx: AppContext, owner: string, providerId: string, q: SourceSearch & { hideOwned?: boolean }) {
  const p = provider(providerId);
  // The owner's setting decides, whatever the request asks for.
  const nsfw = q.nsfw && allowNsfw(ctx, owner);
  const r = await p.search({ ...q, nsfw }, io(ctx, owner, p));
  const owned = linksByKey(ctx, owner);
  const items = r.items
    .filter((i) => nsfw || !i.nsfw)
    .map((i) => ({ ...i, ownedId: owned.get(`${p.id}:${i.key.toLowerCase()}`) ?? null }))
    .filter((i) => !q.hideOwned || !i.ownedId);
  return { items, hasMore: r.hasMore, nsfw };
}

export async function sourceDetail(ctx: AppContext, owner: string, providerId: string, key: string) {
  const p = provider(providerId);
  const d = await p.get(key, io(ctx, owner, p));
  if (!d) throw new HttpError(404, 'Not found at the source');
  if (d.nsfw && !allowNsfw(ctx, owner)) throw new HttpError(403, 'This character is marked adult. Turn on adult content in Settings → Characters to see it.');
  const { card, ...rest } = d;
  return { ...rest, preview: card ? { first_mes: card.first_mes, alternate_greetings: card.alternate_greetings.length, tokens: d.tokens } : null, ownedId: linksByKey(ctx, owner).get(`${p.id}:${d.key.toLowerCase()}`) ?? null };
}


export async function importFromSource(ctx: AppContext, owner: string, providerId: string, key: string) {
  const p = provider(providerId);
  const pio = io(ctx, owner, p);
  const d = await p.get(key, pio, { fresh: true });
  if (!d) throw new HttpError(404, 'Not found at the source');
  if (d.nsfw && !allowNsfw(ctx, owner)) throw new HttpError(403, 'This character is marked adult. Turn on adult content in Settings → Characters to import it.');
  // A hidden definition: the public parts come in, labelled (card.extensions.definition_hidden).
  if (!d.card) throw new HttpError(404, 'Nothing public to import');
  const created = await importCard(ctx, owner, Buffer.from(JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: d.card })));
  if (d.avatarUrl) {
    try {
      const img = await saveImage(ctx, owner, await pio.bytes(d.avatarUrl), { kind: 'avatar', maxDim: 1536, meta: { source: d.avatarUrl } });
      ctx.db.prepare('UPDATE characters SET avatar = ? WHERE id = ?').run(img.id, created.id);
    } catch {
      /* the card works without its picture */
    }
  }
  setLink(ctx, owner, created.id, { provider: p.id, key: d.key, url: d.url, version: d.version });
  return getCharacter(ctx, owner, created.id);
}

// ------------------------------------------------------------------ link scanner and update checks

const TEXT_FIELDS: Array<keyof CardData> = ['creator_notes', 'description', 'scenario', 'first_mes'];

/** Unlinked characters whose card text links to a source page: likely where they came from. */
export function scanLinks(ctx: AppContext, owner: string) {
  const out: Array<{ characterId: string; name: string; provider: string; key: string; url: string }> = [];
  const owned = linksByKey(ctx, owner);
  for (const r of ctx.db.prepare('SELECT id, name, card FROM characters WHERE owner_id = ? AND source IS NULL').all(owner) as Array<{ id: string; name: string; card: string }>) {
    let card: CardData;
    try {
      card = JSON.parse(r.card);
    } catch {
      continue;
    }
    const chubPath = (card.extensions as any)?.chub?.full_path;
    const text = TEXT_FIELDS.map((f) => String(card[f] ?? '')).join('\n');
    for (const p of Object.values(PROVIDERS)) {
      const key = (p.id === 'chub' && typeof chubPath === 'string' && chubPath.includes('/') ? chubPath : null) ?? p.keyFromLink(text);
      if (key && !owned.has(`${p.id}:${key.toLowerCase()}`)) {
        out.push({ characterId: r.id, name: r.name, provider: p.id, key, url: p.urlFor(key) });
        break;
      }
    }
  }
  return out;
}

export interface UpdateInfo {
  characterId: string;
  name: string;
  provider: string;
  key: string;
  status: 'update' | 'current' | 'hidden' | 'gone' | 'error';
  version: string;
  diffs: FieldDiff[];
  error?: string;
}

async function checkOne(ctx: AppContext, owner: string, characterId: string): Promise<UpdateInfo> {
  const link = getLink(ctx, owner, characterId);
  const local = getCharacter(ctx, owner, characterId);
  if (!link) throw new HttpError(400, `${local.name} isn't linked to a source`);
  const base = { characterId, name: local.name, provider: link.provider, key: link.key };
  try {
    const p = provider(link.provider);
    const d = await p.get(link.key, io(ctx, owner, p), { fresh: true });
    if (!d) return { ...base, status: 'gone', version: '', diffs: [] };
    if (d.hidden || !d.card) return { ...base, status: 'hidden', version: d.version, diffs: [] };
    const { character_book: _book, ...remote } = d.card;
    // Only fields the source controls; local-only extras (game layer, nickname) never show up here.
    const diffs = diffCards(local.card, { ...remote, extensions: local.card.extensions, character_version: local.card.character_version });
    return { ...base, status: diffs.length ? 'update' : 'current', version: d.version, diffs };
  } catch (e) {
    return { ...base, status: 'error', version: '', diffs: [], error: (e as Error).message };
  }
}

export async function checkUpdates(ctx: AppContext, owner: string, ids?: string[]): Promise<UpdateInfo[]> {
  const targets = ids ?? (ctx.db.prepare('SELECT id FROM characters WHERE owner_id = ? AND source IS NOT NULL').all(owner) as Array<{ id: string }>).map((r) => r.id);
  const out: UpdateInfo[] = [];
  for (const id of targets) out.push(await checkOne(ctx, owner, id)); // one at a time: the rate limit paces it
  return out;
}

/** Brings the chosen fields (default: all that differ) up to the source version; the old card is kept as a version. */
export async function applyUpdate(ctx: AppContext, owner: string, characterId: string, fields?: string[]) {
  const link = getLink(ctx, owner, characterId);
  if (!link) throw new HttpError(400, "This character isn't linked to a source");
  const p = provider(link.provider);
  const d = await p.get(link.key, io(ctx, owner, p), { fresh: true });
  if (!d) throw new HttpError(404, 'The character is no longer at the source');
  if (d.hidden || !d.card) throw new HttpError(403, "The creator now keeps this character's definition private, so there's nothing to update from.");
  const local = getCharacter(ctx, owner, characterId);
  const { character_book: _book, ...remote } = d.card;
  const diffs = diffCards(local.card, { ...remote, extensions: local.card.extensions, character_version: local.card.character_version });
  const pick = new Set(fields ?? diffs.map((x) => x.key));
  const patch: Partial<CardData> = {};
  for (const x of diffs) if (pick.has(x.key)) (patch as any)[x.key] = (remote as any)[x.key];
  if (Object.keys(patch).length) updateCharacter(ctx, owner, characterId, { card: { ...patch, character_version: d.version } });
  setLink(ctx, owner, characterId, { provider: link.provider, key: link.key, url: link.url, version: d.version });
  return { applied: Object.keys(patch), character: getCharacter(ctx, owner, characterId) };
}

/** Thumbnails go through the server too, so phones never talk to the source directly. */
export async function sourceImage(ctx: AppContext, owner: string, providerId: string, url: string): Promise<Buffer> {
  const p = provider(providerId);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, 'Invalid image link');
  }
  if (u.protocol !== 'https:' || !p.imageHosts.includes(u.hostname)) throw new HttpError(400, 'Not an image from this source');
  return io(ctx, owner, p).bytes(u.href);
}

// ------------------------------------------------------------------ import from a link

const BRIDGE_HOSTS = new Map(CAPABILITIES.filter((c) => c.access !== 'server' && c.site).map((c) => [new URL(c.site).hostname.replace(/^www\./, ''), c]));

/**
 * A link to a card file (PNG, JSON, CHARX) or to a character page on a supported site. Pages on
 * sites the server must not fetch get a pointer to the browser bridge instead of a request.
 */
export async function importFromUrl(ctx: AppContext, owner: string, raw: string) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, "That doesn't look like a link");
  }
  for (const p of Object.values(PROVIDERS)) {
    const key = p.keyFromLink(url.href);
    if (key) return { character: await importFromSource(ctx, owner, p.id, key), via: p.name };
  }
  const host = url.hostname.replace(/^www\./, '');
  const direct = /\.(png|json|charx)$/i.test(url.pathname);
  const bridge = BRIDGE_HOSTS.get(host);
  if (bridge && !direct) {
    throw new HttpError(400, bridge.access === 'none' ? `${bridge.name} isn't supported: ${bridge.note}` : `Everloom doesn't fetch pages from ${bridge.name}. Open the page in your browser and use "Send to Everloom" (Settings → Characters → Browser bridge).`, 'use_bridge');
  }
  const r = await fetchPublic(url.href, { maxBytes: 30 * 1024 * 1024, allowPrivate: ctx.cfg.fetchPrivate, timeoutMs: 30_000 });
  const challenged = (r.status === 403 || r.status === 503 || r.status === 429) && (String(r.headers['server'] ?? '').toLowerCase().includes('cloudflare') || 'cf-ray' in r.headers);
  if (challenged) throw new HttpError(400, 'That site checks for a real browser before it answers, and Everloom never tries to get past that. Use "Send to Everloom" from the page instead.', 'use_bridge');
  if (r.status !== 200) throw new HttpError(400, `The link answered ${r.status}`);
  const head = r.body.subarray(0, 16);
  const looksLikeCard = head[0] === 0x89 || head[0] === 0x7b || (head[0] === 0x50 && head[1] === 0x4b) || (head[0] === 0x52 && head[8] === 0x57);
  if (!looksLikeCard) throw new HttpError(400, "That link isn't a card file. Link to the PNG, JSON or CHARX file itself, or use the browser bridge on the page.");
  const c = await importCard(ctx, owner, r.body);
  return { character: getCharacter(ctx, owner, c.id), via: host };
}
