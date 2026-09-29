/** Resolve free-text names from the AI to existing entities (fuzzy, dedupe-aware). */
import { nameMatchScore, normalizeName, slugify } from '../util/text.js';
import type { CampaignState, Npc } from './state.js';

export interface Named {
  id: string;
  name: string;
  aliases?: string[];
}

/** Very small singularizer for item matching ("apples" = "apple"). */
function singular(word: string): string {
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('es') && /(ch|sh|x|s)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

export function itemKey(name: string): string {
  return normalizeName(name)
    .split(' ')
    .map(singular)
    .filter((w) => !['a', 'an', 'the', 'some', 'of'].includes(w))
    .join(' ');
}

export function findExact<T extends Named>(items: Record<string, T>, nameOrId: string): T | undefined {
  if (items[nameOrId]) return items[nameOrId];
  const n = normalizeName(nameOrId);
  for (const it of Object.values(items)) {
    if (normalizeName(it.name) === n) return it;
    if (it.aliases?.some((a) => normalizeName(a) === n)) return it;
  }
  return undefined;
}

export function findItem<T extends Named>(items: Record<string, T>, nameOrId: string): T | undefined {
  const exact = findExact(items, nameOrId);
  if (exact) return exact;
  const key = itemKey(nameOrId);
  return Object.values(items).find((it) => itemKey(it.name) === key);
}

/** Fuzzy lookup for titles/places: exact → normalized → containment when unique. */
export function findFuzzy<T extends Named>(items: Record<string, T>, nameOrId: string): T | undefined {
  const exact = findExact(items, nameOrId);
  if (exact) return exact;
  const n = normalizeName(nameOrId).replace(/^the /, '');
  if (!n) return undefined;
  const all = Object.values(items);
  const stripped = all.filter((it) => normalizeName(it.name).replace(/^the /, '') === n);
  if (stripped.length === 1) return stripped[0];
  const contains = all.filter((it) => {
    const m = normalizeName(it.name).replace(/^the /, '');
    return m.length >= 4 && n.length >= 4 && (m.includes(n) || n.includes(m));
  });
  return contains.length === 1 ? contains[0] : undefined;
}

export interface NpcMatch {
  npc: Npc;
  score: number;
}

/**
 * Find an NPC by name with dedupe semantics:
 * "Tobias" matches "Tobias Moreno" when unambiguous; "Tobias Moreno" matches an existing "Tobias".
 */
export function findNpc(state: Pick<CampaignState, 'npcs'>, nameOrId: string, threshold = 0.74): NpcMatch | undefined {
  if (state.npcs[nameOrId]) return { npc: state.npcs[nameOrId], score: 1 };
  let best: NpcMatch | undefined;
  let tie = false;
  for (const npc of Object.values(state.npcs)) {
    const names = [npc.name, ...(npc.aliases ?? [])];
    const score = Math.max(...names.map((n) => nameMatchScore(n, nameOrId)));
    if (score < threshold) continue;
    if (!best || score > best.score) {
      best = { npc, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  if (tie && best && best.score < 0.98) return undefined;
  return best;
}

/**
 * Group NPC ids that look like duplicates of each other (for a "merge duplicates" action and tests).
 */
export function findDuplicateNpcs(state: Pick<CampaignState, 'npcs'>): string[][] {
  const npcs = Object.values(state.npcs);
  const groups: string[][] = [];
  const used = new Set<string>();
  for (let i = 0; i < npcs.length; i++) {
    if (used.has(npcs[i].id)) continue;
    const group = [npcs[i].id];
    for (let j = i + 1; j < npcs.length; j++) {
      if (used.has(npcs[j].id)) continue;
      if (nameMatchScore(npcs[i].name, npcs[j].name) >= 0.85) {
        group.push(npcs[j].id);
        used.add(npcs[j].id);
      }
    }
    if (group.length > 1) {
      used.add(npcs[i].id);
      groups.push(group);
    }
  }
  return groups;
}

/** Deterministic unique id from a name within a collection. */
export function uniqueId(existing: Record<string, unknown>, prefix: string, name: string): string {
  const base = `${prefix}_${slugify(name)}`;
  if (!existing[base]) return base;
  for (let i = 2; i < 10000; i++) if (!existing[`${base}_${i}`]) return `${base}_${i}`;
  return `${base}_${Object.keys(existing).length}`;
}

/** Deterministic counter-based id (for log entries, objectives…). */
export function nextCounter(counters: Record<string, number>, key: string): number {
  counters[key] = (counters[key] ?? 0) + 1;
  return counters[key];
}
