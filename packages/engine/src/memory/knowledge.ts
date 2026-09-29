/**
 * Knowledge scoping: who can know what. Pure.
 *
 * A character knows a memory first-hand if they witnessed it, or second-hand if someone told
 * them (hearsay). Secrets are known only to their witnesses. Participants are who a memory is
 * ABOUT and grant no knowledge on their own: being gossiped about is not the same as being there.
 */
import type { HeardItem, KnowledgeKind, MemoryItem } from './types.js';

export class HeardIndex {
  private map = new Map<string, HeardItem>();
  constructor(items: HeardItem[] = []) {
    for (const h of items) this.add(h);
  }
  private key(memoryId: string, viewer: string) {
    return `${memoryId}\u0000${viewer}`;
  }
  /** Keeps the least distorted version when a viewer heard the same thing twice. */
  add(h: HeardItem) {
    const k = this.key(h.memoryId, h.viewer);
    const cur = this.map.get(k);
    if (!cur || h.distortion < cur.distortion) this.map.set(k, h);
  }
  get(memoryId: string, viewer: string): HeardItem | undefined {
    return this.map.get(this.key(memoryId, viewer));
  }
  all(): HeardItem[] {
    return [...this.map.values()];
  }
}

export interface KnowledgeResult {
  kind: KnowledgeKind;
  distortion: number;
}

export function knowledgeOf(viewer: string, m: MemoryItem, heard: HeardIndex): KnowledgeResult | null {
  if (m.witnesses.includes(viewer)) return { kind: 'witnessed', distortion: 0 };
  if (m.secret) return null;
  const h = heard.get(m.id, viewer);
  return h ? { kind: 'heard', distortion: h.distortion } : null;
}

export function knows(viewer: string, m: MemoryItem, heard: HeardIndex): boolean {
  return knowledgeOf(viewer, m, heard) !== null;
}

/** Everything a viewer can legitimately remember (the whole store, never a capped cache). */
export function knownBy(viewer: string, memories: MemoryItem[], heard: HeardIndex): Array<{ m: MemoryItem; k: KnowledgeResult }> {
  const out: Array<{ m: MemoryItem; k: KnowledgeResult }> = [];
  for (const m of memories) {
    const k = knowledgeOf(viewer, m, heard);
    if (k) out.push({ m, k });
  }
  return out;
}

export interface HearsayOptions {
  /** A rumor retold more often than this dies. */
  maxDistortion: number;
  /** Most new things any one listener hears per tick. */
  perListener: number;
}

/**
 * One tick of gossip among people standing together. Deterministic: the newest, most important
 * non-secret things a speaker knows are passed to listeners in the same group who don't know them.
 * Each retelling adds one distortion. Returns only NEW heard records.
 */
export function spreadHearsay(groups: string[][], memories: MemoryItem[], heard: HeardIndex, opts: HearsayOptions): HeardItem[] {
  const out: HeardItem[] = [];
  const next = new HeardIndex(heard.all());
  const ranked = memories.filter((m) => !m.secret).sort((a, b) => b.importance - a.importance || b.seq - a.seq);
  for (const group of groups) {
    const members = [...new Set(group)].sort();
    if (members.length < 2) continue;
    for (const listener of members) {
      let got = 0;
      for (const m of ranked) {
        if (got >= opts.perListener) break;
        if (knowledgeOf(listener, m, next)) continue;
        // Best (least distorted) teller in the group.
        let best: { from: string; d: number } | null = null;
        for (const speaker of members) {
          if (speaker === listener) continue;
          const k = knowledgeOf(speaker, m, next);
          if (!k) continue;
          if (!best || k.distortion < best.d) best = { from: speaker, d: k.distortion };
        }
        if (!best) continue;
        const distortion = best.d + 1;
        if (distortion > opts.maxDistortion) continue;
        const h: HeardItem = { memoryId: m.id, viewer: listener, distortion, from: best.from };
        next.add(h);
        out.push(h);
        got++;
      }
    }
  }
  return out;
}
