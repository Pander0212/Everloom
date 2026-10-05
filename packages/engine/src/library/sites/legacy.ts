/**
 * The four sites from earlier phases (Chub, RisuRealm, Pygmalion, Wyvern) keep their response
 * mappers in ../sources.ts and ../providers.ts. Here: what each can filter on its side, and the
 * shared query turned into their requests.
 */
import { chubSearchUrl, type SourceSearch } from '../sources.js';
import type { SourceQuery, SourceSort } from '../source-query.js';
import type { SiteSpec } from './common.js';

export const CHUB_SPEC: SiteSpec = {
  id: 'chub',
  name: 'Chub',
  site: 'https://chub.ai',
  onSite: ['text', 'tags', 'excludeTags', 'creator', 'tokens', 'time', 'lorebook', 'greetings', 'nsfw'],
  sorts: ['popular', 'new', 'updated', 'stars', 'trending'],
  imageHosts: ['avatars.charhub.io'],
};
export const RISU_SPEC: SiteSpec = { id: 'risu', name: 'RisuRealm', site: 'https://realm.risuai.net', onSite: ['text', 'nsfw'], sorts: ['popular', 'new'], imageHosts: ['sv.risuai.xyz'] };
export const PYGMALION_SPEC: SiteSpec = { id: 'pygmalion', name: 'Pygmalion', site: 'https://pygmalion.chat', onSite: ['text', 'tags'], sorts: ['popular', 'new'], imageHosts: ['assets.pygmalion.chat'] };
export const WYVERN_SPEC: SiteSpec = { id: 'wyvern', name: 'Wyvern', site: 'https://app.wyvern.chat', onSite: ['text', 'tags', 'nsfw'], sorts: ['popular', 'new'], imageHosts: ['imagedelivery.net'] };

const LEGACY_SORTS: ReadonlyArray<SourceSearch['sort']> = ['popular', 'new', 'updated', 'stars'];

/** The shared query in the older request shape. */
export function legacySearch(q: SourceQuery): SourceSearch {
  const sort: SourceSort = q.sort === 'top' ? 'stars' : q.sort;
  return { query: q.text, page: q.page, sort: (LEGACY_SORTS as readonly string[]).includes(sort) ? (sort as SourceSearch['sort']) : 'popular', nsfw: q.nsfw, tags: q.includeTags };
}

/**
 * Chub search with everything its API takes. Chub's API isn't reachable from where Everloom was
 * built, so the filter parameters follow its public documentation and the final pass over each page
 * (applyLocalFilters) keeps results right even if one is ignored. The self-test reports which work.
 */
export function chubQueryUrl(q: SourceQuery, perPage = 24): string {
  const base = new URL(chubSearchUrl(legacySearch(q), perPage));
  const p = base.searchParams;
  if (q.sort === 'trending') p.set('sort', 'trending_downloads');
  if (q.includeTags.length) p.set('tags', q.includeTags.join(','));
  if (q.excludeTags.length) {
    p.set('exclude_tags', q.excludeTags.join(','));
    p.set('excludetopics', q.excludeTags.join(','));
  }
  if (q.creator) p.set('username', q.creator);
  if (q.minTokens != null) p.set('min_tokens', String(q.minTokens));
  if (q.maxTokens != null) p.set('max_tokens', String(q.maxTokens));
  if (q.time !== 'all') p.set('max_days_ago', String({ day: 1, week: 7, month: 30, year: 365 }[q.time]));
  if (q.hasLorebook) p.set('require_lore', 'true');
  if (q.hasGreetings) p.set('require_alternate_greetings', 'true');
  return base.href;
}
