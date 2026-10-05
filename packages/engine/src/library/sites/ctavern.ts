/**
 * Character Tavern. Its pages are SvelteKit, and the data behind them is public (`__data.json`):
 * search (text, include/exclude tags, token range, has lorebook, three orders), the tag catalogue
 * with counts, and each character's definition. The card PNG lives on its card storage host.
 * robots.txt allows everything.
 */
import { z } from 'zod';
import type { SourceQuery, SourceSort } from '../source-query.js';
import type { SourceDetail, SourceItem } from '../sources.js';
import { cardFrom, decodeSvelteKit, num, parseWith, text, time, toCharacterBook, type SitePage, type SiteSpec } from './common.js';

export const CTAVERN_SPEC: SiteSpec = {
  id: 'ctavern',
  name: 'Character Tavern',
  site: 'https://character-tavern.com',
  onSite: ['text', 'tags', 'excludeTags', 'tokens', 'lorebook'],
  sorts: ['popular', 'new', 'top'],
  imageHosts: ['ct-cards.storage.character-tavern.com'],
};
const SITE = CTAVERN_SPEC.site;
const CARDS = 'https://ct-cards.storage.character-tavern.com';
const SORT: Partial<Record<SourceSort, string>> = { popular: 'best', new: 'newest', top: 'most_liked' };
/** SvelteKit sends the page node only when it's marked invalidated. */
const PAGE_NODE = 'x-sveltekit-invalidated=001';

export function ctSearchUrl(q: SourceQuery): string {
  const p = new URLSearchParams({ query: q.text.trim(), page: String(Math.max(1, q.page)), sort: SORT[q.sort] ?? 'best' });
  if (q.includeTags.length) p.set('tags', q.includeTags.join(','));
  if (q.excludeTags.length) p.set('exclude_tags', q.excludeTags.join(','));
  if (q.minTokens != null) p.set('minimum_tokens', String(q.minTokens));
  if (q.maxTokens != null) p.set('maximum_tokens', String(q.maxTokens));
  if (q.hasLorebook) p.set('hasLorebook', 'true');
  return `${SITE}/search/cards/__data.json?${p}&${PAGE_NODE}`;
}
export const ctTagsUrl = () => `${SITE}/search/cards/__data.json?x-sveltekit-invalidated=01`;
export const ctDetailUrl = (key: string) => `${SITE}/character/${key.split('/').map(encodeURIComponent).join('/')}/__data.json?${PAGE_NODE}`;
export const ctCardUrl = (key: string) => `${CARDS}/${key.split('/').map(encodeURIComponent).join('/')}.png`;

/** "author/slug" from a character-tavern.com link. */
export function ctKeyFromLink(link: string): string | null {
  const m = /character-tavern\.com\/character\/([^/?#\s]+)\/([^/?#\s]+)/i.exec(link);
  return m ? `${decodeURIComponent(m[1]!)}/${decodeURIComponent(m[2]!)}` : null;
}

const Hit = z.object({ id: text, name: text, tagline: text, path: text, author: text, contentWarnings: z.array(z.unknown().optional()).nullish(), permanentTokens: num, tags: z.array(z.unknown().optional()).nullish() });
const Search = z.object({ searchResults: z.object({ hits: z.array(Hit), totalHits: num, page: num, totalPages: num }) });

const tagName = (t: unknown) => (typeof t === 'string' ? t : t && typeof t === 'object' ? String((t as { value?: unknown; name?: unknown }).value ?? (t as { name?: unknown }).name ?? '') : '').trim();

function toItem(h: z.infer<typeof Hit>): SourceItem {
  const warnings = (h.contentWarnings ?? []).map(tagName).filter(Boolean);
  return {
    provider: 'ctavern',
    key: h.path,
    name: h.name || h.path.split('/').pop() || 'Character',
    tagline: h.tagline,
    creator: h.author,
    tags: (h.tags ?? []).map(tagName).filter(Boolean),
    avatarUrl: h.path ? ctCardUrl(h.path) : null,
    url: `${SITE}/character/${h.path}`,
    // The listing doesn't say "adult"; a content warning is treated as one until the page says otherwise.
    nsfw: warnings.length > 0,
    tokens: h.permanentTokens,
    stars: null,
    updatedAt: null,
  };
}

export function ctSearchResults(raw: unknown): SitePage {
  const d = parseWith('Character Tavern', Search, decodeSvelteKit(raw));
  const r = d.searchResults;
  return { items: r.hits.filter((h) => h.path).map(toItem), hasMore: (r.page ?? 1) < (r.totalPages ?? 1), total: r.totalHits };
}

export function ctTags(raw: unknown): Array<{ tag: string; count: number }> {
  // The layout node streams the catalogue; it arrives as the first chunk.
  const lines = typeof raw === 'string' ? raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [raw];
  const chunk = lines.find((l: any) => l?.type === 'chunk');
  const d = chunk ? decodeSvelteKit([{ type: 'data', nodes: [{ type: 'data', data: chunk.data }] }]) : null;
  const tags = Array.isArray(d?.tags) ? d.tags : [];
  return tags.map((t: any) => ({ tag: String(t?.value ?? ''), count: Number(t?.count ?? 0) })).filter((t: { tag: string }) => t.tag);
}

const Detail = z.object({
  character: z.object({
    name: text,
    inChatName: text,
    path: text,
    tagline: text,
    description: text,
    isNSFW: z.boolean().nullish(),
    visibility: text,
    lastUpdatedAt: z.unknown().optional(),
    createdAt: z.unknown().optional(),
    definition_scenario: text,
    definition_personality: text,
    definition_character_description: text,
    definition_first_message: text,
    definition_example_messages: text,
    definition_system_prompt: text,
    definition_post_history_prompt: text,
    tokenTotal: num,
    versionId: num,
  }),
  tags: z.array(z.unknown().optional()).nullish(),
  alternativeGreetings: z.unknown().optional(),
  lorebook: z.unknown().optional(),
  authorUsername: text,
});

export function ctDetail(raw: unknown): SourceDetail | null {
  const decoded = decodeSvelteKit(raw);
  if (!decoded?.character) return null;
  const d = parseWith('Character Tavern', Detail, decoded);
  const c = d.character;
  const key = c.path;
  const tags = (d.tags ?? []).map(tagName).filter(Boolean);
  const greetings = (Array.isArray(d.alternativeGreetings) ? d.alternativeGreetings : []).map((g: any) => (typeof g === 'string' ? g : String(g?.greeting ?? g?.text ?? g?.content ?? ''))).filter(Boolean);
  const updated = time.parse(c.lastUpdatedAt ?? null) ?? time.parse(c.createdAt ?? null);
  const item: SourceItem = {
    provider: 'ctavern',
    key,
    name: c.inChatName || c.name,
    tagline: c.tagline,
    creator: d.authorUsername,
    tags,
    avatarUrl: ctCardUrl(key),
    url: `${SITE}/character/${key}`,
    nsfw: c.isNSFW === true,
    tokens: c.tokenTotal,
    stars: null,
    updatedAt: updated,
    greetings: greetings.length,
    hasLorebook: !!toCharacterBook(d.lorebook),
  };
  const hidden = !!c.visibility && c.visibility !== 'public';
  const book = toCharacterBook(d.lorebook, item.name);
  const card = cardFrom({
    name: item.name,
    description: hidden ? '' : c.definition_character_description,
    personality: hidden ? '' : c.definition_personality,
    scenario: hidden ? '' : c.definition_scenario,
    first_mes: hidden ? '' : c.definition_first_message,
    mes_example: hidden ? '' : c.definition_example_messages,
    system_prompt: hidden ? '' : c.definition_system_prompt,
    post_history_instructions: hidden ? '' : c.definition_post_history_prompt,
    creator_notes: c.description || c.tagline,
    alternate_greetings: hidden ? [] : greetings,
    tags,
    creator: d.authorUsername,
    extensions: { ctavern: { path: key }, ...(hidden ? { definition_hidden: true } : {}) },
    ...(book && !hidden ? { character_book: book } : {}),
  });
  return { ...item, card, hidden, version: String(c.versionId ?? updated ?? ''), description: c.description };
}
