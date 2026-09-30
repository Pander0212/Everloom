/**
 * Recall: choosing which memories this scene deserves. Pure and deterministic given its inputs.
 *
 * A hybrid score per memory:
 *  - lexical   BM25 rank from SQLite FTS5 against the recent conversation (0..1)
 *  - semantic  cosine similarity from embeddings, when available (0..1)
 *  - entities  how much the memory is ABOUT the people standing here (coverage × intimacy)
 *  - place     it happened where the player is now, or at a place named in the recent text
 *  - named     someone it's about was named in the recent text
 *  - importance, recency, pinned
 *
 * Scoping comes first: a character's candidates are only what THEY can know (witnessed or heard).
 * Every person present gets at least one relevant memory when they know any. Near-identical
 * memories are collapsed before injection. Each result carries its score breakdown so the UI can
 * answer "why was this recalled?".
 */
import { HeardIndex, knowledgeOf, type KnowledgeResult } from './knowledge.js';
import { PLAYER, type MemoryItem } from './types.js';

export interface RecallWeights {
  lexical: number;
  semantic: number;
  entities: number;
  place: number;
  named: number;
  importance: number;
  recency: number;
  pinned: number;
}

// Tuned on tests/memory-bench: what the conversation is about (lexical, semantic, names) must be
// able to outrank "someone here was involved", or every scene recalls the same few memories.
export const DEFAULT_RECALL_WEIGHTS: RecallWeights = Object.freeze({
  lexical: 8,
  semantic: 5,
  entities: 2.5,
  place: 3,
  named: 2.5,
  importance: 1.5,
  recency: 1.5,
  pinned: 3,
});

export interface RecallContext {
  /** Game minutes now. */
  now: number;
  /** Everyone in the scene, including the player. */
  present: string[];
  locationId: string | null;
  /** memoryId → 0..1 from full-text search. */
  lexical?: Map<string, number>;
  /** memoryId → 0..1 from embeddings. */
  semantic?: Map<string, number>;
  /** People named in the recent conversation. */
  named?: Set<string>;
  /** Places named in the recent conversation (location ids). */
  namedPlaces?: Set<string>;
  /** Game minutes for recency to halve (default 3 days). */
  halfLife?: number;
}

export interface ScoreBreakdown {
  total: number;
  lexical: number;
  semantic: number;
  entities: number;
  place: number;
  named: number;
  importance: number;
  recency: number;
  pinned: number;
}

/** How much a memory is about the people present (0..1). Crowds say little about anyone. */
export function specificity(cast: string[], present: Set<string>): number {
  const people = [...new Set(cast)].filter((id) => id !== PLAYER);
  if (!people.length) return 0;
  let here = 0;
  for (const id of people) if (present.has(id)) here++;
  if (!here) return 0;
  const coverage = here / people.length;
  const intimacy = 1 / Math.max(1, Math.log2(people.length + 1));
  return coverage * intimacy;
}

export function scoreMemory(m: MemoryItem, ctx: RecallContext, w: RecallWeights = DEFAULT_RECALL_WEIGHTS): ScoreBreakdown {
  const present = new Set(ctx.present);
  const cast = m.participants.length ? m.participants : m.witnesses;
  const lexical = ctx.lexical?.get(m.id) ?? 0;
  const semantic = Math.max(0, ctx.semantic?.get(m.id) ?? 0);
  const entities = specificity(cast, present);
  const place = m.locationId && ctx.namedPlaces?.has(m.locationId) ? 1 : m.locationId && m.locationId === ctx.locationId ? 0.3 : 0;
  const named = ctx.named && cast.some((id) => id !== PLAYER && ctx.named!.has(id)) ? 1 : 0;
  const importance = (m.importance - 1) / 2;
  const half = ctx.halfLife ?? 3 * 1440;
  const age = Math.max(0, ctx.now - m.gameTime);
  const recency = Math.pow(0.5, age / half);
  const pinned = m.pinned ? 1 : 0;
  const parts = {
    lexical: lexical * w.lexical,
    semantic: semantic * w.semantic,
    entities: entities * w.entities,
    place: place * w.place,
    named: named * w.named,
    importance: importance * w.importance,
    recency: recency * w.recency,
    pinned: pinned * w.pinned,
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { total: Math.round(total * 1000) / 1000, ...roundAll(parts) };
}

function roundAll<T extends Record<string, number>>(o: T): T {
  const out = {} as Record<string, number>;
  for (const [k, v] of Object.entries(o)) out[k] = Math.round(v * 1000) / 1000;
  return out as T;
}

/** A memory is "relevant" only if something ties it to this scene — not just being recent. */
export function isRelevant(s: ScoreBreakdown): boolean {
  return s.lexical > 0 || s.semantic > 0.3 * DEFAULT_RECALL_WEIGHTS.semantic || s.entities > 0 || s.named > 0 || s.pinned > 0 || s.place >= DEFAULT_RECALL_WEIGHTS.place || s.importance >= DEFAULT_RECALL_WEIGHTS.importance;
}

const STOP = new Set('the and for with that this was were had has have his her him she they them their you your from into onto about over under then than when what which who whom whose where while after before again also just very more most some any each other such only own same not but are its it’s it\'s one two there here said says told asked'.split(' '));

export function contentWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w)));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface Recalled {
  m: MemoryItem;
  k: KnowledgeResult;
  score: ScoreBreakdown;
}

/** Drop near-duplicates (keep the higher-scored one). Input must be sorted best first. */
export function dedupe(list: Recalled[], threshold = 0.6): Recalled[] {
  const kept: Array<{ r: Recalled; words: Set<string> }> = [];
  for (const r of list) {
    const words = contentWords(r.m.text);
    if (kept.some((k) => jaccard(k.words, words) >= threshold)) continue;
    kept.push({ r, words });
  }
  return kept.map((k) => k.r);
}

export interface RecallOptions {
  weights?: RecallWeights;
  /** Memories for the player's STORY SO FAR. */
  playerLimit?: number;
  /** Memories shown per other person present. */
  perPersonLimit?: number;
  /** "Does not know" lines per person. */
  unknownLimit?: number;
  /** Only this many other people get per-person lines (most relevant first). */
  peopleLimit?: number;
  dedupeThreshold?: number;
}

export interface PersonRecall {
  id: string;
  knows: Recalled[];
  heard: Recalled[];
  doesNotKnow: Recalled[];
}

export interface RecallResult {
  player: Recalled[];
  people: PersonRecall[];
}

function rank(viewer: string, memories: MemoryItem[], heard: HeardIndex, ctx: RecallContext, w: RecallWeights): Recalled[] {
  const out: Recalled[] = [];
  for (const m of memories) {
    const k = knowledgeOf(viewer, m, heard);
    if (!k) continue;
    const score = scoreMemory(m, ctx, w);
    // Hearsay is worth less than having been there, and garbled rumors less again.
    if (k.kind === 'heard') score.total = Math.round(score.total * Math.pow(0.8, k.distortion) * 1000) / 1000;
    out.push({ m, k, score });
  }
  return out.sort((a, b) => b.score.total - a.score.total || b.m.seq - a.m.seq);
}

export function recall(memories: MemoryItem[], heard: HeardIndex, ctx: RecallContext, opts: RecallOptions = {}): RecallResult {
  const w = opts.weights ?? DEFAULT_RECALL_WEIGHTS;
  const threshold = opts.dedupeThreshold ?? 0.6;
  const playerRanked = rank(PLAYER, memories, heard, ctx, w);
  const player = dedupe(
    playerRanked.filter((r) => isRelevant(r.score)),
    threshold,
  ).slice(0, opts.playerLimit ?? 8);

  const others = [...new Set(ctx.present)].filter((id) => id !== PLAYER);
  const people: PersonRecall[] = others.map((id) => {
    const ranked = rank(id, memories, heard, ctx, w);
    const relevant = ranked.filter((r) => isRelevant(r.score));
    // Guarantee: at least one memory per person who knows anything — prefer one ABOUT them.
    // Someone spoken to or about gets more room.
    let pick = dedupe(relevant, threshold).slice(0, (opts.perPersonLimit ?? 2) + (ctx.named?.has(id) ? 2 : 0));
    if (!pick.length && ranked.length) pick = [ranked.find((r) => r.m.participants.includes(id)) ?? ranked[0]];
    const known = new Set(ranked.map((r) => r.m.id));
    const doesNotKnow = player
      .filter((r) => !known.has(r.m.id))
      .filter((r) => r.m.participants.some((p) => p === id || (p !== PLAYER && ctx.present.includes(p))) || r.score.lexical > 0 || r.score.semantic > 0)
      .slice(0, opts.unknownLimit ?? 2);
    return {
      id,
      knows: pick.filter((r) => r.k.kind === 'witnessed'),
      heard: pick.filter((r) => r.k.kind === 'heard'),
      doesNotKnow,
    };
  });
  // Most relevant people first; cap how many get lines.
  const weight = (p: PersonRecall) => (ctx.named?.has(p.id) ? 10 : 0) + p.knows.length + p.heard.length + p.doesNotKnow.length;
  people.sort((a, b) => weight(b) - weight(a) || a.id.localeCompare(b.id));
  return { player, people: people.slice(0, opts.peopleLimit ?? 6) };
}
