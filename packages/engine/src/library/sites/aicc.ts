/**
 * AI Character Cards. Its site is a Next.js app over a public JSON API (api.aicharactercards.com):
 * the listing takes free text, tag ids (any of them), excluded tag ids and a language; each card's
 * page lists its versions, and the current one is an ordinary PNG card file. robots.txt allows
 * reference use. Ordering and adult content aren't honoured by the API, so those are applied here.
 */
import { z } from 'zod';
import type { SourceQuery } from '../source-query.js';
import type { SourceItem } from '../sources.js';
import { bool, num, parseWith, text, time, type SitePage, type SiteSpec } from './common.js';

export const AICC_SPEC: SiteSpec = {
  id: 'aicc',
  name: 'AI Character Cards',
  site: 'https://aicharactercards.com',
  // Tags go to the site as "any of"; the final pass makes it "all of".
  onSite: ['text', 'excludeTags', 'language'],
  sorts: ['new'],
  imageHosts: ['api.aicharactercards.com'],
};
const API = 'https://api.aicharactercards.com';
export const AICC_PER_PAGE = 24;

export interface AiccTag {
  id: number;
  name: string;
}

export function aiccSearchUrl(q: SourceQuery, tags: AiccTag[], perPage = AICC_PER_PAGE): string {
  const p = new URLSearchParams({ limit: String(perPage), page: String(Math.max(1, q.page)) });
  const ids = (names: string[]) => names.map((n) => tags.find((t) => t.name.toLowerCase() === n.toLowerCase())?.id).filter((x): x is number => x != null);
  if (q.text.trim()) p.set('search', q.text.trim());
  const inc = ids(q.includeTags);
  if (inc.length) p.set('tags', inc.join(','));
  const exc = ids(q.excludeTags);
  if (exc.length) p.set('excludeTags', exc.join(','));
  if (q.language) p.set('language', q.language);
  return `${API}/api/cards?${p}`;
}
export const aiccDetailUrl = (id: string) => `${API}/api/cards/${encodeURIComponent(id)}`;
export const aiccTagsUrl = () => `${API}/api/cards/metadata/tags`;
const abs = (u: string) => (/^https?:\/\//.test(u) ? u : `${API}${u.startsWith('/') ? '' : '/'}${u}`);

export function aiccKeyFromLink(link: string): string | null {
  const m = /aicharactercards\.com\/(?:[a-z]{2}\/)?cards\/(\d+)(?:[/?#]|$)/i.exec(link);
  return m ? m[1]! : null;
}

const Tag = z.object({ id: num, name: text });
const Card = z.object({
  id: num,
  title: text,
  titleEn: text,
  excerpt: text,
  excerptEn: text,
  imageUrl: text,
  language: text,
  author: text,
  isNsfw: bool,
  tokenCount: num,
  downloadCount: num,
  createdAt: time,
  updatedAt: time,
  tags: z.array(Tag).nullish(),
  attachedLorebookId: z.unknown().optional(),
});
const List = z.object({ data: z.array(Card), pagination: z.object({ skip: num, limit: num, total: num }).nullish() });

function toItem(c: z.infer<typeof Card>): SourceItem {
  return {
    provider: 'aicc',
    key: String(c.id),
    name: c.titleEn || c.title || `Card ${c.id}`,
    tagline: c.excerptEn || c.excerpt,
    creator: c.author,
    tags: (c.tags ?? []).map((t) => t.name).filter(Boolean),
    avatarUrl: c.imageUrl ? abs(c.imageUrl) : null,
    url: `https://aicharactercards.com/cards/${c.id}`,
    nsfw: c.isNsfw === true,
    tokens: c.tokenCount,
    stars: c.downloadCount,
    updatedAt: c.updatedAt ?? c.createdAt,
    language: c.language || null,
    hasLorebook: c.attachedLorebookId === undefined ? null : c.attachedLorebookId != null,
  };
}

export function aiccSearchResults(body: unknown, q: SourceQuery, perPage = AICC_PER_PAGE): SitePage {
  const d = parseWith('AI Character Cards', List, body);
  const total = d.pagination?.total ?? null;
  return { items: d.data.map(toItem), hasMore: total != null ? total > Math.max(1, q.page) * perPage : d.data.length === perPage, total };
}

export function aiccTags(body: unknown): AiccTag[] {
  const d = parseWith('AI Character Cards', z.object({ data: z.array(Tag) }), body);
  return d.data.filter((t) => t.id != null && t.name).map((t) => ({ id: t.id!, name: t.name }));
}

/** The listing item and where its current card file is. The card itself is read from that file. */
export function aiccDetail(body: unknown): { item: SourceItem; fileUrl: string | null; version: string; description: string } | null {
  if (!body || typeof body !== 'object') return null;
  const root = ((body as Record<string, unknown>).data ?? body) as Record<string, unknown>;
  if (!root || root.id == null) return null;
  const d = parseWith('AI Character Cards', Card.extend({ description: text, versions: z.array(z.object({ version: num, isCurrent: bool, fileUrl: text })).nullish() }), root);
  const versions = d.versions ?? [];
  const current = versions.find((v) => v.isCurrent) ?? versions.at(-1);
  return { item: toItem(d), fileUrl: current?.fileUrl ? abs(current.fileUrl) : null, version: `${current?.version ?? 0}:${d.updatedAt ?? ''}`, description: d.description };
}
