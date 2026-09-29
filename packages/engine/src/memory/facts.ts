/**
 * Versioned facts. Pure.
 *
 * A fact fills a slot (entity + key). A new value for the same slot either SUPERSEDES the old one
 * (the story shows the change: "Mara was knighted") or raises a CONFLICT for the player to settle
 * (two different claims with no change between them). Nothing is silently stored twice, and the
 * old version is kept as history.
 */
import { normalizeName } from '../util/text.js';
import type { FactItem, IncomingFact } from './types.js';

export function factKey(key: string): string {
  return normalizeName(key).replace(/\s+/g, '_').slice(0, 40) || 'note';
}

export function factValue(value: string): string {
  return normalizeName(value)
    .replace(/^(a|an|the)\s+/, '')
    .trim();
}

export type FactAction =
  | { action: 'insert' }
  | { action: 'refresh'; target: FactItem }
  | { action: 'supersede'; target: FactItem }
  | { action: 'conflict'; target: FactItem };

/** Decide what a new fact does to the facts already stored for the same entity. */
export function resolveFact(existing: FactItem[], incoming: IncomingFact): FactAction {
  const key = factKey(incoming.key);
  const val = factValue(incoming.value);
  const sameSlot = existing.filter((f) => f.entityId === incoming.entityId && factKey(f.key) === key && (f.status === 'active' || f.status === 'conflict'));
  if (!sameSlot.length) return { action: 'insert' };
  const same = sameSlot.find((f) => factValue(f.value) === val);
  if (same) return { action: 'refresh', target: same };
  // Newest active value is the one a change replaces.
  const current = sameSlot.filter((f) => f.status === 'active').sort((a, b) => b.seq - a.seq)[0] ?? sameSlot.sort((a, b) => b.seq - a.seq)[0];
  return incoming.changed ? { action: 'supersede', target: current } : { action: 'conflict', target: current };
}

/** Facts that are currently true (active only), newest first per slot. */
export function currentFacts(all: FactItem[], entityId?: string): FactItem[] {
  const bySlot = new Map<string, FactItem>();
  for (const f of all) {
    if (f.status !== 'active') continue;
    if (entityId && f.entityId !== entityId) continue;
    const k = `${f.entityId}|${factKey(f.key)}`;
    const cur = bySlot.get(k);
    if (!cur || f.seq > cur.seq) bySlot.set(k, f);
  }
  return [...bySlot.values()].sort((a, b) => b.seq - a.seq);
}

/** Open conflicts: the new claim and the fact it contradicts. */
export function openConflicts(all: FactItem[]): Array<{ claim: FactItem; against: FactItem | null }> {
  const byId = new Map(all.map((f) => [f.id, f]));
  return all.filter((f) => f.status === 'conflict').map((f) => ({ claim: f, against: f.conflictsWith ? byId.get(f.conflictsWith) ?? null : null }));
}
