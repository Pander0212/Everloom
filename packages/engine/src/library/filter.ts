/**
 * Character library search: free text plus prefix filters, tri-state tags, and sorts.
 * Pure and fast (runs over thousands of summaries on a phone).
 *
 *   dark elf creator:john tag:fantasy -tag:nsfw tokens>1500 has:lorebook fav linked:no in:backlog
 */
import { createRng } from '../util/rng.js';

export interface LibraryItem {
  id: string;
  name: string;
  displayName?: string | null;
  tags: string[];
  creator: string;
  description: string;
  tokens: number;
  fav: boolean;
  createdAt: number;
  updatedAt: number;
  lastChatAt?: number | null;
  chatCount?: number;
  hasLorebook?: boolean;
  hasGallery?: boolean;
  hasGreetings?: boolean;
  linked?: string | null;
  collections?: string[];
  version?: string;
}

export type TagState = 'include' | 'exclude';

export interface ParsedQuery {
  text: string[];
  tags: { include: string[]; exclude: string[] };
  creator: string[];
  fav: boolean | null;
  linked: boolean | string | null;
  has: Array<{ what: 'lorebook' | 'gallery' | 'greetings' | 'chats'; value: boolean }>;
  tokens: Array<{ op: '>' | '<' | '>=' | '<=' | '='; n: number }>;
  collection: string[] | null;
  version: string | null;
  /** Unknown prefixes are kept as plain text, never silently dropped. */
  errors: string[];
}

const HAS = ['lorebook', 'gallery', 'greetings', 'chats'] as const;
const yes = (v: string) => !/^(no|false|0|none|n)$/i.test(v);

/** Split on spaces, keeping "quoted phrases" and key:"quoted values" together. */
function tokenize(q: string): string[] {
  const out: string[] = [];
  const re = /(-?[\w]+[:><=]+"[^"]*"|"[^"]*"|\S+)/g;
  for (const m of q.matchAll(re)) out.push(m[1].replace(/"/g, ''));
  return out;
}

/**
 * `extra` lets a caller accept more prefixes (online search adds sort:, lang:, time:); return true
 * when the key was handled.
 */
export function parseQuery(q: string, extra?: (key: string, value: string, neg: boolean) => boolean): ParsedQuery {
  const p: ParsedQuery = { text: [], tags: { include: [], exclude: [] }, creator: [], fav: null, linked: null, has: [], tokens: [], collection: null, version: null, errors: [] };
  for (const raw of tokenize(q.trim())) {
    const neg = raw.startsWith('-') && raw.length > 1;
    const t = neg ? raw.slice(1) : raw;
    const cmp = /^tokens?(>=|<=|>|<|=)(\d+)$/i.exec(t);
    if (cmp) {
      p.tokens.push({ op: cmp[1] as ParsedQuery['tokens'][number]['op'], n: Number(cmp[2]) });
      continue;
    }
    if (/^(fav|favs|favorite|favourite)$/i.test(t)) {
      p.fav = !neg;
      continue;
    }
    const kv = /^([a-z]+):(.*)$/i.exec(t);
    if (!kv || !kv[2]) {
      if (kv && !kv[2]) p.errors.push(`${kv[1]}: needs a value`);
      else p.text.push(t.toLowerCase());
      continue;
    }
    const [, key, value] = kv;
    if (extra?.(key.toLowerCase(), value, neg)) continue;
    switch (key.toLowerCase()) {
      case 'tag':
      case 'tags':
        (neg ? p.tags.exclude : p.tags.include).push(value.toLowerCase());
        break;
      case 'creator':
      case 'author':
      case 'by':
        p.creator.push(value.toLowerCase());
        break;
      case 'fav':
      case 'favorite':
      case 'favourite':
        p.fav = neg ? !yes(value) : yes(value);
        break;
      case 'linked':
        p.linked = /^(yes|no|true|false|any)$/i.test(value) ? (neg ? !yes(value) : yes(value)) : value.toLowerCase();
        break;
      case 'has':
        if ((HAS as readonly string[]).includes(value.toLowerCase())) p.has.push({ what: value.toLowerCase() as ParsedQuery['has'][number]['what'], value: !neg });
        else p.errors.push(`has:${value} is not a filter`);
        break;
      case 'no':
        if ((HAS as readonly string[]).includes(value.toLowerCase())) p.has.push({ what: value.toLowerCase() as ParsedQuery['has'][number]['what'], value: false });
        break;
      case 'in':
      case 'collection':
      case 'playlist':
        (p.collection ??= []).push(value.toLowerCase());
        break;
      case 'version':
        p.version = value.toLowerCase();
        break;
      default:
        p.errors.push(`${key}: is not a filter`);
        p.text.push(t.toLowerCase());
    }
  }
  return p;
}

export interface MatchOptions {
  /** Tri-state tag chips: include (must have all), exclude (must have none); absent = neutral. */
  tagStates?: Record<string, TagState>;
  /** Fields free text searches. */
  fields?: { name?: boolean; tags?: boolean; creator?: boolean; notes?: boolean };
  /** Collection names by id (for in:name). */
  collectionNames?: Record<string, string>;
}

function cmp(a: number, op: ParsedQuery['tokens'][number]['op'], b: number): boolean {
  return op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : op === '<=' ? a <= b : a === b;
}

export function matchItem(c: LibraryItem, p: ParsedQuery, opts: MatchOptions = {}): boolean {
  const tags = c.tags.map((t) => t.toLowerCase());
  for (const t of p.tags.include) if (!tags.includes(t)) return false;
  for (const t of p.tags.exclude) if (tags.includes(t)) return false;
  for (const [t, s] of Object.entries(opts.tagStates ?? {})) {
    const has = tags.includes(t.toLowerCase());
    if (s === 'include' && !has) return false;
    if (s === 'exclude' && has) return false;
  }
  const creator = c.creator.toLowerCase();
  for (const cr of p.creator) if (!creator.includes(cr)) return false;
  if (p.fav !== null && c.fav !== p.fav) return false;
  if (p.linked !== null) {
    if (typeof p.linked === 'boolean' && !!c.linked !== p.linked) return false;
    if (typeof p.linked === 'string' && !(c.linked ?? '').toLowerCase().startsWith(p.linked)) return false;
  }
  for (const h of p.has) {
    const v = h.what === 'lorebook' ? !!c.hasLorebook : h.what === 'gallery' ? !!c.hasGallery : h.what === 'greetings' ? !!c.hasGreetings : (c.chatCount ?? 0) > 0;
    if (v !== h.value) return false;
  }
  for (const t of p.tokens) if (!cmp(c.tokens, t.op, t.n)) return false;
  if (p.collection) {
    const names = (c.collections ?? []).map((id) => (opts.collectionNames?.[id] ?? id).toLowerCase());
    for (const want of p.collection) {
      if (want === 'none' ? names.length > 0 : want === 'any' ? names.length === 0 : !names.some((n) => n.includes(want))) return false;
    }
  }
  if (p.version !== null && (p.version === 'none' ? !!c.version : (c.version ?? '').toLowerCase() !== p.version)) return false;
  if (p.text.length) {
    const f = { name: true, tags: true, creator: true, notes: true, ...opts.fields };
    const hay = [f.name ? `${c.name} ${c.displayName ?? ''}` : '', f.tags ? tags.join(' ') : '', f.creator ? creator : '', f.notes ? c.description : ''].join('\n').toLowerCase();
    for (const w of p.text) if (!hay.includes(w)) return false;
  }
  return true;
}

export type LibrarySort = 'name' | 'modified' | 'created' | 'tokens' | 'recent' | 'random';

export function sortItems<T extends LibraryItem>(list: T[], sort: LibrarySort, opts: { desc?: boolean; seed?: number; favFirst?: boolean } = {}): T[] {
  const out = list.slice();
  const name = (x: T) => (x.displayName || x.name).toLowerCase();
  if (sort === 'random') {
    const rng = createRng(opts.seed ?? 1);
    const keyed = out.map((x) => ({ x, k: rng.next() }));
    keyed.sort((a, b) => a.k - b.k);
    return keyed.map((k) => k.x);
  }
  const by: Record<Exclude<LibrarySort, 'random'>, (a: T, b: T) => number> = {
    name: (a, b) => name(a).localeCompare(name(b)),
    modified: (a, b) => b.updatedAt - a.updatedAt,
    created: (a, b) => b.createdAt - a.createdAt,
    tokens: (a, b) => b.tokens - a.tokens,
    recent: (a, b) => (b.lastChatAt ?? b.updatedAt) - (a.lastChatAt ?? a.updatedAt),
  };
  out.sort((a, b) => (opts.favFirst ? Number(b.fav) - Number(a.fav) : 0) || (opts.desc ? -1 : 1) * by[sort](a, b) || a.id.localeCompare(b.id));
  return out;
}

/** Tag counts over a list, most used first (for the tag filter chips). */
export function tagCounts(list: Array<Pick<LibraryItem, 'tags'>>): Array<{ tag: string; count: number }> {
  const m = new Map<string, number>();
  for (const c of list) for (const t of new Set(c.tags.map((x) => x.toLowerCase()))) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Cycle a tag chip: neutral → include → exclude → neutral. */
export function nextTagState(cur: TagState | undefined): TagState | undefined {
  return cur === undefined ? 'include' : cur === 'include' ? 'exclude' : undefined;
}
