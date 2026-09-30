/**
 * Hierarchical summaries: beats → scenes → days → chapters. Pure grouping; the prose for each
 * summary is written by a model when one is available, with a deterministic fallback.
 * Milestones (importance 3) are carried up every level so they never disappear.
 */
import type { MemoryItem, SummaryItem } from './types.js';

export interface SceneGroup {
  locationId: string | null;
  from: number;
  to: number;
  beats: MemoryItem[];
}

/** Split beats into scenes: a new scene starts on a change of place or a gap of `gapMinutes`. */
export function groupScenes(beats: MemoryItem[], gapMinutes = 120): SceneGroup[] {
  const sorted = beats.slice().sort((a, b) => a.seq - b.seq);
  const out: SceneGroup[] = [];
  for (const b of sorted) {
    const cur = out[out.length - 1];
    if (cur && cur.locationId === b.locationId && b.gameTime - cur.to <= gapMinutes) {
      cur.beats.push(b);
      cur.to = Math.max(cur.to, b.gameTime);
    } else out.push({ locationId: b.locationId, from: b.gameTime, to: b.gameTime, beats: [b] });
  }
  return out;
}

/**
 * Scenes that are finished and worth folding: not the scene still in progress, and with at least
 * `minBeats` beats (a single beat is already its own memory).
 */
export function coldScenes(beats: MemoryItem[], currentLocation: string | null, now: number, opts: { gapMinutes?: number; minBeats?: number } = {}): SceneGroup[] {
  const groups = groupScenes(beats, opts.gapMinutes);
  const last = groups[groups.length - 1];
  const inProgress = last && last.locationId === currentLocation && now - last.to <= (opts.gapMinutes ?? 120);
  return groups.filter((g) => g !== (inProgress ? last : undefined) && g.beats.length >= (opts.minBeats ?? 3));
}

export function maxImportance(items: Array<{ importance: 1 | 2 | 3 }>): 1 | 2 | 3 {
  return items.reduce<1 | 2 | 3>((m, x) => (x.importance > m ? x.importance : m), 1);
}

/** Deterministic fallback prose: the beats themselves, trimmed, milestones first. */
export function fallbackSummary(items: Array<{ text: string; importance: number }>, maxChars = 600): string {
  const ordered = items.filter((i) => i.importance >= 3).concat(items.filter((i) => i.importance < 3));
  let out = '';
  for (const i of ordered) {
    const t = i.text.trim().replace(/\s+/g, ' ');
    if (!t) continue;
    const next = out ? `${out} ${t.endsWith('.') ? t : `${t}.`}` : t.endsWith('.') ? t : `${t}.`;
    if (next.length > maxChars) break;
    out = next;
  }
  return out;
}

/** Group scene summaries by calendar day (minutes / 1440). */
export function groupByDay<T extends { fromTime: number }>(items: T[]): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const i of items) {
    const d = Math.floor(i.fromTime / 1440);
    const arr = out.get(d) ?? [];
    arr.push(i);
    out.set(d, arr);
  }
  return out;
}

/**
 * The STORY SO FAR for the scene block, oldest first: chapters, then days not inside a chapter,
 * then finished scenes not inside a day, then milestones nothing shown covers. Pass scene
 * memories as level 'scene' items whose `covers` are their folded beats. Over budget, the oldest
 * ordinary lines go first; a line carrying a milestone is never dropped (it is shortened instead).
 */
export function storySoFar(summaries: SummaryItem[], milestones: MemoryItem[], maxChars = 1600): string[] {
  const order = (a: SummaryItem, b: SummaryItem) => a.fromTime - b.fromTime || a.seq - b.seq;
  const byId = new Map(summaries.map((x) => [x.id, x]));
  const covered = new Set<string>();
  const walk = (id: string) => {
    if (covered.has(id)) return;
    covered.add(id);
    for (const c of byId.get(id)?.covers ?? []) walk(c);
  };
  const shown: SummaryItem[] = [];
  for (const level of ['chapter', 'day', 'scene'] as const) {
    for (const x of summaries.filter((y) => y.level === level).sort(order)) {
      if (covered.has(x.id)) continue;
      shown.push(x);
      for (const c of x.covers) walk(c);
    }
  }
  // Secret milestones are recalled (with who knows) rather than recapped as common knowledge.
  const loose = milestones.filter((m) => !covered.has(m.id) && !m.secret).sort((a, b) => a.seq - b.seq);
  const lines: Array<{ text: string; keep: boolean }> = [
    ...shown.map((x) => ({ text: x.text, keep: x.importance >= 3 })),
    ...loose.map((m) => ({ text: m.text, keep: true })),
  ];
  const cost = () => lines.reduce((n, l) => n + l.text.length, 0);
  // Drop ordinary lines oldest first.
  for (let i = 0; i < lines.length && cost() > maxChars; ) {
    if (!lines[i].keep && lines.length > 1) lines.splice(i, 1);
    else i++;
  }
  // Still over: shorten the kept lines (oldest first) rather than lose them.
  for (const l of lines) {
    if (cost() <= maxChars) break;
    if (l.text.length > 220) l.text = `${l.text.slice(0, 217).replace(/\s+\S*$/, '')}…`;
  }
  return lines.map((l) => l.text);
}
