/**
 * Shared pieces for the per-site modules. Each site is one small file: how to ask (URLs and bodies
 * from a SourceQuery) and how to read the answer (tolerant zod schemas). A site that changes its
 * responses gets a clear "this site changed" error, never a crash.
 */
import { z } from 'zod';
import { emptyCardData, type CardData } from '../../cards/card.js';
import { worldFromSillyTavern, worldToCharacterBook } from '../../lore/convert.js';
import type { SourceFilter, SourceQuery, SourceSort } from '../source-query.js';
import type { SourceDetail, SourceItem } from '../sources.js';

export class SiteChanged extends Error {
  constructor(
    readonly site: string,
    detail: string,
  ) {
    super(`${site} answered in a shape Everloom doesn't recognise (${detail}). The site may have changed: record fixtures in Settings › Character sources › Diagnostics and send them in.`);
    this.name = 'SiteChanged';
  }
}

/** Parse with a schema; unknown fields are ignored, a missing required one is a SiteChanged. */
export function parseWith<T>(site: string, schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (r.success) return r.data;
  const i = r.error.issues[0]!;
  throw new SiteChanged(site, `${i.path.join('.') || 'response'}: ${i.message}`);
}

/** A string that may be missing, null or a number on the site's side. */
export const text = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => (v == null ? '' : String(v)));
export const num = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v)));
export const bool = z.union([z.boolean(), z.null(), z.string(), z.number()]).optional().transform((v) => (v == null ? null : v === true || v === 'true' || v === 1 || v === '1'));
export const time = z.union([z.string(), z.number(), z.null()]).optional().transform((v) => {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v).replace(/ \+00:00:00$/, 'Z'));
  return Number.isFinite(t) ? t : null;
});

/** What a site can do: shown to the UI and used to decide what's filtered on the page. */
export interface SiteSpec {
  id: string;
  name: string;
  site: string;
  /** Filters the site applies on its side. */
  onSite: SourceFilter[];
  sorts: SourceSort[];
  /** Hosts its pictures come from (the image proxy fetches nothing else). */
  imageHosts: string[];
}

export interface SitePage {
  items: SourceItem[];
  hasMore: boolean;
  total?: number | null;
}

export const strip = (h: string) =>
  h
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

/** A card from loose fields; anything missing stays empty. */
export function cardFrom(f: Partial<Omit<CardData, 'character_book'>> & { name: string; character_book?: unknown }): CardData & { character_book?: unknown } {
  const base = emptyCardData();
  const out: CardData & { character_book?: unknown } = { ...base, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== null)) } as CardData;
  out.tags = Array.isArray(f.tags) ? f.tags.map(String).slice(0, 60) : [];
  out.alternate_greetings = Array.isArray(f.alternate_greetings) ? f.alternate_greetings.map(String).filter(Boolean) : [];
  return out;
}

/**
 * A lorebook as sites ship it: a character book (`entries[]` with `keys`), or SillyTavern world info
 * (`entries` keyed by uid, each with `key`). Null when there is nothing in it.
 */
export function toCharacterBook(raw: unknown, name = 'Lorebook'): unknown {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== 'object') return null;
  const entries = (v as { entries?: unknown }).entries;
  const list = Array.isArray(entries) ? entries : entries && typeof entries === 'object' ? Object.values(entries) : [];
  if (!list.length) return null;
  if (list.every((e) => e && typeof e === 'object' && Array.isArray((e as { keys?: unknown }).keys))) return Array.isArray(entries) ? v : { ...(v as object), entries: list };
  try {
    return worldToCharacterBook(worldFromSillyTavern({ ...(v as object), entries: Object.fromEntries(list.map((e, i) => [String((e as { uid?: unknown }).uid ?? i), e])) }, name));
  } catch {
    return null;
  }
}

export function detail(item: SourceItem, rest: { card: SourceDetail['card']; hidden: boolean; version: string; description: string }): SourceDetail {
  return { ...item, ...rest };
}

export const pageOf = (q: SourceQuery) => Math.max(1, q.page);

// ------------------------------------------------------------------ SvelteKit page data

/**
 * Decode a SvelteKit `__data.json` response (devalue format, possibly streamed as several lines):
 * the last data node, with streamed promises (`["Promise", id]`) replaced by their chunk's value.
 */
export function decodeSvelteKit(raw: string | unknown): any {
  const lines: any[] = typeof raw === 'string' ? raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : Array.isArray(raw) ? raw : [raw];
  const head = lines.find((l) => l?.type === 'data');
  const chunks = new Map<number, unknown[]>();
  for (const l of lines) if (l?.type === 'chunk' && Array.isArray(l.data)) chunks.set(Number(l.id), l.data);
  const decode = (d: unknown[], depth = 0): unknown => {
    if (!Array.isArray(d) || !d.length || depth > 4) return null;
    const seen = new Map<number, unknown>();
    const at = (i: unknown, lvl = 0): unknown => {
      if (typeof i !== 'number' || i < 0 || i >= d.length || lvl > 40) return null;
      if (seen.has(i)) return seen.get(i);
      const v = d[i];
      let out: unknown = v;
      if (Array.isArray(v)) {
        if (v[0] === 'Promise' && typeof v[1] === 'number') out = chunks.has(v[1]) ? decode(chunks.get(v[1])!, depth + 1) : null;
        else if (v[0] === 'Date' && typeof v[1] === 'string') out = v[1];
        else if ((v[0] === 'Set' || v[0] === 'Map') && typeof v[0] === 'string') out = v.slice(1).map((x) => at(x, lvl + 1));
        else {
          const arr: unknown[] = [];
          seen.set(i, arr);
          for (const x of v) arr.push(at(x, lvl + 1));
          out = arr;
        }
      } else if (v && typeof v === 'object') {
        const obj: Record<string, unknown> = {};
        seen.set(i, obj);
        for (const [k, x] of Object.entries(v)) obj[k] = at(x, lvl + 1);
        out = obj;
      }
      seen.set(i, out);
      return out;
    };
    return at(0);
  };
  const node = (Array.isArray(head?.nodes) ? head.nodes : []).filter((n: any) => n?.type === 'data').at(-1);
  return node ? decode(node.data) : null;
}
