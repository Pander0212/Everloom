/**
 * Botbooru: a booru-style site with an open JSON API under the site root. Search takes a tag query
 * (`elf -yandere`), free text, a token range, a time window for its popularity sorts and an SFW-only
 * switch; each post returns its full card (definitions on Botbooru are always public). The creator is
 * a "Writer" tag, language a "Language" tag. Its robots.txt asks crawlers to stay out of /post/ and
 * the API, so Everloom only fetches on demand, after the owner accepts the site notice.
 */
import { z } from 'zod';
import type { SourceQuery, SourceSort } from '../source-query.js';
import type { SourceDetail, SourceItem } from '../sources.js';
import { cardFrom, num, parseWith, text, time, toCharacterBook, type SitePage, type SiteSpec } from './common.js';

export const BOTBOORU_SPEC: SiteSpec = {
  id: 'botbooru',
  name: 'Botbooru',
  site: 'https://botbooru.com',
  onSite: ['text', 'tags', 'excludeTags', 'creator', 'tokens', 'time', 'nsfw'],
  sorts: ['popular', 'new', 'top', 'views', 'random'],
  imageHosts: ['botbooru.com'],
};
const SITE = BOTBOORU_SPEC.site;
export const BOTBOORU_PER_PAGE = 24;
const SORT: Partial<Record<SourceSort, string>> = { popular: 'downloads', new: 'latest', top: 'favorites', views: 'views', random: 'random', trending: 'views' };
const asTag = (t: string) => t.trim().toLowerCase().replace(/\s+/g, '_');

export function bbSearchUrl(q: SourceQuery, perPage = BOTBOORU_PER_PAGE): string {
  const tags = [...q.includeTags.map(asTag), ...q.excludeTags.map((t) => `-${asTag(t)}`), ...(q.creator ? [asTag(q.creator)] : [])];
  const p = new URLSearchParams({ sort: SORT[q.sort] ?? 'downloads', limit: String(perPage), offset: String((Math.max(1, q.page) - 1) * perPage) });
  if (tags.length) p.set('q', tags.join(' '));
  if (q.text.trim()) p.set('qtext', q.text.trim());
  if (q.minTokens != null) p.set('min_tokens', String(q.minTokens));
  if (q.maxTokens != null) p.set('max_tokens', String(q.maxTokens));
  if (q.time !== 'all' && ['downloads', 'favorites', 'views'].includes(p.get('sort')!)) p.set('time_window', q.time === 'year' ? 'all' : q.time);
  if (!q.nsfw) p.set('sfw_only', 'true');
  return `${SITE}/posts/?${p}`;
}
export const bbDetailUrl = (id: string) => `${SITE}/post/${encodeURIComponent(id)}`;
export const bbTagsUrl = () => `${SITE}/tags/`;
export const bbImageUrl = (filename: string) => `${SITE}/images/${encodeURIComponent(filename)}`;
export const bbThumbUrl = (filename: string) => `${SITE}/images/preview/480/${encodeURIComponent(filename)}`;

export function bbKeyFromLink(link: string): string | null {
  const m = /botbooru\.com\/(?:post|posts|character)\/(\d+)/i.exec(link);
  return m ? m[1]! : null;
}

const Tag = z.object({ name: text, category: text });
const Post = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  filename: text,
  character_name: text,
  tagline: text.optional(),
  creator_notes_excerpt: text.optional(),
  created_at: time,
  content_updated_at: time.optional(),
  tags: z.array(Tag).nullish(),
  token_count: num,
  favorite_count: num.optional(),
  downloads: num.optional(),
});
const Search = z.object({ total: num, posts: z.array(Post) });

function facts(tags: Array<{ name: string; category: string }>) {
  const names = tags.map((t) => t.name);
  return {
    tags: tags.filter((t) => t.category !== 'Auto' && t.category !== 'Writer' && t.category !== 'Language' && t.category !== 'Artist').map((t) => t.name.replace(/_/g, ' ')),
    creator: tags.find((t) => t.category === 'Writer')?.name ?? '',
    language: tags.find((t) => t.category === 'Language')?.name ?? null,
    nsfw: !names.includes('sfw') || names.includes('nsfw') || names.includes('nsfl'),
    hasLorebook: names.includes('contains_lorebook'),
    multipleGreetings: names.includes('multiple_greetings'),
  };
}

function toItem(p: z.infer<typeof Post>): SourceItem {
  const f = facts(p.tags ?? []);
  return {
    provider: 'botbooru',
    key: p.id,
    name: p.character_name || `Post ${p.id}`,
    tagline: p.tagline || (p.creator_notes_excerpt ?? '').slice(0, 200),
    creator: f.creator,
    tags: f.tags,
    avatarUrl: p.filename ? bbThumbUrl(p.filename) : null,
    url: `${SITE}/post/${p.id}`,
    nsfw: f.nsfw,
    tokens: p.token_count,
    stars: p.favorite_count ?? null,
    updatedAt: p.content_updated_at ?? p.created_at,
    hasLorebook: f.hasLorebook,
    greetings: f.multipleGreetings ? 1 : null,
    language: f.language,
  };
}

export function bbSearchResults(body: unknown, q: SourceQuery, perPage = BOTBOORU_PER_PAGE): SitePage {
  const d = parseWith('Botbooru', Search, body);
  return { items: d.posts.map(toItem), hasMore: (d.total ?? 0) > Math.max(1, q.page) * perPage, total: d.total };
}

export function bbTags(body: unknown): Array<{ tag: string; count: number }> {
  const list = parseWith('Botbooru', z.array(z.object({ name: text, count: num, alias_of: text.optional(), category: text.optional() })), body);
  return list.filter((t) => !t.alias_of && t.category !== 'Auto' && t.category !== 'Writer').map((t) => ({ tag: t.name.replace(/_/g, ' '), count: t.count ?? 0 }));
}

const Detail = Post.extend({
  description: text,
  personality: text,
  scenario: text,
  first_mes: text,
  mes_example: text,
  creator_notes: text,
  creator_notes_display: text,
  system_prompt: text,
  post_history_instructions: text,
  alternate_greetings: z.unknown().optional(),
  uploader_name: text,
  lorebook_json: z.unknown().optional(),
  revision_count: num.optional(),
  status: text.optional(),
});

const parseMaybeJson = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

export function bbDetail(body: unknown): SourceDetail | null {
  if (!body || typeof body !== 'object' || !('id' in body)) return null;
  const d = parseWith('Botbooru', Detail, body);
  const item = toItem(d);
  const greetings = parseMaybeJson(d.alternate_greetings);
  const alts = Array.isArray(greetings) ? greetings.map(String).filter(Boolean) : [];
  const book = toCharacterBook(d.lorebook_json, item.name);
  // The site keeps notes HTML-escaped; the display copy is the plain one.
  const notes = d.creator_notes_display || d.creator_notes.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  if (d.filename) item.avatarUrl = bbImageUrl(d.filename);
  item.greetings = alts.length;
  item.hasLorebook = !!book;
  const card = cardFrom({
    name: item.name,
    description: d.description,
    personality: d.personality,
    scenario: d.scenario,
    first_mes: d.first_mes,
    mes_example: d.mes_example,
    creator_notes: notes,
    system_prompt: d.system_prompt,
    post_history_instructions: d.post_history_instructions,
    alternate_greetings: alts,
    tags: item.tags,
    creator: item.creator || d.uploader_name,
    extensions: { botbooru: { id: d.id } },
    ...(book ? { character_book: book } : {}),
  });
  if (!item.creator) item.creator = d.uploader_name;
  return { ...item, card, hidden: false, version: `${d.revision_count ?? 0}:${d.content_updated_at ?? d.created_at ?? ''}`, description: notes };
}

