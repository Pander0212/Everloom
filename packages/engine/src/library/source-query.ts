/**
 * One query for every online source. The search box takes the same filter language as the local
 * library, plus a few online-only keys:
 *
 *   dark elf tag:fantasy -tag:yandere creator:name tokens<2000 has:lorebook sort:new time:week lang:en
 *
 * Each provider maps what its site can filter onto the site's own parameters; anything left over is
 * applied to the returned page here (and the UI says so).
 */
import { parseQuery } from './filter.js';
import type { SourceItem } from './sources.js';

export const SOURCE_SORTS = ['popular', 'new', 'updated', 'trending', 'top', 'views', 'stars', 'random'] as const;
export type SourceSort = (typeof SOURCE_SORTS)[number];
export const TIME_RANGES = ['day', 'week', 'month', 'year', 'all'] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

/** Filters a site may honour on its side. */
export const SOURCE_FILTERS = ['text', 'tags', 'excludeTags', 'creator', 'tokens', 'time', 'lorebook', 'greetings', 'language', 'nsfw'] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number];

export interface SourceQuery {
  text: string;
  includeTags: string[];
  excludeTags: string[];
  creator: string;
  sort: SourceSort;
  /** For "popular"-type sorts: only what was popular in this window. */
  time: TimeRange;
  minTokens: number | null;
  maxTokens: number | null;
  hasLorebook: boolean | null;
  hasGreetings: boolean | null;
  language: string | null;
  nsfw: boolean;
  page: number;
}

export const emptySourceQuery = (): SourceQuery => ({
  text: '',
  includeTags: [],
  excludeTags: [],
  creator: '',
  sort: 'popular',
  time: 'all',
  minTokens: null,
  maxTokens: null,
  hasLorebook: null,
  hasGreetings: null,
  language: null,
  nsfw: false,
  page: 1,
});

const SORT_ALIASES: Record<string, SourceSort> = { newest: 'new', latest: 'new', recent: 'new', hot: 'trending', best: 'popular', rated: 'top', rating: 'top', liked: 'top', favorites: 'top', downloads: 'popular', star: 'stars' };

/** Read the search box: free text plus filters. Unknown keys are reported, never silently dropped. */
export function parseSourceQuery(input: string): { query: Partial<SourceQuery>; errors: string[] } {
  const q: Partial<SourceQuery> = {};
  const bad: string[] = [];
  const p = parseQuery(input, (key, value, neg) => {
    const v = value.toLowerCase();
    if (key === 'sort') {
      const s = (SOURCE_SORTS as readonly string[]).includes(v) ? (v as SourceSort) : SORT_ALIASES[v];
      if (s) q.sort = s;
      else bad.push(`sort:${value} isn't an order (try ${SOURCE_SORTS.join(', ')})`);
      return true;
    }
    if (key === 'time' || key === 'age' || key === 'within') {
      const t = (TIME_RANGES as readonly string[]).includes(v) ? (v as TimeRange) : ({ today: 'day', '24h': 'day', '7d': 'week', '30d': 'month', '1y': 'year' } as Record<string, TimeRange>)[v];
      if (t) q.time = t;
      else bad.push(`${key}:${value} isn't a time range (try ${TIME_RANGES.join(', ')})`);
      return true;
    }
    if (key === 'lang' || key === 'language') {
      if (!neg) q.language = v.slice(0, 12);
      return true;
    }
    if (key === 'nsfw') {
      q.nsfw = !neg && !/^(no|false|off|0)$/i.test(v);
      return true;
    }
    return false;
  });
  if (p.text.length) q.text = p.text.join(' ');
  if (p.tags.include.length) q.includeTags = p.tags.include;
  if (p.tags.exclude.length) q.excludeTags = p.tags.exclude;
  if (p.creator.length) q.creator = p.creator[0]!;
  for (const t of p.tokens) {
    if (t.op === '<' || t.op === '<=') q.maxTokens = t.op === '<' ? t.n - 1 : t.n;
    else if (t.op === '>' || t.op === '>=') q.minTokens = t.op === '>' ? t.n + 1 : t.n;
    else q.minTokens = q.maxTokens = t.n;
  }
  for (const h of p.has) {
    if (h.what === 'lorebook') q.hasLorebook = h.value;
    if (h.what === 'greetings') q.hasGreetings = h.value;
  }
  return { query: q, errors: [...p.errors, ...bad] };
}

/** The query written back as text (for saved searches and the URL). */
export function formatSourceQuery(q: Partial<SourceQuery>): string {
  const out: string[] = [];
  if (q.text) out.push(q.text);
  const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);
  for (const t of q.includeTags ?? []) out.push(`tag:${quote(t)}`);
  for (const t of q.excludeTags ?? []) out.push(`-tag:${quote(t)}`);
  if (q.creator) out.push(`creator:${quote(q.creator)}`);
  if (q.minTokens != null) out.push(`tokens>=${q.minTokens}`);
  if (q.maxTokens != null) out.push(`tokens<=${q.maxTokens}`);
  if (q.hasLorebook != null) out.push(q.hasLorebook ? 'has:lorebook' : 'no:lorebook');
  if (q.hasGreetings != null) out.push(q.hasGreetings ? 'has:greetings' : 'no:greetings');
  if (q.language) out.push(`lang:${q.language}`);
  if (q.sort && q.sort !== 'popular') out.push(`sort:${q.sort}`);
  if (q.time && q.time !== 'all') out.push(`time:${q.time}`);
  return out.join(' ');
}

const norm = (t: string) => t.toLowerCase().replace(/[\s_-]+/g, ' ').trim();

/**
 * The last pass over a returned page. Text and creator are only matched here when the site can't
 * (sites match those on fields Everloom doesn't see). Tags, tokens, lorebook, greetings, language and
 * adult content are always checked where the listing says, so a site that quietly ignores a
 * parameter still gives correct results. `local` lists the active filters the site doesn't do, so the
 * UI can say "filtered on this page only".
 */
export function applyLocalFilters<T extends SourceItem>(items: T[], q: SourceQuery, onSite: ReadonlySet<SourceFilter>): { items: T[]; local: SourceFilter[] } {
  const local: SourceFilter[] = [];
  const active = (f: SourceFilter, on: boolean) => {
    if (on && !onSite.has(f)) local.push(f);
    return on;
  };
  let out = items;
  if (active('text', !!q.text.trim()) && !onSite.has('text')) {
    const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
    out = out.filter((i) => {
      const hay = `${i.name} ${i.tagline} ${i.creator} ${i.tags.join(' ')}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  if (active('creator', !!q.creator) && !onSite.has('creator')) out = out.filter((i) => i.creator.toLowerCase().includes(q.creator.toLowerCase()));
  // A listing without tags says nothing about them; when the site filtered by tag, trust it then.
  const tagsUnknown = (i: T, f: SourceFilter) => i.tags.length === 0 && onSite.has(f);
  if (active('tags', q.includeTags.length > 0)) out = out.filter((i) => tagsUnknown(i, 'tags') || q.includeTags.every((t) => i.tags.some((x) => norm(x) === norm(t))));
  if (active('excludeTags', q.excludeTags.length > 0)) out = out.filter((i) => !q.excludeTags.some((t) => i.tags.some((x) => norm(x) === norm(t))));
  if (active('tokens', q.minTokens != null || q.maxTokens != null)) out = out.filter((i) => i.tokens == null || ((q.minTokens == null || i.tokens >= q.minTokens) && (q.maxTokens == null || i.tokens <= q.maxTokens)));
  if (active('lorebook', q.hasLorebook != null)) out = out.filter((i) => i.hasLorebook == null || i.hasLorebook === q.hasLorebook);
  if (active('greetings', q.hasGreetings != null)) out = out.filter((i) => i.greetings == null || i.greetings > 0 === q.hasGreetings);
  if (active('language', !!q.language)) out = out.filter((i) => !i.language || i.language.toLowerCase().startsWith(q.language!.toLowerCase()));
  if (active('time', q.time !== 'all') && !onSite.has('time')) {
    const span = { day: 1, week: 7, month: 30, year: 365, all: 0 }[q.time] * 24 * 3600_000;
    out = out.filter((i) => i.updatedAt == null || Date.now() - i.updatedAt <= span);
  }
  // Adult content is always enforced here too, whatever the site did.
  if (!q.nsfw) out = out.filter((i) => !i.nsfw);
  return { items: out, local };
}

/** Same character on two sites: a loose key from the name and creator. */
export function crossSourceKey(i: Pick<SourceItem, 'name' | 'creator'>): string {
  const n = i.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const c = i.creator.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return `${n}|${c}`;
}
