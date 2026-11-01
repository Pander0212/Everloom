/**
 * Consolidation (§10), deterministic and derived (so branch-aware for free; the log is never
 * rewritten): repeated ordinary episodes with the same people at the same place become one
 * semantic pattern ("dinner with Anna at the inn — many times"). Recall then shows the pattern
 * once instead of five near-identical episodes, and the trivial repeats lose accessibility.
 */
import { words } from './projector.js';
import type { MemoryUnit } from './types.js';

export interface MemoryPattern {
  id: string;
  owner: string;
  text: string;
  count: number;
  unitIds: string[];
  entities: string[];
  locationId: string | null;
  lastSeq: number;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

export function patternsOf(units: MemoryUnit[], minCount = 3, similarity = 0.3): MemoryPattern[] {
  const groups = new Map<string, MemoryUnit[]>();
  for (const u of units) {
    if (u.importance > 1 || u.commitmentId || u.kind === 'autobiographical') continue;
    const key = `${u.owner}|${[...u.entities].sort().join(',')}|${u.locationId ?? ''}`;
    const arr = groups.get(key) ?? [];
    arr.push(u);
    groups.set(key, arr);
  }
  const out: MemoryPattern[] = [];
  for (const arr of groups.values()) {
    if (arr.length < minCount) continue;
    const clusters: Array<{ words: Set<string>; units: MemoryUnit[] }> = [];
    for (const u of arr.sort((a, b) => a.seq - b.seq)) {
      const w = new Set(words(u.l1));
      const c = clusters.find((x) => jaccard(x.words, w) >= similarity);
      if (c) {
        c.units.push(u);
        for (const x of w) c.words.add(x);
      } else clusters.push({ words: w, units: [u] });
    }
    for (const c of clusters) {
      if (c.units.length < minCount) continue;
      const last = c.units[c.units.length - 1];
      out.push({ id: `pat:${last.owner}:${c.units[0].id}`, owner: last.owner, text: `${last.l0} — one of ${c.units.length} similar times`, count: c.units.length, unitIds: c.units.map((u) => u.id), entities: last.entities, locationId: last.locationId, lastSeq: last.seq });
    }
  }
  return out;
}
