/**
 * Online character sources: the shapes every provider returns, and the mapping for Chub's public
 * API. Mapping is kept here (pure) so it can be tested against recorded responses.
 *
 * A card whose creator hid its definition is reported as hidden: only its public parts are imported,
 * labelled "definition hidden by creator". Nothing here tries to get around that.
 */
import { emptyCardData, type CardData } from '../cards/card.js';

export interface SourceItem {
  provider: string;
  /** Provider-scoped id, stable across updates (Chub: "creator/slug"). */
  key: string;
  name: string;
  tagline: string;
  creator: string;
  tags: string[];
  avatarUrl: string | null;
  url: string;
  nsfw: boolean;
  tokens: number | null;
  stars: number | null;
  /** When the card last changed at the source (ms). */
  updatedAt: number | null;
  /** Alternate greetings, when the listing says (null: unknown). */
  greetings?: number | null;
  hasLorebook?: boolean | null;
  language?: string | null;
}

export interface SourceDetail extends SourceItem {
  /** The card to import. When the creator hid the definition, only the public parts (hidden = true). */
  card: (CardData & { character_book?: unknown }) | null;
  hidden: boolean;
  /** Changes whenever the card changes at the source; compared by the update check. */
  version: string;
  description: string;
}

export interface SourceSearch {
  query: string;
  page: number;
  sort: 'popular' | 'new' | 'updated' | 'stars';
  nsfw: boolean;
  tags?: string[];
}

// ------------------------------------------------------------------ Chub

export const CHUB = {
  id: 'chub',
  name: 'Chub',
  site: 'https://chub.ai',
  api: 'https://api.chub.ai',
  avatars: 'https://avatars.charhub.io',
} as const;

const SORT: Record<SourceSearch['sort'], string> = { popular: 'download_count', new: 'created_at', updated: 'last_activity_at', stars: 'star_count' };

export function chubSearchUrl(q: SourceSearch, perPage = 24): string {
  const p = new URLSearchParams({
    search: q.query.trim(),
    first: String(perPage),
    page: String(Math.max(1, q.page)),
    sort: SORT[q.sort] ?? 'download_count',
    asc: 'false',
    nsfw: q.nsfw ? 'true' : 'false',
    nsfl: 'false',
    namespace: 'characters',
    include_forks: 'true',
  });
  if (q.tags?.length) p.set('topics', q.tags.join(','));
  return `${CHUB.api}/search?${p}`;
}

export const chubDetailUrl = (key: string) => `${CHUB.api}/api/characters/${key.split('/').map(encodeURIComponent).join('/')}?full=true`;

/** "creator/slug" from a chub.ai / characterhub.org link, or null. */
export function chubKeyFromLink(link: string): string | null {
  const m = /(?:^|\/\/)(?:www\.)?(?:chub\.ai|characterhub\.org|venus\.chub\.ai)\/characters\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.%-]+)/i.exec(link);
  if (!m) return null;
  return `${m[1]}/${decodeURIComponent(m[2]!).replace(/[?#].*$/, '')}`;
}

const time = (v: unknown) => {
  const t = typeof v === 'number' ? v : Date.parse(String(v ?? ''));
  return Number.isFinite(t) && t > 0 ? t : null;
};
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function chubItem(node: any): SourceItem | null {
  const key = String(node?.fullPath ?? '').trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(key)) return null;
  const tags = (Array.isArray(node.topics) ? node.topics : []).map((t: unknown) => String(t)).filter(Boolean);
  return {
    provider: CHUB.id,
    key,
    name: String(node.name ?? key.split('/')[1]).trim(),
    tagline: String(node.tagline ?? '').trim(),
    creator: key.split('/')[0]!,
    tags,
    avatarUrl: typeof node.max_res_url === 'string' ? node.max_res_url : typeof node.avatar_url === 'string' ? node.avatar_url : `${CHUB.avatars}/avatars/${key}/avatar.webp`,
    url: `${CHUB.site}/characters/${key}`,
    nsfw: node.nsfw_image === true || tags.some((t: string) => /^nsfw$/i.test(t)),
    tokens: num(node.nTokens),
    stars: num(node.starCount),
    updatedAt: time(node.lastActivityAt ?? node.updatedAt),
  };
}

export function chubSearchResults(body: any): { items: SourceItem[]; total: number | null } {
  const nodes = body?.data?.nodes ?? body?.nodes ?? [];
  return { items: (Array.isArray(nodes) ? nodes : []).map(chubItem).filter((x): x is SourceItem => !!x), total: num(body?.data?.count ?? body?.count) };
}

/** Chub's field names differ from the card spec: its "personality" is the card description, and its "description" is the creator's notes. */
export function chubDetail(body: any): SourceDetail | null {
  const node = body?.node ?? body?.metadata?.node ?? body;
  const item = chubItem(node);
  if (!item) return null;
  const d = node.definition;
  const hidden = !d || node.hidden === true || node.definition_hidden === true || (!d.personality && !d.first_message && !d.description && !d.scenario);
  // A hidden definition: keep only what the creator shows publicly, and say so.
  let card: SourceDetail['card'] = { ...emptyCardData(item.name), creator_notes: String(node.description ?? node.tagline ?? ''), tags: item.tags.filter((t) => !/^(nsfw|sfw)$/i.test(t)).slice(0, 30), creator: item.creator, extensions: { chub: { full_path: item.key, id: node.id ?? null }, definition_hidden: true } };
  if (!hidden) {
    card = {
      ...emptyCardData(String(d.name ?? item.name)),
      description: String(d.personality ?? ''),
      personality: String(d.tavern_personality ?? ''),
      scenario: String(d.scenario ?? ''),
      first_mes: String(d.first_message ?? ''),
      mes_example: String(d.example_dialogs ?? ''),
      creator_notes: String(d.description ?? node.description ?? ''),
      system_prompt: String(d.system_prompt ?? ''),
      post_history_instructions: String(d.post_history_instructions ?? ''),
      alternate_greetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings.map(String) : [],
      tags: item.tags.filter((t) => !/^(nsfw|sfw)$/i.test(t)).slice(0, 30),
      creator: item.creator,
      character_version: String(node.lastActivityAt ?? ''),
      extensions: { ...(d.extensions && typeof d.extensions === 'object' ? d.extensions : {}), chub: { full_path: item.key, id: node.id ?? null } },
    };
    if (d.embedded_lorebook && typeof d.embedded_lorebook === 'object' && Array.isArray(d.embedded_lorebook.entries) && d.embedded_lorebook.entries.length) card.character_book = d.embedded_lorebook;
  }
  return { ...item, card, hidden, version: String(node.lastActivityAt ?? node.id ?? ''), description: String(d?.description ?? node.description ?? node.tagline ?? '') };
}
