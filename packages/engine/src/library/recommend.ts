/**
 * "What should I play tonight?" The library can be thousands of cards, so the model sees a sample:
 * a mix of favorites, ones not played in a while, never-played ones and random picks, filtered by
 * the mood words when they match. Short numeric handles keep the prompt small and stop invented ids.
 */
import { extractJson } from '../util/json-extract.js';

export interface RecommendItem {
  id: string;
  name: string;
  tags: string[];
  description: string;
  fav: boolean;
  chatCount: number;
  lastChatAt: number | null;
}

/** Small seeded PRNG so a given seed always samples the same way (tests, and "show me others"). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []);

export function sampleForRecommend(items: RecommendItem[], opts: { mood?: string; size?: number; seed?: number; exclude?: string[]; now?: number } = {}): RecommendItem[] {
  const size = opts.size ?? 30;
  const rand = rng(opts.seed ?? 1);
  const now = opts.now ?? Date.now();
  const excluded = new Set(opts.exclude ?? []);
  const pool = items.filter((i) => !excluded.has(i.id));
  if (pool.length <= size) return pool;
  const mood = words(opts.mood ?? '');
  const picked = new Map<string, RecommendItem>();
  const take = (list: RecommendItem[], n: number) => {
    for (const i of list) {
      if (picked.size >= size || n <= 0) break;
      if (!picked.has(i.id)) {
        picked.set(i.id, i);
        n--;
      }
    }
  };
  const shuffled = (list: RecommendItem[]) => list.map((i) => [rand(), i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  // Mood matches first: tags and description words that the request mentions.
  if (mood.size) {
    const scored = pool
      .map((i) => {
        const w = words(`${i.tags.join(' ')} ${i.description} ${i.name}`);
        let s = 0;
        for (const m of mood) if (w.has(m) || [...w].some((x) => x.startsWith(m) && m.length >= 4)) s++;
        return [s, i] as const;
      })
      .filter(([s]) => s > 0)
      .sort((a, b) => b[0] - a[0]);
    take(scored.map(([, i]) => i), Math.ceil(size / 2));
  }
  const month = 30 * 86400_000;
  take(shuffled(pool.filter((i) => i.fav)), Math.ceil(size / 6));
  take(shuffled(pool.filter((i) => i.lastChatAt && now - i.lastChatAt > month)), Math.ceil(size / 6));
  take(shuffled(pool.filter((i) => !i.chatCount)), Math.ceil(size / 6));
  take(shuffled(pool), size);
  return [...picked.values()];
}

function ago(ts: number | null, now: number) {
  if (!ts) return 'never played';
  const d = Math.floor((now - ts) / 86400_000);
  return d < 1 ? 'played today' : d < 60 ? `last played ${d}d ago` : `last played ${Math.round(d / 30)}mo ago`;
}

export function buildRecommendPrompt(mood: string, sample: RecommendItem[], now = Date.now()): Array<{ role: 'system' | 'user'; content: string }> {
  const list = sample.map((i, n) => `#${n + 1} ${i.name}${i.fav ? ' ★' : ''} [${i.tags.slice(0, 6).join(', ')}] (${ago(i.lastChatAt, now)}): ${i.description.replace(/\s+/g, ' ').slice(0, 220)}`).join('\n');
  return [
    {
      role: 'system',
      content: `You recommend which roleplay character to play next, from the person's own library. Pick the 3 that best fit what they're in the mood for; if they gave no mood, pick a varied three (something familiar, something forgotten, something new). Use only characters from the list, by their number.
Reply with JSON only: {"picks": [{"n": 1, "why": "one friendly sentence on why it fits tonight"}]}`,
    },
    { role: 'user', content: `Mood: ${mood.trim() || '(none given)'}\n\nLibrary sample:\n${list}` },
  ];
}

export function parseRecommend(text: string, sample: RecommendItem[]): Array<{ id: string; why: string }> {
  const j = extractJson<{ picks?: Array<{ n?: unknown; id?: unknown; why?: unknown }> }>(text);
  if (!j.ok || !Array.isArray(j.value?.picks)) throw new Error('The model did not return any picks');
  const out: Array<{ id: string; why: string }> = [];
  for (const p of j.value.picks) {
    const n = Number(typeof p.n === 'string' ? p.n.replace('#', '') : p.n);
    const item = Number.isInteger(n) ? sample[n - 1] : sample.find((i) => i.id === p.id);
    if (!item || out.some((o) => o.id === item.id)) continue;
    out.push({ id: item.id, why: String(p.why ?? '').trim().slice(0, 300) });
    if (out.length === 3) break;
  }
  if (!out.length) throw new Error('The model picked characters that are not in your library');
  return out;
}
