/**
 * Background memory writers, the pure half: the chronicler (reads a stretch of chat the
 * turn-by-turn pass may have missed) and consolidation (folds finished scenes, days and
 * chapters). The server runs the model calls; everything here is deterministic.
 */
import { extractJson } from '../util/json-extract.js';
import { readTrackerExtras, type TrackedFact, type TrackedMemory } from '../game/tracker.js';
import { contentWords, jaccard } from './recall.js';
import { coldScenes, maxImportance, type SceneGroup } from './summaries.js';
import type { Importance, MemoryItem, SummaryItem } from './types.js';

// ------------------------------------------------------------------ watermark

/** One successful chronicler run, anchored to the last message it read. */
export interface ChronicleRun {
  fromSeq: number;
  toSeq: number;
  messageId: string;
  swipeId: number;
  at: number;
}

/**
 * How far the chronicler has read. Only runs whose anchor message still shows the same swipe
 * count: if the last message it read was swiped, edited away or deleted, what it wrote is gone
 * too, and reading resumes from the previous live run. A failed run is never recorded.
 */
export function effectiveWatermark(runs: ChronicleRun[], isLive: (messageId: string, swipeId: number) => boolean): number {
  let w = 0;
  for (const r of runs) if (r.toSeq > w && isLive(r.messageId, r.swipeId)) w = r.toSeq;
  return w;
}

export interface ChronicleMessage {
  seq: number;
  name: string;
  text: string;
}

/**
 * Which messages the next run reads: after the watermark, never the newest `keepRecent` (they are
 * still in the prompt verbatim and may still be swiped), at most `maxBatch`. Null when there is
 * not yet enough to be worth a call.
 */
export function chronicleBatch<T extends ChronicleMessage>(messages: T[], watermark: number, opts: { keepRecent?: number; minBatch?: number; maxBatch?: number; force?: boolean } = {}): T[] | null {
  const keep = opts.keepRecent ?? 4;
  const eligible = messages.slice(0, Math.max(0, messages.length - keep)).filter((m) => m.seq > watermark);
  if (!eligible.length) return null;
  if (!opts.force && eligible.length < (opts.minBatch ?? 6)) return null;
  return eligible.slice(0, opts.maxBatch ?? 60);
}

export const CHRONICLER_SYSTEM = 'You are the chronicler of a roleplay story. You read a stretch of the chat and record what happened. Output JSON only.';

export function buildChroniclePrompt(input: { messages: ChronicleMessage[]; known: string[]; player: string; summarize: boolean; maxWords?: number }): Array<{ role: 'system' | 'user'; content: string }> {
  const body = input.messages.map((m) => `${m.name}: ${m.text}`).join('\n\n').slice(-24000);
  const known = input.known.length ? `Already recorded (do not repeat these):\n${input.known.slice(-40).map((k) => `- ${k}`).join('\n')}\n\n` : '';
  const summary = input.summarize ? `,\n "summary": "<what happened in this stretch, past tense, at most ${input.maxWords ?? 150} words, concrete names and places>"` : '';
  return [
    { role: 'system', content: CHRONICLER_SYSTEM },
    {
      role: 'user',
      content: `${known}Chat (the player is ${input.player}):
${body}

Record the events worth remembering later: promises, discoveries, conflicts, gifts, confessions, arrivals, deaths, decisions. One line each, past tense, with names. Skip small talk.
A secret or whisper goes in "memories" with "private": true and never in the summary.
Standing facts that became true (occupation, rank, home, relationship) go in "facts"; set "changed": true only when the text shows the fact changing.
Reply with JSON only:
{"memories": [{"text": "...", "about": ["names involved"], "importance": 1|2|3, "private": false, "to": []}],
 "facts": [{"about": "name or world", "key": "short slot", "value": "...", "text": "...", "changed": false}]${summary}}
importance 3 is for milestones only (a death, a betrayal, a vow, a new chapter of life). "private": true with "to" when only some people heard it.`,
    },
  ];
}

export interface ChronicleOutput {
  memories: TrackedMemory[];
  facts: TrackedFact[];
  summary: string;
}

export function parseChronicle(text: string): ChronicleOutput | null {
  const r = extractJson<Record<string, unknown>>(text);
  if (!r.ok || !r.value || typeof r.value !== 'object') return null;
  const v = r.value as Record<string, unknown>;
  // The chronicler may return more than a turn does.
  const memories = (Array.isArray(v.memories) ? v.memories : []).slice(0, 24);
  const extras = [0, 6, 12, 18].map((i) => readTrackerExtras({ memories: memories.slice(i, i + 6) }).memories).flat();
  return { memories: extras, facts: readTrackerExtras({ facts: v.facts }).facts, summary: typeof v.summary === 'string' ? v.summary.trim().slice(0, 4000) : '' };
}

/** Drop chronicle lines that repeat something already remembered. */
export function novel<T extends { text: string }>(incoming: T[], existing: string[], threshold = 0.5): T[] {
  const seen = existing.map((e) => contentWords(e));
  const out: T[] = [];
  for (const m of incoming) {
    const w = contentWords(m.text);
    if (seen.some((s) => jaccard(s, w) >= threshold)) continue;
    seen.push(w);
    out.push(m);
  }
  return out;
}

// ------------------------------------------------------------------ consolidation

/**
 * Finished scenes to fold, split so a folded memory never leaks: beats are only folded together
 * when exactly the same people saw them (and they share secrecy). Each group becomes one scene
 * memory known to those people.
 */
export interface ScenePlan {
  beats: MemoryItem[];
  locationId: string | null;
  from: number;
  to: number;
  witnesses: string[];
  participants: string[];
  secret: boolean;
  importance: Importance;
}

export function planScenes(beats: MemoryItem[], currentLocation: string | null, now: number, opts: { minBeats?: number; gapMinutes?: number } = {}): ScenePlan[] {
  const eligible = beats.filter((b) => b.kind === 'beat' || b.kind === 'chronicle');
  const out: ScenePlan[] = [];
  for (const g of coldScenes(eligible, currentLocation, now, { gapMinutes: opts.gapMinutes, minBeats: 1 }) as SceneGroup[]) {
    const byWitness = new Map<string, MemoryItem[]>();
    for (const b of g.beats) {
      const key = `${b.secret ? 's' : 'o'}|${[...b.witnesses].sort().join(',')}`;
      (byWitness.get(key) ?? byWitness.set(key, []).get(key)!).push(b);
    }
    for (const list of byWitness.values()) {
      if (list.length < (opts.minBeats ?? 3)) continue;
      out.push({
        beats: list,
        locationId: g.locationId,
        from: Math.min(...list.map((b) => b.gameTime)),
        to: Math.max(...list.map((b) => b.gameTime)),
        witnesses: [...list[0].witnesses],
        participants: [...new Set(list.flatMap((b) => b.participants))],
        secret: list[0].secret,
        importance: maxImportance(list),
      });
    }
  }
  return out;
}

export interface DayPlan {
  day: number;
  items: MemoryItem[];
  importance: Importance;
}

/**
 * Finished days (before `today`) not yet summarized: every live, unfolded memory of that day.
 * `covered` is the set of memory ids already inside a live day or chapter summary.
 */
export function planDays(items: MemoryItem[], today: number, covered: Set<string>, opts: { minItems?: number } = {}): DayPlan[] {
  const byDay = new Map<number, MemoryItem[]>();
  // Secrets never go into a summary: a summary is shared background, a secret is not.
  for (const m of items.filter((x) => !x.secret)) {
    const d = Math.floor(m.gameTime / 1440);
    if (d >= today) continue;
    (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(m);
  }
  const out: DayPlan[] = [];
  for (const [day, list] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    if (list.every((m) => covered.has(m.id))) continue;
    if (list.length < (opts.minItems ?? 2)) continue;
    out.push({ day, items: list.sort((a, b) => a.seq - b.seq), importance: maxImportance(list) });
  }
  return out;
}

/**
 * When too many summaries sit outside any chapter, the oldest are folded into one: the story so
 * far stays short without anything being lost (milestones are carried up).
 */
export function planChapter(summaries: SummaryItem[], opts: { threshold?: number; take?: number } = {}): SummaryItem[] | null {
  const inChapter = new Set(summaries.filter((s) => s.level === 'chapter').flatMap((s) => s.covers));
  const loose = summaries.filter((s) => s.level !== 'chapter' && !inChapter.has(s.id)).sort((a, b) => a.fromTime - b.fromTime || a.seq - b.seq);
  if (loose.length < (opts.threshold ?? 6)) return null;
  return loose.slice(0, opts.take ?? 4);
}

export const CONSOLIDATE_SYSTEM = 'You condense story memories into short summaries. Output JSON only.';

export function buildConsolidatePrompt(groups: Array<{ id: string; kind: 'scene' | 'day' | 'chapter'; lines: string[]; milestones: string[] }>): Array<{ role: 'system' | 'user'; content: string }> {
  const parts = groups.map((g) => `[${g.id}] (${g.kind})\n${g.lines.map((l) => `- ${l}`).join('\n')}${g.milestones.length ? `\nMust keep: ${g.milestones.join(' | ')}` : ''}`);
  return [
    { role: 'system', content: CONSOLIDATE_SYSTEM },
    {
      role: 'user',
      content: `Summarize each group below in past tense with names. A scene: 1–2 sentences. A day: 2–3 sentences. A chapter: 3–5 sentences. Keep every "Must keep" event. Do not invent anything.

${parts.join('\n\n')}

Reply with JSON only: {"summaries": {"<id>": {"title": "<3-6 words>", "text": "..."}}}`,
    },
  ];
}

export function parseConsolidate(text: string): Map<string, { title: string; text: string }> {
  const out = new Map<string, { title: string; text: string }>();
  const r = extractJson<Record<string, unknown>>(text);
  if (!r.ok || !r.value || typeof r.value !== 'object') return out;
  const s = (r.value as any).summaries;
  if (!s || typeof s !== 'object') return out;
  for (const [id, v] of Object.entries(s as Record<string, any>)) {
    const t = typeof v === 'string' ? v : typeof v?.text === 'string' ? v.text : '';
    if (t.trim().length >= 8) out.set(id, { title: typeof v?.title === 'string' ? v.title.trim().slice(0, 80) : '', text: t.trim().slice(0, 4000) });
  }
  return out;
}

/**
 * Milestones never disappear: any milestone the summary prose doesn't clearly carry (most of its
 * content words present) is appended verbatim.
 */
export function ensureMilestones(text: string, milestones: string[]): string {
  let out = text.trim();
  const have = () => contentWords(out);
  for (const m of milestones) {
    const words = contentWords(m);
    if (!words.size) continue;
    const got = have();
    let hit = 0;
    for (const w of words) if (got.has(w)) hit++;
    if (hit / words.size >= 0.6) continue;
    out = `${out}${out && !/[.!?…]$/.test(out) ? '.' : ''} ${m.trim().replace(/\.?$/, '.')}`.trim();
  }
  return out;
}
