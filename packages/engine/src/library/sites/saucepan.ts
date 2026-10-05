/**
 * Saucepan. Its app talks to a JSON API on the same origin. Searching by tags works without an
 * account; free-text search and every character's definition need one (a Bearer token from the
 * site's own sign-in). The definition endpoint only returns what the creator chose to share: fields
 * they hid stay out, and the card is labelled "definition hidden" when the main text is missing.
 * Pictures come from the site's image CDN.
 */
import { z } from 'zod';
import type { SourceFilter, SourceQuery, SourceSort } from '../source-query.js';
import type { SourceDetail, SourceItem } from '../sources.js';
import { bool, cardFrom, num, parseWith, text, time, type SitePage, type SiteSpec } from './common.js';

export const SAUCEPAN_SPEC: SiteSpec = {
  id: 'saucepan',
  name: 'Saucepan',
  site: 'https://saucepan.ai',
  onSite: ['text', 'tags', 'excludeTags', 'nsfw'],
  sorts: ['popular', 'trending', 'new', 'updated', 'random'],
  imageHosts: ['saucepan.ai'],
};
const SITE = SAUCEPAN_SPEC.site;
const API = `${SITE}/api/v1`;
export const SAUCEPAN_PER_PAGE = 24;
const SORT: Partial<Record<SourceSort, string>> = { popular: 'popularity', trending: 'trending', new: 'created', updated: 'updated', random: 'random', top: 'popularity', stars: 'popularity', views: 'popularity' };
const asTag = (t: string) => t.trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Filters the site applies; free text only with an account (anonymous text search returns nothing). */
export const saucepanOnSite = (signedIn: boolean): SourceFilter[] => SAUCEPAN_SPEC.onSite.filter((f) => signedIn || f !== 'text');

export function spSearchRequest(q: SourceQuery, signedIn: boolean, perPage = SAUCEPAN_PER_PAGE) {
  const body: Record<string, unknown> = {
    sus: q.nsfw,
    asc: false,
    order_by: SORT[q.sort] ?? 'popularity',
    limit: perPage,
    offset: (Math.max(1, q.page) - 1) * perPage,
  };
  if (q.includeTags.length) {
    body.tags = q.includeTags.map(asTag);
    body.match_all_tags = true;
  }
  if (q.excludeTags.length) body.excluded_tags = q.excludeTags.map(asTag);
  if (signedIn && q.text.trim()) body.text_search = q.text.trim();
  return { url: `${API}/search`, body };
}
export const spDefinitionUrl = (id: string) => `${API}/companion/definition?companion_id=${encodeURIComponent(id)}`;
export const spSignInRequest = (handle: string, password: string) => ({ url: `${API}/auth/sign_in_password`, body: { handle, password } });
export const spImageUrl = (imageId: string, size: 'thumbnail' | 'public' = 'thumbnail') => `${SITE}/cdn/${encodeURIComponent(imageId)}/${size}`;

export function spKeyFromLink(link: string): string | null {
  const m = /saucepan\.ai\/(?:companion|c|companions)\/([0-9a-f-]{36})/i.exec(link);
  return m ? m[1]!.toLowerCase() : null;
}

const Companion = z.object({
  id: text,
  author_handle: text,
  name: text,
  display_name: text,
  short_description: text,
  tags: z.array(z.string()).nullish(),
  image: z.object({ id: text }).nullish(),
  sus: bool,
  very_sus: bool,
  access_level: text,
  favorite_count: num,
  card_token_count: num,
  lorebook_count: num,
  scenario_count: num,
  posted_at: time,
  updated_at: time,
});
const Search = z.object({ companions: z.array(Companion), total_count: num });

function toItem(c: z.infer<typeof Companion>): SourceItem {
  return {
    provider: 'saucepan',
    key: c.id,
    name: c.display_name || c.name || 'Companion',
    tagline: c.short_description,
    creator: c.author_handle,
    tags: (c.tags ?? []).map((t) => t.replace(/_/g, ' ')),
    avatarUrl: c.image?.id ? spImageUrl(c.image.id) : null,
    url: `${SITE}/companion/${c.id}`,
    nsfw: c.sus === true || c.very_sus === true,
    tokens: c.card_token_count,
    stars: c.favorite_count,
    updatedAt: c.updated_at ?? c.posted_at,
    hasLorebook: c.lorebook_count == null ? null : c.lorebook_count > 0,
    greetings: c.scenario_count == null ? null : Math.max(0, c.scenario_count - 1),
  };
}

export function spSearchResults(body: unknown, q: SourceQuery, perPage = SAUCEPAN_PER_PAGE): SitePage {
  const d = parseWith('Saucepan', Search, body);
  return { items: d.companions.filter((c) => c.id).map(toItem), hasMore: (d.total_count ?? 0) > Math.max(1, q.page) * perPage, total: d.total_count };
}

export function spSignInToken(body: unknown): string | null {
  const d = parseWith('Saucepan', z.object({ token: text, access_token: text }), body);
  return d.token || d.access_token || null;
}

const Scenario = z.object({ message: text, name: text, description: text }).partial();
const Definition = z.object({
  card: text,
  full_description: text,
  example_dialogue: text,
  formatting_instructions: text,
  advanced_prompt: text,
  starting_scenarios: z.array(z.union([Scenario, z.string()])).nullish(),
  starting_message: text,
});

/**
 * The definition endpoint (signed in). `listing` is the companion as search showed it, so the item
 * keeps its name, creator and picture. The response may wrap the definition (`definition`, `data`).
 */
export function spDetail(body: unknown, listing: SourceItem): SourceDetail | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as Record<string, unknown>).definition ?? (body as Record<string, unknown>).data ?? body;
  const d = parseWith('Saucepan', Definition, raw);
  const greetings = (d.starting_scenarios ?? []).map((s) => (typeof s === 'string' ? s : (s.message ?? ''))).filter(Boolean);
  if (!greetings.length && d.starting_message) greetings.push(d.starting_message);
  const hidden = !d.card.trim();
  const item: SourceItem = { ...listing, greetings: Math.max(0, greetings.length - 1) };
  const card = cardFrom({
    name: item.name,
    description: d.card,
    first_mes: greetings[0] ?? '',
    alternate_greetings: greetings.slice(1),
    mes_example: d.example_dialogue,
    system_prompt: d.advanced_prompt,
    post_history_instructions: d.formatting_instructions,
    creator_notes: d.full_description || item.tagline,
    tags: item.tags,
    creator: item.creator,
    extensions: { saucepan: { id: item.key }, ...(hidden ? { definition_hidden: true } : {}) },
  });
  return { ...item, card, hidden, version: String(item.updatedAt ?? ''), description: d.full_description || item.tagline };
}
