/**
 * Card comparison for the library: field-level diffs with a word diff for long text, content
 * hashes, duplicate detection and "related" scoring. Pure.
 */
import type { CardData } from '../cards/card.js';
import { hashString } from '../util/rng.js';
import { contentWords, jaccard } from '../memory/recall.js';

/** The fields a person edits, in display order, with labels. */
export const CARD_FIELDS: Array<{ key: keyof CardData; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'personality', label: 'Personality' },
  { key: 'scenario', label: 'Scenario' },
  { key: 'first_mes', label: 'First message' },
  { key: 'alternate_greetings', label: 'Alternate greetings' },
  { key: 'mes_example', label: 'Example messages' },
  { key: 'system_prompt', label: 'System prompt' },
  { key: 'post_history_instructions', label: 'Post-history instructions' },
  { key: 'creator_notes', label: 'Creator notes' },
  { key: 'creator', label: 'Creator' },
  { key: 'character_version', label: 'Version' },
  { key: 'tags', label: 'Tags' },
];

export interface WordOp {
  op: 'same' | 'add' | 'del';
  text: string;
}

export interface FieldDiff {
  key: string;
  label: string;
  before: string;
  after: string;
  /** Word-level diff (for text); empty for lists. */
  words: WordOp[];
}

const asText = (v: unknown): string => (Array.isArray(v) ? v.map(String).join('\n') : v == null ? '' : String(v));

/** Word diff by longest common subsequence over tokens (words and the spaces between them). */
export function wordDiff(a: string, b: string): WordOp[] {
  const A = a.match(/\s+|[^\s]+/g) ?? [];
  const B = b.match(/\s+|[^\s]+/g) ?? [];
  // Keep it fast on long fields: fall back to a whole-field replace past ~4M cells.
  if (A.length * B.length > 4_000_000) return [...(a ? [{ op: 'del' as const, text: a }] : []), ...(b ? [{ op: 'add' as const, text: b }] : [])];
  const n = A.length;
  const m = B.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: WordOp[] = [];
  const push = (op: WordOp['op'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push('same', A[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', A[i++]);
    else push('add', B[j++]);
  }
  while (i < n) push('del', A[i++]);
  while (j < m) push('add', B[j++]);
  return out;
}

export function diffCards(before: Partial<CardData>, after: Partial<CardData>): FieldDiff[] {
  const out: FieldDiff[] = [];
  for (const f of CARD_FIELDS) {
    const a = asText(before[f.key]);
    const b = asText(after[f.key]);
    if (a === b) continue;
    out.push({ key: String(f.key), label: f.label, before: a, after: b, words: Array.isArray(before[f.key]) || Array.isArray(after[f.key]) ? [] : wordDiff(a, b) });
  }
  return out;
}

/** Hash of what makes a character this character (not tags, notes or version). */
export function cardHash(c: Partial<CardData>): string {
  const norm = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return hashString([c.name, c.description, c.personality, c.scenario, c.first_mes, c.mes_example].map(norm).join('␟')).toString(36);
}

function nameKey(n: string): string {
  return n
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(v\d+(\.\d+)*|copy|new|final|edit(ed)?)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Similarity of two names, 0..1 (bigram Dice on the normalized name). */
export function nameSimilarity(a: string, b: string): number {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s: string) => {
    const g = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) g.set(s.slice(i, i + 2), (g.get(s.slice(i, i + 2)) ?? 0) + 1);
    return g;
  };
  const gx = grams(x);
  const gy = grams(y);
  let inter = 0;
  for (const [k, v] of gx) inter += Math.min(v, gy.get(k) ?? 0);
  return (2 * inter) / Math.max(1, x.length - 1 + y.length - 1);
}

export interface DupeCandidate {
  id: string;
  name: string;
  creator: string;
  hash: string;
  description: string;
  updatedAt: number;
}

export interface DupeGroup {
  ids: string[];
  reason: 'identical' | 'same name and creator' | 'similar';
  score: number;
}

/**
 * Groups of likely duplicates: identical content, the same name by the same creator, or a very
 * similar name with a similar description. Newest first inside a group.
 */
export function findDuplicates(list: DupeCandidate[]): DupeGroup[] {
  const groups: DupeGroup[] = [];
  const used = new Set<string>();
  const byHash = new Map<string, DupeCandidate[]>();
  for (const c of list) (byHash.get(c.hash) ?? byHash.set(c.hash, []).get(c.hash)!).push(c);
  for (const g of byHash.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => b.updatedAt - a.updatedAt);
    groups.push({ ids: g.map((c) => c.id), reason: 'identical', score: 1 });
    for (const c of g) used.add(c.id);
  }
  // Pairs by blocking on the first letters of the name, to stay fast on thousands.
  const blocks = new Map<string, DupeCandidate[]>();
  for (const c of list) if (!used.has(c.id)) {
    const k = nameKey(c.name).slice(0, 2);
    (blocks.get(k) ?? blocks.set(k, []).get(k)!).push(c);
  }
  for (const block of blocks.values()) {
    const words = new Map(block.map((c) => [c.id, contentWords(c.description)]));
    for (let i = 0; i < block.length; i++) {
      const a = block[i];
      if (used.has(a.id)) continue;
      const members = [a];
      let reason: DupeGroup['reason'] = 'similar';
      let best = 0;
      for (let j = i + 1; j < block.length; j++) {
        const b = block[j];
        if (used.has(b.id)) continue;
        const ns = nameSimilarity(a.name, b.name);
        if (ns < 0.8) continue;
        const sameCreator = !!a.creator && a.creator.toLowerCase() === b.creator.toLowerCase();
        const ds = jaccard(words.get(a.id)!, words.get(b.id)!);
        if ((ns === 1 && sameCreator) || ds >= 0.5) {
          members.push(b);
          if (ns === 1 && sameCreator) reason = 'same name and creator';
          best = Math.max(best, (ns + ds) / 2);
        }
      }
      if (members.length > 1) {
        members.sort((x, y) => y.updatedAt - x.updatedAt);
        groups.push({ ids: members.map((m) => m.id), reason, score: Math.round(best * 100) / 100 });
        for (const m of members) used.add(m.id);
      }
    }
  }
  return groups;
}

export interface RelatedCandidate {
  id: string;
  name: string;
  tags: string[];
  creator: string;
  description: string;
}

/**
 * Related characters, deterministic: shared tags (rarer tags count more), same creator, and
 * words in common. Returns the best matches with the reasons.
 */
export function relatedTo(target: RelatedCandidate, all: RelatedCandidate[], limit = 12): Array<{ id: string; score: number; reasons: string[] }> {
  const df = new Map<string, number>();
  for (const c of all) for (const t of new Set(c.tags.map((x) => x.toLowerCase()))) df.set(t, (df.get(t) ?? 0) + 1);
  const n = Math.max(1, all.length);
  const tTags = new Set(target.tags.map((x) => x.toLowerCase()));
  const tWords = contentWords(`${target.description}`);
  const out: Array<{ id: string; score: number; reasons: string[] }> = [];
  for (const c of all) {
    if (c.id === target.id) continue;
    const reasons: string[] = [];
    let score = 0;
    const shared = c.tags.map((x) => x.toLowerCase()).filter((t) => tTags.has(t));
    if (shared.length) {
      score += shared.reduce((s, t) => s + Math.log(1 + n / (df.get(t) ?? 1)), 0);
      reasons.push(`tags: ${shared.slice(0, 3).join(', ')}`);
    }
    if (target.creator && c.creator && target.creator.toLowerCase() === c.creator.toLowerCase()) {
      score += 3;
      reasons.push(`same creator`);
    }
    const w = jaccard(tWords, contentWords(c.description));
    if (w >= 0.08) {
      score += w * 12;
      reasons.push('similar description');
    }
    if (score > 0) out.push({ id: c.id, score: Math.round(score * 100) / 100, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
