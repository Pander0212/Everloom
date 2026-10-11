/**
 * Online character sources: search with one shared filter language, preview, import (which links the
 * character to its source), update checks, link scanning, site accounts, and a self-test.
 *
 * Everything is fetched here on the server (no CORS trouble on phones), cached, paced per site, and
 * backed off when a site says "too many requests". Only what the owner asks for is fetched, never in
 * the background. A card whose creator hid its definition comes in as its public parts only. 18+
 * cards need no setting: the search has an "18+" filter, and nothing is locked.
 */
import {
  applyLocalFilters,
  crossSourceKey,
  diffCards,
  emptySourceQuery,
  formatSourceQuery,
  parseSourceQuery,
  SiteChanged,
  type CardData,
  type FieldDiff,
  type SourceFilter,
  type SourceItem,
  type SourceQuery,
} from '@everloom/engine';
import { zipSync, strToU8 } from 'fflate';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { HttpError, type AppContext } from '../context.js';
import { decrypt, encrypt, newId } from '../security/crypto.js';
import { fetchPublic } from '../util/public-fetch.js';
import { getCharacter, importCard, updateCharacter } from './characters.js';
import { saveImage } from './media.js';
import { AccountRequired, CAPABILITIES, PROVIDERS, provider, type FetchOpts, type ProviderIO, type SourceProvider } from './source-providers.js';

export { CAPABILITIES, PROVIDERS, provider, type SourceProvider } from './source-providers.js';

// ------------------------------------------------------------------ fetching: test hook, fixtures

export interface SourceRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}
export type SourceFetcher = (url: string, headers: Record<string, string>, body?: string) => Promise<{ status: number; body: Buffer; headers?: Record<string, string | string[] | undefined> }>;
let fetcher: SourceFetcher | null = null;
/** Tests replace the network with recorded responses. */
export function setSourceFetcher(f: SourceFetcher | null) {
  fetcher = f;
}

interface FixtureRoute {
  method?: 'GET' | 'POST';
  /** A regular expression the full URL must match. */
  url: string;
  /** For POSTs: text the request body must contain. */
  body?: string;
  file: string;
  status?: number;
}

const FIXTURE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/**
 * Test support only: EVERLOOM_SOURCE_FIXTURES=<folder> answers source requests from saved
 * responses instead of the network. Each site folder has a routes.json (URL pattern → file); the
 * "Record fixtures" zip from the self-test has the same layout. Pictures on a site's image hosts get
 * a 1-pixel PNG unless a route says otherwise.
 */
export function fixtureFetcher(dir: string): SourceFetcher {
  const root = existsSync(path.join(dir, 'routes.json')) ? path.dirname(path.resolve(dir)) : path.resolve(dir);
  const routes: Array<FixtureRoute & { dir: string; re: RegExp }> = [];
  for (const sub of readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, sub.name, 'routes.json');
    if (!sub.isDirectory() || !existsSync(file)) continue;
    for (const r of (JSON.parse(readFileSync(file, 'utf8')) as { routes: FixtureRoute[] }).routes) routes.push({ ...r, dir: path.join(root, sub.name), re: new RegExp(r.url) });
  }
  const imageHosts = new Set(Object.values(PROVIDERS).flatMap((p) => p.spec.imageHosts));
  return async (url, _headers, body) => {
    const method = body === undefined ? 'GET' : 'POST';
    const hit = routes.find((r) => (r.method ?? 'GET') === method && r.re.test(url) && (!r.body || (body ?? '').includes(r.body)));
    if (hit) {
      const full = path.resolve(hit.dir, hit.file);
      if (!full.startsWith(hit.dir + path.sep) || !existsSync(full)) return { status: 404, body: Buffer.from('{}') };
      return { status: hit.status ?? 200, body: readFileSync(full) };
    }
    if (imageHosts.has(new URL(url).hostname)) return { status: 200, body: FIXTURE_PNG };
    return { status: 404, body: Buffer.from('{}') };
  };
}
if (process.env.EVERLOOM_SOURCE_FIXTURES) fetcher = fixtureFetcher(path.resolve(process.env.EVERLOOM_SOURCE_FIXTURES));

// ------------------------------------------------------------------ pacing: token buckets and back-off

const buckets = new Map<string, { tokens: number; at: number }>();
/** When a site last said "too many requests": no requests to it until `until`. */
const cooldowns = new Map<string, { until: number; step: number }>();

/** Token bucket per site. Waits up to 10 s for a slot, then gives up. */
async function rateLimit(id: string, burst: number, perSecond: number) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const cool = cooldowns.get(id.split(':')[0]!);
    if (cool && cool.until > Date.now()) throw new HttpError(429, `The site asked Everloom to slow down. Trying again is possible in ${Math.ceil((cool.until - Date.now()) / 1000)} s.`, 'cooling_down');
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

/** A 429: wait what the site asks (Retry-After), or double the last wait (2 s … 5 min). */
function backOff(id: string, retryAfter: string | string[] | undefined) {
  const prev = cooldowns.get(id);
  const asked = Number(Array.isArray(retryAfter) ? retryAfter[0] : retryAfter);
  const step = Math.min(300_000, prev && prev.until > Date.now() - 600_000 ? prev.step * 2 : 2_000);
  const wait = Number.isFinite(asked) && asked > 0 ? Math.min(3600_000, asked * 1000) : step;
  cooldowns.set(id, { until: Date.now() + wait, step });
  return wait;
}
export const resetRateLimits = () => {
  buckets.clear();
  cooldowns.clear();
};

// ------------------------------------------------------------------ the io a provider gets

/** Listing items seen recently, for sites without a public single-item endpoint. */
const seen = new Map<string, SourceItem>();
function remember(items: SourceItem[]) {
  for (const i of items) {
    seen.delete(`${i.provider}:${i.key}`);
    seen.set(`${i.provider}:${i.key}`, i);
  }
  while (seen.size > 3000) seen.delete(seen.keys().next().value!);
}

/** Recording for the self-test's fixture zip: every response, keyed by request. */
type Recorder = (req: SourceRequest, status: number, body: Buffer) => void;

function makeIO(ctx: AppContext, owner: string, p: SourceProvider, opts: { anonymous?: boolean; record?: Recorder } = {}): ProviderIO {
  const account = opts.anonymous ? null : getAccount(ctx, owner, p.id);
  let token = account?.token ?? null;
  const raw = async (url: string, o: FetchOpts & { image?: boolean } = {}) => {
    if (o.image) await rateLimit(`${p.id}:img`, 24, 8);
    else await rateLimit(p.id, p.rate.burst, p.rate.perSecond);
    const headers: Record<string, string> = { accept: o.image ? 'image/*' : 'application/json, text/plain, */*' };
    if (token && p.account && o.auth !== false) Object.assign(headers, p.account.header(token));
    const body = o.form ? new URLSearchParams(o.form).toString() : o.post === undefined ? undefined : JSON.stringify(o.post);
    let r: { status: number; body: Buffer; headers?: Record<string, string | string[] | undefined> };
    if (fetcher) r = await fetcher(url, headers, body);
    else {
      const res = await fetchPublic(url, { headers, maxBytes: o.maxBytes ?? 20 * 1024 * 1024, allowPrivate: ctx.cfg.fetchPrivate, timeoutMs: o.maxBytes && o.maxBytes > 20 * 1024 * 1024 ? 90_000 : 20_000, ...(o.form ? { postForm: o.form } : o.post === undefined ? {} : { postJson: o.post }) });
      r = { status: res.status, body: res.body, headers: res.headers };
    }
    // Never record a sign-in exchange or anything sent with the owner's credentials.
    if (opts.record && !o.form && !(token && o.auth !== false && p.account)) opts.record({ url, method: body === undefined ? 'GET' : 'POST', headers: {}, body }, r.status, r.body);
    if (r.status === 429) {
      const wait = backOff(p.id, r.headers?.['retry-after']);
      throw new HttpError(429, `${p.name} asked Everloom to slow down; it will wait ${Math.ceil(wait / 1000)} s before asking again.`, 'cooling_down');
    }
    return r;
  };
  // A stored password signs in again once when the session has run out.
  const withSession = async (url: string, o: FetchOpts & { image?: boolean } = {}) => {
    let r = await raw(url, o);
    if ((r.status === 401 || r.status === 403) && account?.hasPassword && o.auth !== false && p.signIn) {
      token = (await refreshSession(ctx, owner, p)) ?? token;
      r = await raw(url, o);
    }
    return r;
  };
  const cached = async (kind: 'json' | 'text', url: string, o: FetchOpts = {}) => {
    const sig = token && o.auth !== false && p.account ? createHash('sha256').update(token).digest('hex') : '-';
    const key = createHash('sha256').update(`${p.id}|${kind}|${sig}|${url}|${o.post === undefined ? '' : JSON.stringify(o.post)}`).digest('hex');
    const ttl = o.form ? 0 : (o.ttlMs ?? 10 * 60_000);
    if (ttl > 0 && !opts.record) {
      const hit = ctx.db.prepare('SELECT body, fetched_at FROM provider_cache WHERE key = ?').get(key) as { body: string; fetched_at: number } | undefined;
      if (hit && Date.now() - hit.fetched_at < ttl) return kind === 'json' ? JSON.parse(hit.body) : hit.body;
    }
    const r = await withSession(url, o);
    if (r.status === 404 || o.nullOn?.includes(r.status)) return null;
    if (r.status === 401 || r.status === 403) {
      if (p.account && !token) throw new AccountRequired(p.name);
      throw new HttpError(502, `${p.name} refused the request (${r.status}). It may not be available where your server is, or your sign-in may have expired.`, 'upstream');
    }
    if (r.status !== 200 && r.status !== 201) throw new HttpError(502, `${p.name} answered ${r.status}`, 'upstream');
    const text = r.body.toString('utf8');
    let value: unknown = text;
    if (kind === 'json') {
      try {
        value = JSON.parse(text);
      } catch {
        throw new HttpError(502, `${p.name} sent something that isn't JSON. The site may have changed: record fixtures in Settings › Character sources › Diagnostics and send them in.`, 'site_changed');
      }
    }
    if (ttl > 0) {
      ctx.db.prepare('INSERT INTO provider_cache (key, body, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at').run(key, kind === 'json' ? JSON.stringify(value) : text, Date.now());
      if (Math.random() < 0.05) ctx.db.prepare('DELETE FROM provider_cache WHERE fetched_at < ?').run(Date.now() - 24 * 3600_000);
    }
    return value;
  };
  return {
    get token() {
      return token;
    },
    json: (url, o) => cached('json', url, o),
    text: (url, o) => cached('text', url, o) as Promise<string | null>,
    async bytes(url, o = {}) {
      const r = await withSession(url, o);
      if (r.status !== 200) throw new HttpError(502, `${o.image ? 'Picture' : 'File'} download from ${p.name} failed (${r.status})`, 'upstream');
      return r.body;
    },
    recall: (key) => seen.get(`${p.id}:${key}`) ?? null,
  };
}

/** Turns a site's "shape changed" error into a clear HTTP answer. */
function siteErrors<T>(f: () => Promise<T>): Promise<T> {
  return f().catch((e) => {
    if (e instanceof SiteChanged) throw new HttpError(502, e.message, 'site_changed');
    throw e;
  });
}

// ------------------------------------------------------------------ accounts (encrypted, never sent back)

interface AccountRow {
  token_enc: string;
  username: string | null;
  password_enc: string | null;
  status: string;
  status_detail: string | null;
  checked_at: number | null;
  expires_at: number | null;
  created_at: number;
}

function accountRow(ctx: AppContext, owner: string, providerId: string): AccountRow | undefined {
  return ctx.db.prepare('SELECT token_enc, username, password_enc, status, status_detail, checked_at, expires_at, created_at FROM provider_accounts WHERE owner_id = ? AND provider = ?').get(owner, providerId) as AccountRow | undefined;
}
const open = (ctx: AppContext, v: string | null) => {
  if (!v) return null;
  try {
    return decrypt(v, ctx.cfg.secretKey) || null;
  } catch {
    return null;
  }
};

function getAccount(ctx: AppContext, owner: string, providerId: string): { token: string | null; hasPassword: boolean } | null {
  const r = accountRow(ctx, owner, providerId);
  return r ? { token: open(ctx, r.token_enc), hasPassword: !!r.password_enc } : null;
}

export function getToken(ctx: AppContext, owner: string, providerId: string): string | null {
  return getAccount(ctx, owner, providerId)?.token ?? null;
}

function setStatus(ctx: AppContext, owner: string, providerId: string, status: 'ok' | 'failed' | 'unknown', detail: string | null) {
  ctx.db.prepare('UPDATE provider_accounts SET status = ?, status_detail = ?, checked_at = ? WHERE owner_id = ? AND provider = ?').run(status, detail?.slice(0, 300) ?? null, Date.now(), owner, providerId);
}

/** An API key (sites that take one). Null signs out. */
export function setToken(ctx: AppContext, owner: string, providerId: string, token: string | null) {
  const p = provider(providerId);
  if (!token?.trim()) return signOut(ctx, owner, providerId);
  if (p.account?.kind !== 'token') throw new HttpError(400, `${p.name} signs in with a username and password`);
  ctx.db
    .prepare("INSERT INTO provider_accounts (owner_id, provider, token_enc, created_at, status) VALUES (?, ?, ?, ?, 'unknown') ON CONFLICT(owner_id, provider) DO UPDATE SET token_enc = excluded.token_enc, status = 'unknown', status_detail = NULL")
    .run(owner, providerId, encrypt(token.trim(), ctx.cfg.secretKey), Date.now());
}

/** Username and password: signs in now; the password is kept (encrypted) to sign in again when the session ends. */
export async function signIn(ctx: AppContext, owner: string, providerId: string, username: string, password: string, remember = true) {
  const p = provider(providerId);
  if (p.account?.kind !== 'password' || !p.signIn) throw new HttpError(400, `${p.name} doesn't take a username and password here`);
  const io = makeIO(ctx, owner, p, { anonymous: true });
  const s = await siteErrors(() => p.signIn!(io, username.trim(), password));
  ctx.db
    .prepare(
      "INSERT INTO provider_accounts (owner_id, provider, token_enc, username, password_enc, expires_at, created_at, status, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', ?) ON CONFLICT(owner_id, provider) DO UPDATE SET token_enc = excluded.token_enc, username = excluded.username, password_enc = excluded.password_enc, expires_at = excluded.expires_at, status = 'ok', status_detail = NULL, checked_at = excluded.checked_at",
    )
    .run(owner, providerId, encrypt(s.token, ctx.cfg.secretKey), username.trim(), remember ? encrypt(password, ctx.cfg.secretKey) : null, s.expiresAt ?? null, Date.now(), Date.now());
  return accountInfo(ctx, owner, p);
}

async function refreshSession(ctx: AppContext, owner: string, p: SourceProvider): Promise<string | null> {
  const r = accountRow(ctx, owner, p.id);
  const password = open(ctx, r?.password_enc ?? null);
  if (!r?.username || !password || !p.signIn) return null;
  try {
    const s = await p.signIn(makeIO(ctx, owner, p, { anonymous: true }), r.username, password);
    ctx.db.prepare("UPDATE provider_accounts SET token_enc = ?, expires_at = ?, status = 'ok', status_detail = NULL, checked_at = ? WHERE owner_id = ? AND provider = ?").run(encrypt(s.token, ctx.cfg.secretKey), s.expiresAt ?? null, Date.now(), owner, p.id);
    return s.token;
  } catch (e) {
    setStatus(ctx, owner, p.id, 'failed', (e as Error).message);
    return null;
  }
}

export function signOut(ctx: AppContext, owner: string, providerId: string) {
  provider(providerId);
  ctx.db.prepare('DELETE FROM provider_accounts WHERE owner_id = ? AND provider = ?').run(owner, providerId);
  // Cached answers fetched while signed in go too.
  ctx.db.prepare('DELETE FROM provider_cache').run();
}

/** Tries the account with one small request and records the outcome. */
export async function testAccount(ctx: AppContext, owner: string, providerId: string) {
  const p = provider(providerId);
  if (!accountRow(ctx, owner, providerId)) throw new HttpError(404, `No ${p.name} account is set up`);
  try {
    if (p.account?.kind === 'password' && !(await refreshSession(ctx, owner, p))) throw new Error(accountRow(ctx, owner, providerId)?.status_detail ?? 'Sign-in failed; enter your password again.');
    await siteErrors(() => p.search({ ...emptySourceQuery(), page: 1 }, makeIO(ctx, owner, p)));
    setStatus(ctx, owner, providerId, 'ok', null);
  } catch (e) {
    setStatus(ctx, owner, providerId, 'failed', (e as Error).message);
  }
  return accountInfo(ctx, owner, p);
}

function accountInfo(ctx: AppContext, owner: string, p: SourceProvider) {
  const r = accountRow(ctx, owner, p.id);
  return {
    kind: p.account?.kind ?? null,
    hint: p.account?.hint ?? null,
    usernameLabel: p.account?.usernameLabel ?? null,
    connected: !!r,
    username: r?.username ?? null,
    remembersPassword: !!r?.password_enc,
    status: r?.status ?? null,
    statusDetail: r?.status_detail ?? null,
    checkedAt: r?.checked_at ?? null,
  };
}

// ------------------------------------------------------------------ site notices

const noticeAccepted = (ctx: AppContext, owner: string, providerId: string) => !!ctx.db.prepare('SELECT 1 FROM source_notices WHERE owner_id = ? AND provider = ?').get(owner, providerId);
export function acceptNotice(ctx: AppContext, owner: string, providerId: string) {
  provider(providerId);
  ctx.db.prepare('INSERT INTO source_notices (owner_id, provider, accepted_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(owner, providerId, Date.now());
}
function requireNotice(ctx: AppContext, owner: string, p: SourceProvider) {
  if (p.notice && !noticeAccepted(ctx, owner, p.id)) throw new HttpError(428, p.notice, 'notice_required');
}

function io(ctx: AppContext, owner: string, p: SourceProvider) {
  requireNotice(ctx, owner, p);
  return makeIO(ctx, owner, p);
}

export function listProviders(ctx: AppContext, owner: string) {
  return {
    nsfwAllowed: true,
    providers: Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      name: p.name,
      site: p.site,
      onSite: p.spec.onSite,
      sorts: p.spec.sorts,
      hasTags: !!p.tags,
      notice: p.notice ?? null,
      noticeAccepted: !p.notice || noticeAccepted(ctx, owner, p.id),
      account: p.account ? accountInfo(ctx, owner, p) : null,
      // Kept for older clients.
      tokenHint: p.account?.kind === 'token' ? p.account.hint : null,
      hasToken: !!accountRow(ctx, owner, p.id),
    })),
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


/** The search box text plus the filter bar's fields; the bar wins where both say something. */
export function buildQuery(text: string, extra: Partial<SourceQuery>): { query: SourceQuery; errors: string[] } {
  const parsed = parseSourceQuery(text);
  const defined = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) as Partial<SourceQuery>;
  const q: SourceQuery = { ...emptySourceQuery(), ...parsed.query, ...defined };
  q.includeTags = [...new Set([...(parsed.query.includeTags ?? []), ...(extra.includeTags ?? [])])];
  q.excludeTags = [...new Set([...(parsed.query.excludeTags ?? []), ...(extra.excludeTags ?? [])])];
  return { query: q, errors: parsed.errors };
}

export async function searchSource(ctx: AppContext, owner: string, providerId: string, q: SourceQuery, opts: { hideOwned?: boolean } = {}) {
  const p = provider(providerId);
  // The owner's setting decides, whatever the request asks for.
  const nsfw = q.nsfw;
  const query = { ...q, nsfw };
  const r = await siteErrors(() => p.search(query, io(ctx, owner, p)));
  remember(r.items);
  const onSite = new Set<SourceFilter>(r.onSite ?? p.spec.onSite);
  const filtered = applyLocalFilters(r.items, query, onSite);
  const owned = linksByKey(ctx, owner);
  const items = filtered.items.map((i) => ({ ...i, ownedId: owned.get(`${p.id}:${i.key.toLowerCase()}`) ?? null })).filter((i) => !opts.hideOwned || !i.ownedId);
  return { items, hasMore: r.hasMore, total: r.total ?? null, nsfw, local: filtered.local, dropped: r.items.length - filtered.items.length };
}

/**
 * The same query on every site at once (those whose notice is accepted). Results are interleaved by
 * rank; a character that turns up on several sites is shown once, with the other places listed.
 */
export async function searchAll(ctx: AppContext, owner: string, q: SourceQuery, opts: { hideOwned?: boolean } = {}) {
  const sites = Object.values(PROVIDERS).filter((p) => !p.notice || noticeAccepted(ctx, owner, p.id));
  const results = await Promise.all(
    sites.map(async (p) => {
      try {
        const r = await Promise.race([searchSource(ctx, owner, p.id, q, opts), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('took too long')), 20_000))]);
        return { provider: p.id, name: p.name, ok: true as const, ...r };
      } catch (e) {
        return { provider: p.id, name: p.name, ok: false as const, error: (e as Error).message, items: [] as Array<SourceItem & { ownedId: string | null }>, hasMore: false };
      }
    }),
  );
  const byKey = new Map<string, SourceItem & { ownedId: string | null; also: Array<{ provider: string; key: string; url: string }> }>();
  const order: string[] = [];
  const longest = Math.max(0, ...results.map((r) => r.items.length));
  for (let i = 0; i < longest; i++)
    for (const r of results) {
      const it = r.items[i];
      if (!it) continue;
      const k = crossSourceKey(it);
      const prev = byKey.get(k);
      if (prev) prev.also.push({ provider: it.provider, key: it.key, url: it.url });
      else {
        byKey.set(k, { ...it, also: [] });
        order.push(k);
      }
    }
  return {
    items: order.map((k) => byKey.get(k)!),
    sites: results.map((r) => ({ provider: r.provider, name: r.name, ok: r.ok, count: r.items.length, hasMore: r.hasMore, error: r.ok ? null : r.error })),
    hasMore: results.some((r) => r.hasMore),
  };
}

/** Tag suggestions: the site's own catalogue where it has one, otherwise tags seen in recent results. */
export async function sourceTags(ctx: AppContext, owner: string, providerId: string, prefix: string, limit = 20) {
  const p = provider(providerId);
  let all: Array<{ tag: string; count: number }>;
  if (p.tags) all = await siteErrors(() => p.tags!(io(ctx, owner, p)));
  else {
    const counts = new Map<string, number>();
    for (const i of seen.values()) if (i.provider === p.id) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    all = [...counts].map(([tag, count]) => ({ tag, count }));
  }
  const want = prefix.trim().toLowerCase();
  const starts = all.filter((t) => t.tag.toLowerCase().startsWith(want));
  const contains = want ? all.filter((t) => !t.tag.toLowerCase().startsWith(want) && t.tag.toLowerCase().includes(want)) : [];
  return [...starts.sort((a, b) => b.count - a.count), ...contains.sort((a, b) => b.count - a.count)].slice(0, limit);
}

export async function sourceDetail(ctx: AppContext, owner: string, providerId: string, key: string) {
  const p = provider(providerId);
  const pio = io(ctx, owner, p);
  let d;
  try {
    d = await siteErrors(() => p.get(key, pio));
  } catch (e) {
    // Sites that only show definitions to members: the listing still previews.
    const listing = pio.recall(key);
    if (e instanceof AccountRequired && listing) return { ...listing, hidden: false, version: '', description: listing.tagline, preview: null, needsAccount: true, ownedId: linksByKey(ctx, owner).get(`${p.id}:${key.toLowerCase()}`) ?? null };
    throw e;
  }
  if (!d) throw new HttpError(404, 'Not found at the source');
  const { card, ...rest } = d;
  return { ...rest, needsAccount: false, preview: card ? { first_mes: card.first_mes, alternate_greetings: card.alternate_greetings.length, tokens: d.tokens } : null, ownedId: linksByKey(ctx, owner).get(`${p.id}:${d.key.toLowerCase()}`) ?? null };
}

export async function importFromSource(ctx: AppContext, owner: string, providerId: string, key: string) {
  const p = provider(providerId);
  const pio = io(ctx, owner, p);
  const d = await siteErrors(() => p.get(key, pio, { fresh: true }));
  if (!d) throw new HttpError(404, 'Not found at the source');
  // A hidden definition: the public parts come in, labelled (card.extensions.definition_hidden).
  if (!d.card) throw new HttpError(404, 'Nothing public to import');
  const created = await importCard(ctx, owner, Buffer.from(JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: d.card })));
  if (d.avatarUrl) {
    try {
      const img = await saveImage(ctx, owner, await pio.bytes(d.avatarUrl, { image: true }), { kind: 'avatar', maxDim: 1536, meta: { source: d.avatarUrl } });
      ctx.db.prepare('UPDATE characters SET avatar = ? WHERE id = ?').run(img.id, created.id);
    } catch {
      /* the card works without its picture */
    }
  }
  setLink(ctx, owner, created.id, { provider: p.id, key: d.key, url: d.url, version: d.version });
  return getCharacter(ctx, owner, created.id);
}

// ------------------------------------------------------------------ saved searches

export function listSavedSearches(ctx: AppContext, owner: string) {
  return ctx.db.prepare('SELECT id, provider, name, query, created_at AS createdAt FROM saved_searches WHERE owner_id = ? ORDER BY created_at DESC').all(owner) as Array<{ id: string; provider: string; name: string; query: string; createdAt: number }>;
}
export function saveSearch(ctx: AppContext, owner: string, providerId: string, name: string, q: Partial<SourceQuery>) {
  if (providerId !== 'all') provider(providerId);
  if ((ctx.db.prepare('SELECT COUNT(*) AS n FROM saved_searches WHERE owner_id = ?').get(owner) as { n: number }).n >= 200) throw new HttpError(400, 'That is a lot of saved searches; delete some first');
  const id = newId();
  ctx.db.prepare('INSERT INTO saved_searches (id, owner_id, provider, name, query, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, owner, providerId, name.trim().slice(0, 80) || 'Search', formatSourceQuery(q), Date.now());
  return listSavedSearches(ctx, owner);
}
export function deleteSavedSearch(ctx: AppContext, owner: string, id: string) {
  ctx.db.prepare('DELETE FROM saved_searches WHERE id = ? AND owner_id = ?').run(id, owner);
  return listSavedSearches(ctx, owner);
}

// ------------------------------------------------------------------ pictures

const thumbs = new Map<string, Buffer>();
/**
 * Pictures go through the server too, so phones never talk to the source directly. With a width,
 * the picture is shrunk (WebP) and kept in a small memory cache.
 */
export async function sourceImage(ctx: AppContext, owner: string, providerId: string, url: string, width?: number): Promise<Buffer> {
  const p = provider(providerId);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpError(400, 'Invalid image link');
  }
  if (u.protocol !== 'https:' || !p.spec.imageHosts.includes(u.hostname)) throw new HttpError(400, 'Not an image from this source');
  const w = width ? Math.max(64, Math.min(1024, Math.round(width / 64) * 64)) : 0;
  const key = `${p.id}|${w}|${u.href}`;
  const hit = thumbs.get(key);
  if (hit) return hit;
  const original = await makeIO(ctx, owner, p).bytes(u.href, { image: true, maxBytes: 15 * 1024 * 1024 });
  let out = original;
  if (w) {
    try {
      out = await sharp(original, { animated: false, limitInputPixels: 64_000_000 }).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    } catch {
      out = original;
    }
    thumbs.set(key, out);
    while (thumbs.size > 400) thumbs.delete(thumbs.keys().next().value!);
  }
  return out;
}

// ------------------------------------------------------------------ self-test and fixture recording

export interface SelfTestStep {
  step: 'search' | 'tags' | 'filter' | 'detail';
  ok: boolean;
  ms: number;
  detail: string;
}

/**
 * Checks one site the way the app uses it: a plain search, its tag list, a filtered search, and one
 * character. Always signed out, so nothing private is touched (or recorded). With `record`, every
 * response is kept for the fixture zip.
 */
export async function selfTest(ctx: AppContext, owner: string, providerId: string, record?: Recorder): Promise<{ provider: string; name: string; steps: SelfTestStep[] }> {
  const p = provider(providerId);
  requireNotice(ctx, owner, p);
  const pio = makeIO(ctx, owner, p, { anonymous: true, record });
  const steps: SelfTestStep[] = [];
  const run = async (step: SelfTestStep['step'], f: () => Promise<string>) => {
    const t = Date.now();
    try {
      steps.push({ step, ok: true, ms: Date.now() - t, detail: await siteErrors(f) });
      steps.at(-1)!.ms = Date.now() - t;
      return true;
    } catch (e) {
      steps.push({ step, ok: false, ms: Date.now() - t, detail: (e as Error).message });
      return false;
    }
  };
  let first: SourceItem | undefined;
  let tag: string | undefined;
  await run('search', async () => {
    const r = await p.search(emptySourceQuery(), pio);
    remember(r.items);
    first = r.items.find((i) => !i.nsfw) ?? r.items[0];
    tag = r.items.flatMap((i) => i.tags)[0];
    if (!r.items.length) throw new Error('The search came back empty');
    return `${r.items.length} results${r.total != null ? ` of ${r.total}` : ''}`;
  });
  if (p.tags)
    await run('tags', async () => {
      const t = await p.tags!(pio);
      tag ??= t[0]?.tag;
      if (!t.length) throw new Error('No tags came back');
      return `${t.length} tags`;
    });
  if (tag && p.spec.onSite.includes('tags'))
    await run('filter', async () => {
      const q = { ...emptySourceQuery(), includeTags: [tag!] };
      const r = await p.search(q, pio);
      const kept = applyLocalFilters(r.items, q, new Set(r.onSite ?? p.spec.onSite)).items.length;
      return `tag "${tag}": ${r.items.length} results, ${kept} pass the check`;
    });
  if (first)
    await run('detail', async () => {
      try {
        const d = await p.get(first!.key, pio, { fresh: true });
        if (!d) throw new Error(`${first!.name} wasn't found`);
        return `${d.name}: ${d.hidden ? 'definition hidden by creator' : `${(d.card?.description ?? '').length} characters of description`}`;
      } catch (e) {
        if (e instanceof AccountRequired) return 'Needs a signed-in account (not tested)';
        throw e;
      }
    });
  return { provider: p.id, name: p.name, steps };
}

/** A zip of fresh responses from one site, in the fixture layout (routes.json + files). */
export async function recordFixtures(ctx: AppContext, owner: string, providerId: string): Promise<Buffer> {
  const p = provider(providerId);
  const files: Record<string, Uint8Array> = {};
  const routes: FixtureRoute[] = [];
  const result = await selfTest(ctx, owner, providerId, (req, status, body) => {
    const n = routes.length + 1;
    const ext = body[0] === 0x89 ? 'png' : body[0] === 0x50 && body[1] === 0x4b ? 'charx' : body[0] === 0x52 && body[8] === 0x57 ? 'webp' : /^\s*[[{]/.test(body.subarray(0, 64).toString('utf8')) ? 'json' : 'txt';
    const file = `${String(n).padStart(2, '0')}.${ext}`;
    files[`${p.id}/${file}`] = new Uint8Array(body);
    routes.push({ method: req.method, url: `^${req.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, ...(req.body ? { body: req.body.slice(0, 200) } : {}), file, ...(status !== 200 ? { status } : {}) });
  });
  files[`${p.id}/routes.json`] = strToU8(JSON.stringify({ routes }, null, 2));
  files[`${p.id}/self-test.json`] = strToU8(JSON.stringify({ recordedAt: new Date().toISOString(), ...result }, null, 2));
  files['README.txt'] = strToU8(
    `Responses recorded from ${p.name} by Everloom's self-test, signed out, on ${new Date().toISOString()}.\nThey contain other people's characters: share them only to report a problem, and don't publish them.\nPut the ${p.id}/ folder under tests/fixtures/sources to replay it.\n`,
  );
  return Buffer.from(zipSync(files, { level: 6 }));
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
    throw new HttpError(400, bridge.access === 'none' ? `${bridge.name} isn't supported: ${bridge.note}` : `Everloom doesn't fetch pages from ${bridge.name}. Open the page in your browser and use "Send to Everloom" (Settings › Character sources › Browser bridge).`, 'use_bridge');
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
