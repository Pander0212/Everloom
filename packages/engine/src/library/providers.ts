/**
 * Mappings for the other public character catalogs (Character Tavern, RisuRealm, Pygmalion,
 * Wyvern). Pure functions over the sites' public responses, tested against recorded fixtures.
 * Only fields a site shows publicly are read; anything its creator marks hidden stays out and the
 * card is reported as hidden.
 */
import { emptyCardData } from '../cards/card.js';
import type { SourceDetail, SourceItem, SourceSearch } from './sources.js';

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim();
const time = (v: unknown) => {
  const t = typeof v === 'number' ? v : Date.parse(str(v));
  return Number.isFinite(t) && t > 0 ? t : null;
};
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const NSFW_TAG = /^(nsfw|explicit|18\+|adult|smut)$/i;
const cleanTags = (tags: string[]) => tags.filter((t) => t && !/^(nsfw|sfw)$/i.test(t)).slice(0, 30);

/** Where a hidden-definition card keeps what's public, and the label the library shows. */
export const HIDDEN_LABEL = 'Definition hidden by creator';

function publicOnlyCard(item: SourceItem, about: string, firstMes = ''): NonNullable<SourceDetail['card']> {
  return { ...emptyCardData(item.name), creator_notes: about, first_mes: firstMes, tags: cleanTags(item.tags), creator: item.creator, extensions: { definition_hidden: true } };
}

// ------------------------------------------------------------------ Character Tavern

export const CTAVERN = { id: 'ctavern', name: 'Character Tavern', site: 'https://character-tavern.com', cards: 'https://cards.character-tavern.com' } as const;

export function ctSearchUrl(q: SourceSearch, perPage = 24): string {
  const p = new URLSearchParams({ query: q.query.trim(), limit: String(perPage), page: String(Math.max(1, q.page)) });
  if (q.tags?.length) p.set('tags', q.tags.join(','));
  if (q.sort === 'new') p.set('sort', 'created');
  return `${CTAVERN.site}/api/search/cards?${p}`;
}
export const ctDetailUrl = (key: string) => `${CTAVERN.site}/api/character/${key.split('/').map(encodeURIComponent).join('/')}`;
export function ctKeyFromLink(link: string): string | null {
  const m = /(?:^|\/\/)(?:www\.)?character-tavern\.com\/character\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.%-]+)/i.exec(link);
  return m ? `${m[1]}/${decodeURIComponent(m[2]!).replace(/[?#].*$/, '')}` : null;
}

function ctItem(h: any, extra: { nsfw?: boolean; tags?: string[]; updated?: unknown } = {}): SourceItem | null {
  const key = str(h?.path);
  if (!/^[^/\s]+\/[^/\s]+$/.test(key)) return null;
  const tags = (Array.isArray(extra.tags ?? h.tags) ? (extra.tags ?? h.tags) : []).map(str).filter(Boolean);
  const warnings = (Array.isArray(h.contentWarnings) ? h.contentWarnings : []).map(str);
  return {
    provider: CTAVERN.id,
    key,
    name: str(h.name) || key.split('/')[1]!,
    tagline: str(h.tagline),
    creator: typeof h.author === 'string' ? h.author : key.split('/')[0]!,
    tags,
    avatarUrl: `${CTAVERN.cards}/${key}.png`,
    url: `${CTAVERN.site}/character/${key}`,
    nsfw: extra.nsfw ?? (h.isNSFW === true || warnings.some((w: string) => /sexual|nsfw|explicit/i.test(w)) || tags.some((t: string) => NSFW_TAG.test(t))),
    tokens: num(h.permanentTokens ?? h.tokenTotal),
    stars: null,
    updatedAt: time(extra.updated ?? h.lastUpdatedAt),
  };
}

export function ctSearchResults(body: any): { items: SourceItem[]; hasMore: boolean } {
  const hits = Array.isArray(body?.hits) ? body.hits : [];
  return { items: hits.map((h: any) => ctItem(h)).filter((x: SourceItem | null): x is SourceItem => !!x), hasMore: (num(body?.page) ?? 1) < (num(body?.totalPages) ?? 0) };
}

export function ctDetail(body: any): SourceDetail | null {
  const c = body?.card;
  if (!c) return null;
  const item = ctItem(c, { tags: Array.isArray(c.tags) ? c.tags : [] });
  if (!item) return null;
  const defs = [c.definition_character_description, c.definition_personality, c.definition_scenario, c.definition_first_message].map(str);
  const hidden = c.visibility !== 'public' || defs.every((x) => !x);
  const card = hidden
    ? publicOnlyCard(item, str(c.description) || item.tagline)
    : {
        ...emptyCardData(str(c.inChatName) || item.name),
        description: str(c.definition_character_description),
        personality: str(c.definition_personality),
        scenario: str(c.definition_scenario),
        first_mes: str(c.definition_first_message),
        mes_example: str(c.definition_example_messages),
        system_prompt: str(c.definition_system_prompt),
        post_history_instructions: str(c.definition_post_history_prompt),
        creator_notes: str(c.description) || item.tagline,
        tags: cleanTags(item.tags),
        creator: item.creator,
        character_version: str(c.versionId),
        extensions: { ctavern: { path: item.key, id: str(c.id) } },
      };
  return { ...item, card, hidden, version: `${str(c.versionId)}:${str(c.lastUpdatedAt)}`, description: str(c.description) || item.tagline };
}

// ------------------------------------------------------------------ RisuRealm

export const RISU = { id: 'risu', name: 'RisuRealm', site: 'https://realm.risuai.net', images: 'https://sv.risuai.xyz' } as const;

/** The site's page data is "devalue"-flattened: objects and arrays hold indexes into one array. */
export function unflattenPageData(body: any): any {
  const node = (Array.isArray(body?.nodes) ? body.nodes : []).filter((n: any) => n?.type === 'data').at(-1);
  const d: unknown[] = node?.data;
  if (!Array.isArray(d) || !d.length) return null;
  const seen = new Map<number, unknown>();
  const at = (i: unknown, depth = 0): unknown => {
    if (typeof i !== 'number' || i < 0 || i >= d.length || depth > 20) return null;
    if (seen.has(i)) return seen.get(i);
    const v = d[i];
    let out: unknown = v;
    if (Array.isArray(v)) {
      const arr: unknown[] = [];
      seen.set(i, arr);
      for (const x of v) arr.push(at(x, depth + 1));
      out = arr;
    } else if (v && typeof v === 'object') {
      const obj: Record<string, unknown> = {};
      seen.set(i, obj);
      for (const [k, x] of Object.entries(v)) obj[k] = at(x, depth + 1);
      out = obj;
    }
    seen.set(i, out);
    return out;
  };
  return at(0);
}

export function risuSearchUrl(q: SourceSearch): string {
  const p = new URLSearchParams({ q: q.query.trim(), page: String(Math.max(1, q.page)) });
  if (q.sort === 'popular') p.set('sort', 'download');
  if (q.nsfw) p.set('nsfw', 'true');
  return `${RISU.site}/__data.json?${p}`;
}
export const risuMetaUrl = (id: string) => `${RISU.site}/character/${encodeURIComponent(id)}/__data.json`;
export const risuDownloadUrl = (id: string) => `${RISU.site}/api/v1/download/json-v2/${encodeURIComponent(id)}`;
export function risuKeyFromLink(link: string): string | null {
  return /(?:^|\/\/)realm\.risuai\.net\/character\/([0-9a-f-]{36})/i.exec(link)?.[1] ?? null;
}

function risuItem(c: any): SourceItem | null {
  const id = str(c?.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const tags = (Array.isArray(c.tags) ? c.tags : []).map(str).filter(Boolean);
  const downloads = str(c.download);
  return {
    provider: RISU.id,
    key: id,
    name: str(c.name) || 'Untitled',
    tagline: str(c.desc).split(/\r?\n/).find((l: string) => l.trim() && !/^\[.*\]$/.test(l.trim()))?.trim().slice(0, 200) ?? '',
    creator: str(c.authorname),
    tags,
    avatarUrl: /^[0-9a-f]{16,}$/i.test(str(c.img)) ? `${RISU.images}/resource/${str(c.img)}` : null,
    url: `${RISU.site}/character/${id}`,
    nsfw: c.nsfw === true || c.nsfw === 1 || tags.some((t: string) => NSFW_TAG.test(t)),
    tokens: null,
    stars: /k$/i.test(downloads) ? Math.round(Number(downloads.slice(0, -1)) * 1000) : num(downloads),
    // RisuRealm dates are minutes since 1970.
    updatedAt: num(c.date) ? num(c.date)! * 60_000 : null,
  };
}

export function risuSearchResults(body: any): { items: SourceItem[]; hasMore: boolean } {
  const root = unflattenPageData(body);
  const cards = Array.isArray(root?.cards) ? root.cards : [];
  const items = cards.map(risuItem).filter((x: SourceItem | null): x is SourceItem => !!x);
  return { items, hasMore: cards.length >= 30 };
}

/** Meta from the character page plus the public card download. */
export function risuDetail(metaBody: any, cardBody: any): SourceDetail | null {
  const root = unflattenPageData(metaBody);
  const item = risuItem(root?.card ?? root);
  if (!item) return null;
  const d = cardBody?.data;
  const hidden = (root?.card?.hidden ?? 0) !== 0 || !d || !(str(d.description) || str(d.first_mes) || str(d.personality));
  const about = str(root?.card?.desc);
  const card = hidden
    ? publicOnlyCard(item, about)
    : {
        ...emptyCardData(str(d.name) || item.name),
        description: str(d.description),
        personality: str(d.personality),
        scenario: str(d.scenario),
        first_mes: str(d.first_mes),
        mes_example: str(d.mes_example),
        system_prompt: str(d.system_prompt),
        post_history_instructions: str(d.post_history_instructions),
        alternate_greetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings.map(str) : [],
        creator_notes: str(d.creator_notes) || about,
        tags: cleanTags(item.tags),
        creator: item.creator || str(d.creator),
        character_version: str(d.character_version),
        extensions: { risu: { id: item.key, license: str(root?.card?.license) } },
        ...(d.character_book && Array.isArray(d.character_book.entries) && d.character_book.entries.length ? { character_book: d.character_book } : {}),
      };
  return { ...item, card, hidden, version: String(root?.card?.date ?? ''), description: about };
}

// ------------------------------------------------------------------ Pygmalion

export const PYGMALION = { id: 'pygmalion', name: 'Pygmalion', site: 'https://pygmalion.chat', api: 'https://server.pygmalion.chat' } as const;

export const pygSearchRequest = (q: SourceSearch, perPage = 24) => ({
  url: `${PYGMALION.api}/galatea.v1.PublicCharacterService/CharacterSearch`,
  body: { query: q.query.trim(), pageSize: perPage, page: Math.max(0, q.page - 1), ...(q.tags?.length ? { tagsInclude: q.tags } : {}), ...(q.sort === 'new' ? { orderBy: 'approved_at' } : {}) },
});
export const pygDetailRequest = (id: string) => ({ url: `${PYGMALION.api}/galatea.v1.PublicCharacterService/Character`, body: { characterMetaId: id } });
export function pygKeyFromLink(link: string): string | null {
  return /(?:^|\/\/)(?:www\.)?pygmalion\.chat\/character\/([0-9a-f-]{36})/i.exec(link)?.[1] ?? null;
}

function pygItem(c: any): SourceItem | null {
  const id = str(c?.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const tags = (Array.isArray(c.tags) ? c.tags : []).map(str).filter(Boolean);
  return {
    provider: PYGMALION.id,
    key: id,
    name: str(c.displayName) || 'Untitled',
    tagline: str(c.description).split(/\r?\n/)[0]!.slice(0, 200),
    creator: str(c.owner?.username ?? c.owner?.displayName ?? c.personality?.creator),
    tags,
    avatarUrl: str(c.avatarUrl) || null,
    url: `${PYGMALION.site}/character/${id}`,
    nsfw: c.isSensitive === true || tags.some((t: string) => NSFW_TAG.test(t)),
    tokens: num(c.personalityTokenCount),
    stars: num(c.stars),
    updatedAt: time(num(c.updatedAt) ? Number(c.updatedAt) * 1000 : c.updatedAt),
  };
}

export function pygSearchResults(body: any, page: number, perPage = 24): { items: SourceItem[]; hasMore: boolean } {
  const list = Array.isArray(body?.characters) ? body.characters : [];
  return { items: list.filter((c: any) => c?.isPublic !== false).map(pygItem).filter((x: SourceItem | null): x is SourceItem => !!x), hasMore: page * perPage < (num(body?.totalItems) ?? 0) };
}

export function pygDetail(body: any): SourceDetail | null {
  const c = body?.character;
  const item = pygItem(c);
  if (!item) return null;
  const p = c.personality ?? {};
  const hidden = c.isPublic === false || !(str(p.persona) || str(p.greeting));
  const card = hidden
    ? publicOnlyCard(item, str(c.description))
    : {
        ...emptyCardData(str(p.name) || item.name),
        description: str(p.persona),
        first_mes: str(p.greeting),
        mes_example: str(p.mesExample ?? p.exampleConversation),
        alternate_greetings: Array.isArray(p.alternateGreetings) ? p.alternateGreetings.map(str).filter(Boolean) : [],
        creator_notes: str(c.description),
        tags: cleanTags(item.tags),
        creator: item.creator || str(p.creator),
        character_version: str(c.versionId),
        extensions: { pygmalion: { id: item.key, source: str(c.source) } },
      };
  return { ...item, card, hidden, version: `${str(c.versionId)}:${str(c.updatedAt)}`, description: str(c.description) };
}

// ------------------------------------------------------------------ Wyvern

export const WYVERN = { id: 'wyvern', name: 'Wyvern', site: 'https://app.wyvern.chat', api: 'https://api.wyvern.chat' } as const;

export function wyvSearchUrl(q: SourceSearch, perPage = 24): string {
  const p = new URLSearchParams({ q: q.query.trim(), limit: String(perPage), page: String(Math.max(1, q.page)) });
  if (!q.nsfw) p.set('rating', 'none');
  if (q.sort === 'new') p.set('sort', 'created_at');
  if (q.tags?.length) p.set('tags', q.tags.join(','));
  return `${WYVERN.api}/exploreSearch/characters?${p}`;
}
export const wyvDetailUrl = (id: string) => `${WYVERN.api}/characters/${encodeURIComponent(id)}`;
export function wyvKeyFromLink(link: string): string | null {
  return /(?:^|\/\/)(?:app\.)?wyvern\.chat\/characters\/([A-Za-z0-9_-]{8,})/i.exec(link)?.[1] ?? null;
}

function wyvItem(c: any): SourceItem | null {
  const id = str(c?.id ?? c?._id);
  if (!/^[A-Za-z0-9_-]{8,}$/.test(id)) return null;
  const tags = (Array.isArray(c.tags) ? c.tags : []).map(str).filter(Boolean);
  return {
    provider: WYVERN.id,
    key: id,
    name: str(c.name) || 'Untitled',
    tagline: str(c.tagline),
    creator: str(c.creator?.displayName ?? c.creator?.vanityUrl ?? ''),
    tags,
    avatarUrl: str(c.avatar) || null,
    url: `${WYVERN.site}/characters/${id}`,
    nsfw: !['none', ''].includes(str(c.rating).toLowerCase()) || tags.some((t: string) => NSFW_TAG.test(t)),
    tokens: num(c.token_count?.total ?? c.token_count),
    stars: num(c.entity_statistics?.total_likes ?? c.likes),
    updatedAt: time(c.updated_at),
  };
}

export function wyvSearchResults(body: any): { items: SourceItem[]; hasMore: boolean } {
  const list = Array.isArray(body?.results) ? body.results : [];
  return { items: list.filter((c: any) => (c?.visibility ?? 'public') === 'public').map(wyvItem).filter((x: SourceItem | null): x is SourceItem => !!x), hasMore: body?.hasMore === true };
}

/** Fields the creator listed as secret are never read, and the card is marked as hidden. */
export function wyvDetail(c: any): SourceDetail | null {
  const item = wyvItem(c);
  if (!item) return null;
  const secret = new Set((Array.isArray(c.secretFields) ? c.secretFields : []).map(str));
  const pick = (field: string) => (secret.has(field) ? '' : str(c[field]));
  const defFields = ['description', 'personality', 'scenario', 'first_mes', 'mes_example'];
  const hidden = c.visibility !== 'public' || defFields.some((f) => secret.has(f)) || defFields.every((f) => !pick(f));
  const card = {
    ...emptyCardData(item.name),
    description: pick('description'),
    personality: pick('personality'),
    scenario: pick('scenario'),
    first_mes: pick('first_mes'),
    mes_example: pick('mes_example'),
    post_history_instructions: pick('post_history_instructions'),
    system_prompt: pick('pre_history_instructions'),
    alternate_greetings: secret.has('alternate_greetings') || !Array.isArray(c.alternate_greetings) ? [] : c.alternate_greetings.map(str).filter(Boolean),
    creator_notes: pick('creator_notes') || item.tagline,
    tags: cleanTags(item.tags),
    creator: item.creator,
    extensions: { wyvern: { id: item.key }, ...(hidden ? { definition_hidden: true } : {}) },
  };
  return { ...item, card, hidden, version: str(c.updated_at), description: pick('creator_notes') || item.tagline };
}
