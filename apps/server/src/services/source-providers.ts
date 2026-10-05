/**
 * The online character sources Everloom can fetch from the server: what each site can filter, how
 * its requests are made, whether an account helps, and what the owner must accept first. The
 * request and response details live in the engine's per-site modules (tested against fixtures);
 * this file only wires them to the network.
 */
import {
  AICC_SPEC,
  aiccDetail,
  aiccDetailUrl,
  aiccKeyFromLink,
  aiccSearchResults,
  aiccSearchUrl,
  aiccTags,
  aiccTagsUrl,
  bbDetail,
  bbDetailUrl,
  bbKeyFromLink,
  bbSearchResults,
  bbSearchUrl,
  bbTags,
  bbTagsUrl,
  BOTBOORU_SPEC,
  CHUB,
  CHUB_SPEC,
  chubDetail,
  chubDetailUrl,
  chubKeyFromLink,
  chubQueryUrl,
  chubSearchResults,
  CTAVERN_SPEC,
  ctDetail,
  ctDetailUrl,
  ctKeyFromLink,
  ctSearchResults,
  ctSearchUrl,
  ctTags,
  ctTagsUrl,
  legacySearch,
  PYGMALION,
  PYGMALION_SPEC,
  pygDetail,
  pygDetailRequest,
  pygKeyFromLink,
  pygSearchRequest,
  pygSearchResults,
  readCardFile,
  RISU,
  RISU_SPEC,
  risuCharxUrl,
  risuDetail,
  risuDownloadUrl,
  risuKeyFromLink,
  risuMetaUrl,
  risuSearchResults,
  risuSearchUrl,
  SAUCEPAN_SPEC,
  saucepanOnSite,
  spDefinitionUrl,
  spDetail,
  spKeyFromLink,
  spSearchRequest,
  spSearchResults,
  spSignInRequest,
  spSignInToken,
  unflattenPageData,
  WYVERN,
  WYVERN_SPEC,
  wyvDetail,
  wyvDetailUrl,
  wyvKeyFromLink,
  wyvSearchResults,
  wyvSearchUrl,
  type SiteSpec,
  type SourceDetail,
  type SourceFilter,
  type SourceItem,
  type SourceQuery,
} from '@everloom/engine';
import { HttpError } from '../context.js';
import { readCharx } from './characters.js';

export interface FetchOpts {
  /** How long a cached answer is good for (0: always fetch). Default 10 minutes. */
  ttlMs?: number;
  post?: unknown;
  form?: Record<string, string>;
  /** Statuses that mean "nothing here" and come back as null instead of an error. */
  nullOn?: number[];
  /** Send the signed-in account's credentials (default: when there is an account). */
  auth?: boolean;
  maxBytes?: number;
}

export interface ProviderIO {
  json(url: string, opts?: FetchOpts): Promise<any>;
  /** The raw text (SvelteKit streams several JSON lines). */
  text(url: string, opts?: FetchOpts): Promise<string | null>;
  bytes(url: string, opts?: FetchOpts & { image?: boolean }): Promise<Buffer>;
  /** The API token or session token of the owner's account on this site, if any. */
  token: string | null;
  /** The listing item last seen in a search (for sites with no public single-item endpoint). */
  recall(key: string): SourceItem | null;
}

export interface AccountSpec {
  /** "token": paste an API key. "password": sign in with username and password (a session is kept). */
  kind: 'token' | 'password';
  /** What the account adds (shown in Settings). */
  hint: string;
  usernameLabel?: string;
  /** Header the credential goes in. */
  header: (token: string) => Record<string, string>;
}

export interface SourceProvider {
  id: string;
  name: string;
  site: string;
  spec: SiteSpec;
  perPage: number;
  /** Requests a second (steady) and burst. Pictures have their own, roomier bucket. */
  rate: { burst: number; perSecond: number };
  account?: AccountSpec;
  /**
   * Shown once before Everloom fetches anything from the site (sites whose robots.txt asks crawlers
   * to stay away). Everloom still only fetches what the owner asks for, when they ask.
   */
  notice?: string;
  search(q: SourceQuery, io: ProviderIO): Promise<{ items: SourceItem[]; hasMore: boolean; total?: number | null; onSite?: SourceFilter[] }>;
  tags?(io: ProviderIO): Promise<Array<{ tag: string; count: number }>>;
  get(key: string, io: ProviderIO, opts?: { fresh?: boolean }): Promise<SourceDetail | null>;
  signIn?(io: ProviderIO, username: string, password: string): Promise<{ token: string; expiresAt?: number | null }>;
  keyFromLink(link: string): string | null;
  urlFor(key: string): string;
}

/** Thrown when a site needs the owner's account for this. */
export class AccountRequired extends HttpError {
  constructor(name: string) {
    super(401, `${name} only shows this to signed-in members. Sign in under Settings › Character sources › Accounts.`, 'account_required');
  }
}

const LIST_TTL = 10 * 60_000;
const ttl = (fresh?: boolean) => (fresh ? 0 : 30 * 60_000);
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

const chub: SourceProvider = {
  id: CHUB.id,
  name: CHUB.name,
  site: CHUB.site,
  spec: CHUB_SPEC,
  perPage: 24,
  rate: { burst: 5, perSecond: 2 },
  account: { kind: 'token', hint: 'Optional. Your Chub API key makes searches follow your Chub account settings (blocked tags and creators, adult content).', header: (t) => ({ 'CH-API-KEY': t }) },
  async search(q, io) {
    const r = chubSearchResults(await io.json(chubQueryUrl(q, this.perPage), { ttlMs: LIST_TTL }));
    return { items: r.items, hasMore: r.total != null ? q.page * this.perPage < r.total : r.items.length === this.perPage, total: r.total };
  },
  async get(key, io, opts) {
    return chubDetail(await io.json(chubDetailUrl(key), { ttlMs: ttl(opts?.fresh) }));
  },
  keyFromLink: chubKeyFromLink,
  urlFor: (key) => `${CHUB.site}/characters/${key}`,
};

const ctavern: SourceProvider = {
  id: CTAVERN_SPEC.id,
  name: CTAVERN_SPEC.name,
  site: CTAVERN_SPEC.site,
  spec: CTAVERN_SPEC,
  perPage: 30,
  rate: { burst: 4, perSecond: 1 },
  async search(q, io) {
    return ctSearchResults((await io.text(ctSearchUrl(q), { ttlMs: LIST_TTL })) ?? '');
  },
  async tags(io) {
    return ctTags((await io.text(ctTagsUrl(), { ttlMs: 24 * 3600_000 })) ?? '');
  },
  async get(key, io, opts) {
    const raw = await io.text(ctDetailUrl(key), { ttlMs: ttl(opts?.fresh), nullOn: [404] });
    return raw ? ctDetail(raw) : null;
  },
  keyFromLink: ctKeyFromLink,
  urlFor: (key) => `${CTAVERN_SPEC.site}/character/${key}`,
};

const risu: SourceProvider = {
  id: RISU.id,
  name: RISU.name,
  site: RISU.site,
  spec: RISU_SPEC,
  perPage: 30,
  rate: { burst: 4, perSecond: 1 },
  async search(q, io) {
    return risuSearchResults(await io.json(risuSearchUrl(legacySearch(q)), { ttlMs: LIST_TTL }));
  },
  async get(key, io, opts) {
    const meta = await io.json(risuMetaUrl(key), { ttlMs: ttl(opts?.fresh) });
    if (!meta) return null;
    // A hidden card's definition is never downloaded.
    if (unflattenPageData(meta)?.card?.hidden) return risuDetail(meta, null);
    // Cards stored as CHARX refuse the JSON download (400); the CHARX one always works.
    let card = await io.json(risuDownloadUrl(key), { ttlMs: ttl(opts?.fresh), nullOn: [400, 404] });
    if (!card) {
      const zip = await io.bytes(risuCharxUrl(key), { maxBytes: 60 * 1024 * 1024 });
      card = JSON.parse((await readCharx(zip)).json.toString('utf8'));
    }
    return risuDetail(meta, card);
  },
  keyFromLink: risuKeyFromLink,
  urlFor: (key) => `${RISU.site}/character/${key}`,
};

const pygmalion: SourceProvider = {
  id: PYGMALION.id,
  name: PYGMALION.name,
  site: PYGMALION.site,
  spec: PYGMALION_SPEC,
  perPage: 24,
  rate: { burst: 5, perSecond: 2 },
  async search(q, io) {
    const req = pygSearchRequest(legacySearch(q), this.perPage);
    return pygSearchResults(await io.json(req.url, { ttlMs: LIST_TTL, post: req.body }), q.page, this.perPage);
  },
  async get(key, io, opts) {
    const req = pygDetailRequest(key);
    return pygDetail(await io.json(req.url, { ttlMs: ttl(opts?.fresh), post: req.body }));
  },
  keyFromLink: pygKeyFromLink,
  urlFor: (key) => `${PYGMALION.site}/character/${key}`,
};

const wyvern: SourceProvider = {
  id: WYVERN.id,
  name: WYVERN.name,
  site: WYVERN.site,
  spec: WYVERN_SPEC,
  perPage: 24,
  rate: { burst: 5, perSecond: 2 },
  async search(q, io) {
    return wyvSearchResults(await io.json(wyvSearchUrl(legacySearch(q), this.perPage), { ttlMs: LIST_TTL }));
  },
  async get(key, io, opts) {
    return wyvDetail(await io.json(wyvDetailUrl(key), { ttlMs: ttl(opts?.fresh) }));
  },
  keyFromLink: wyvKeyFromLink,
  urlFor: (key) => `${WYVERN.site}/characters/${key}`,
};

const ROBOTS_NOTICE = (name: string) =>
  `${name}'s robots.txt asks automated crawlers to stay out of its character pages and API. Everloom isn't a crawler: it only fetches what you search for or open, one request at a time, at a gentle pace, and never anything a creator hid. By continuing you take responsibility for following ${name}'s terms.`;

const botbooru: SourceProvider = {
  id: BOTBOORU_SPEC.id,
  name: BOTBOORU_SPEC.name,
  site: BOTBOORU_SPEC.site,
  spec: BOTBOORU_SPEC,
  perPage: 24,
  rate: { burst: 3, perSecond: 1 },
  notice: ROBOTS_NOTICE('Botbooru'),
  account: { kind: 'password', hint: 'Optional. Definitions on Botbooru are public; signing in only makes requests count as yours.', usernameLabel: 'Username', header: bearer },
  async search(q, io) {
    return bbSearchResults(await io.json(bbSearchUrl(q, this.perPage), { ttlMs: LIST_TTL }), q, this.perPage);
  },
  async tags(io) {
    return bbTags(await io.json(bbTagsUrl(), { ttlMs: 24 * 3600_000 }));
  },
  async get(key, io, opts) {
    return bbDetail(await io.json(bbDetailUrl(key), { ttlMs: ttl(opts?.fresh), nullOn: [404] }));
  },
  async signIn(io, username, password) {
    const r = await io.json(`${BOTBOORU_SPEC.site}/auth/token`, { ttlMs: 0, form: { username, password }, auth: false });
    const token = typeof r?.access_token === 'string' ? r.access_token : null;
    if (!token) throw new HttpError(401, 'Botbooru did not accept that username and password.', 'sign_in_failed');
    return { token };
  },
  keyFromLink: bbKeyFromLink,
  urlFor: (key) => `${BOTBOORU_SPEC.site}/post/${key}`,
};

const saucepan: SourceProvider = {
  id: SAUCEPAN_SPEC.id,
  name: SAUCEPAN_SPEC.name,
  site: SAUCEPAN_SPEC.site,
  spec: SAUCEPAN_SPEC,
  perPage: 24,
  rate: { burst: 3, perSecond: 1 },
  notice: `Saucepan has no public catalogue API: Everloom uses the same requests its own app makes, and only on demand. Browsing by tag works without an account; free-text search and importing need you to sign in with your Saucepan account. Only what the creator shares comes across: fields they hid stay hidden. By continuing you take responsibility for following Saucepan's terms.`,
  account: { kind: 'password', hint: 'Needed for free-text search and importing. Only fields the creator shares are imported.', usernameLabel: 'Handle', header: bearer },
  async search(q, io) {
    const signedIn = !!io.token;
    const req = spSearchRequest(q, signedIn, this.perPage);
    return { ...spSearchResults(await io.json(req.url, { ttlMs: LIST_TTL, post: req.body }), q, this.perPage), onSite: saucepanOnSite(signedIn) };
  },
  async get(key, io, opts) {
    const listing = io.recall(key) ?? { provider: 'saucepan', key, name: 'Saucepan companion', tagline: '', creator: '', tags: [], avatarUrl: null, url: `${SAUCEPAN_SPEC.site}/companion/${key}`, nsfw: false, tokens: null, stars: null, updatedAt: null };
    if (!io.token) throw new AccountRequired('Saucepan');
    return spDetail(await io.json(spDefinitionUrl(key), { ttlMs: ttl(opts?.fresh), nullOn: [404] }), listing);
  },
  async signIn(io, username, password) {
    const req = spSignInRequest(username, password);
    const token = spSignInToken(await io.json(req.url, { ttlMs: 0, post: req.body, auth: false, nullOn: [400, 401, 403] }));
    if (!token) throw new HttpError(401, 'Saucepan did not accept that handle and password.', 'sign_in_failed');
    return { token };
  },
  keyFromLink: spKeyFromLink,
  urlFor: (key) => `${SAUCEPAN_SPEC.site}/companion/${key}`,
};

let aiccTagCache: { at: number; tags: Array<{ id: number; name: string }> } | null = null;
async function aiccTagList(io: ProviderIO) {
  if (!aiccTagCache || Date.now() - aiccTagCache.at > 24 * 3600_000) aiccTagCache = { at: Date.now(), tags: aiccTags(await io.json(aiccTagsUrl(), { ttlMs: 24 * 3600_000 })) };
  return aiccTagCache.tags;
}

const aicc: SourceProvider = {
  id: AICC_SPEC.id,
  name: AICC_SPEC.name,
  site: AICC_SPEC.site,
  spec: AICC_SPEC,
  perPage: 24,
  rate: { burst: 4, perSecond: 2 },
  async search(q, io) {
    return aiccSearchResults(await io.json(aiccSearchUrl(q, await aiccTagList(io), this.perPage), { ttlMs: LIST_TTL }), q, this.perPage);
  },
  async tags(io) {
    return (await aiccTagList(io)).map((t) => ({ tag: t.name, count: 0 }));
  },
  async get(key, io, opts) {
    const d = aiccDetail(await io.json(aiccDetailUrl(key), { ttlMs: ttl(opts?.fresh), nullOn: [404] }));
    if (!d) return null;
    if (!d.fileUrl) return { ...d.item, card: null, hidden: false, version: d.version, description: d.description };
    const parsed = readCardFile(new Uint8Array(await io.bytes(d.fileUrl, { maxBytes: 30 * 1024 * 1024 })));
    const card = { ...parsed.data, extensions: { ...parsed.data.extensions, aicc: { id: key } } };
    return { ...d.item, card, hidden: false, greetings: card.alternate_greetings.length, hasLorebook: !!card.character_book?.entries?.length, version: d.version, description: d.description };
  },
  keyFromLink: aiccKeyFromLink,
  urlFor: (key) => `${AICC_SPEC.site}/cards/${key}`,
};

/** Sites Everloom fetches from the server. The rest are in CAPABILITIES. */
export const PROVIDERS: Record<string, SourceProvider> = Object.fromEntries([chub, ctavern, risu, pygmalion, wyvern, botbooru, saucepan, aicc].map((p) => [p.id, p]));

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

/** What each site allows (PHASE2_DECISIONS.md › Phase 4 › Character sources has the reasoning). */
export const CAPABILITIES: Capability[] = [
  { id: 'chub', name: 'Chub', site: 'https://chub.ai', access: 'server', search: true, preview: true, import: true, updates: true, note: 'Public API. An optional API key makes results follow your Chub account settings.' },
  { id: 'ctavern', name: 'Character Tavern', site: 'https://character-tavern.com', access: 'server', search: true, preview: true, import: true, updates: true, note: "Reads the site's public page data (search, tags, characters); robots.txt allows it." },
  { id: 'risu', name: 'RisuRealm', site: 'https://realm.risuai.net', access: 'server', search: true, preview: true, import: true, updates: true, note: 'Public page data and the download API RisuAI itself uses (JSON, or CHARX for cards stored that way). Hidden cards are never downloaded.' },
  { id: 'pygmalion', name: 'Pygmalion', site: 'https://pygmalion.chat', access: 'server', search: true, preview: true, import: true, updates: true, note: 'Public character API. Only public characters are listed.' },
  { id: 'wyvern', name: 'Wyvern', site: 'https://app.wyvern.chat', access: 'server', search: true, preview: true, import: true, updates: true, note: "Public explore API. Fields the creator marks secret are left out and the card is labelled 'definition hidden'." },
  { id: 'botbooru', name: 'Botbooru', site: 'https://botbooru.com', access: 'server', search: true, preview: true, import: true, updates: true, note: 'Open JSON API. Its robots.txt asks crawlers to stay out, so Everloom asks you to accept a notice first and only fetches what you ask for.' },
  { id: 'saucepan', name: 'Saucepan', site: 'https://saucepan.ai', access: 'server', search: true, preview: true, import: true, updates: true, note: 'Tag browsing works signed out; free-text search and importing need your Saucepan account. Fields a creator hid stay hidden.' },
  { id: 'aicc', name: 'AI Character Cards', site: 'https://aicharactercards.com', access: 'server', search: true, preview: true, import: true, updates: true, note: 'Public card API; imports the current version of the card file. Its search ranks by meaning, so Everloom uses the plain listing with text, tags and language.' },
  { id: 'janitor', name: 'JanitorAI', site: 'https://janitorai.com', access: 'bridge', search: false, preview: false, import: true, updates: false, note: 'Behind Cloudflare: browser bridge only. A hidden definition stays hidden; only the public profile comes across.' },
  { id: 'jannyai', name: 'JannyAI', site: 'https://jannyai.com', access: 'bridge', search: false, preview: false, import: true, updates: false, note: 'Behind Cloudflare: browser bridge only.' },
  { id: 'datacat', name: 'DataCat', site: 'https://datacat.run', access: 'bridge', search: false, preview: false, import: true, updates: false, note: "DataCat's API is built around recovering definitions creators hid elsewhere, which Everloom won't take part in. The bridge can send a card page you opened, public fields only." },
  { id: 'url', name: 'Any link', site: '', access: 'server', search: false, preview: true, import: true, updates: false, note: 'A direct link to a card file (PNG, JSON or CHARX), or a link to a page on one of the sites above.' },
];

export function provider(id: string): SourceProvider {
  const p = PROVIDERS[id];
  if (!p) throw new HttpError(404, 'Unknown source');
  return p;
}
