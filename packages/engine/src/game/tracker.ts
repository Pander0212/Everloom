/** Tracker pass: prompt construction for the utility model, and inline-tag parsing. */
import { extractJson } from '../util/json-extract.js';
import { truncate } from '../util/text.js';
import { buildGameStateBlock } from './injection.js';
import { OP_REFERENCE, validateOps, type ValidatedOps } from './ops.js';
import type { CampaignState } from './state.js';

export const INLINE_TAG_RE = /<everloom>([\s\S]*?)(?:<\/everloom>|$)/gi;

/** Remove <everloom>…</everloom> blocks (also an unterminated one while streaming). */
export function stripInlineTags(text: string): string {
  return text.replace(INLINE_TAG_RE, '').replace(/<everloom[^>]*$/i, '').trimEnd();
}

export function extractInlineOps(text: string): ValidatedOps & TrackerExtras & { found: boolean } {
  const all: unknown[] = [];
  const extras: TrackerExtras = { memories: [], facts: [] };
  let found = false;
  for (const m of text.matchAll(INLINE_TAG_RE)) {
    found = true;
    const r = extractJson(m[1]);
    if (r.ok) {
      const v = r.value as any;
      if (Array.isArray(v)) all.push(...v);
      else if (Array.isArray(v?.ops)) all.push(...v.ops);
      else if (v?.type) all.push(v);
      const x = readTrackerExtras(v);
      extras.memories.push(...x.memories);
      extras.facts.push(...x.facts);
    }
  }
  return { ...validateOps(all), ...extras, found };
}

export const INLINE_INSTRUCTION = `After your reply, append the game-state changes that happened in it as <everloom>{"ops":[...]}</everloom>. Use only these ops; omit the tag if nothing changed.
${OP_REFERENCE}`;

export interface TrackerMessage {
  name: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

/** The memory part of the tracker contract: one line per notable beat, and standing facts. */
export const MEMORY_CONTRACT = `Also record what is worth remembering from the latest turn:
- "memories": 0-3 short past-tense sentences with full names, each a notable beat (a promise, a reveal, a fight, a gift, a confession — not small talk). Fields: "text", "about" (names it concerns), "importance" (1 ordinary, 2 lasting, 3 life-changing), "private" (true for a whisper or secret) and "to" (who was told, for private ones).
- "facts": standing truths the turn establishes or CHANGES about a person, place or the world (rank, job, home, allegiance, relationship status, a lasting injury). Fields: "about" (a name, or "world"), "key" (a short slot like "rank"), "value", "text" (one sentence), "changed" (true only if the turn shows it changing, e.g. "was knighted").
Leave both empty when nothing notable happened.`;

export function buildTrackerPrompt(state: CampaignState, messages: TrackerMessage[], opts: { characterNames?: string[]; memory?: boolean } = {}) {
  const memory = opts.memory !== false;
  const system = `You are the bookkeeper for a roleplay game. Read the latest story turn and output ONLY the state changes it caused, as JSON: {"ops":[...]${memory ? ',"memories":[...],"facts":[...]' : ''}}.
Rules:
- Only record what actually happened in the latest turn. Never repeat changes from earlier turns.
- Numbers are small and realistic (a meal: hunger -20..-30; a short walk: 5..15 minutes).
- Use existing names from the state when referring to people, places, items and organizations.
- Include a "time.advance" op with the minutes the scene plausibly took (0 if unclear).
- If nothing changed, output {"ops":[]${memory ? ',"memories":[],"facts":[]' : ''}}.
- Output JSON only. No prose, no markdown.
${OP_REFERENCE}${memory ? `\n\n${MEMORY_CONTRACT}` : ''}`;
  const stateBlock = buildGameStateBlock(state, { budgetTokens: 700 });
  const convo = messages
    .slice(-6)
    .map((m) => `${m.name}: ${truncate(m.text, 2400)}`)
    .join('\n\n');
  const user = `Current state:
${stateBlock}
${opts.characterNames?.length ? `\nKnown characters: ${opts.characterNames.join(', ')}\n` : ''}
Recent story (the last message is the new turn):
${convo}

Return {"ops":[...]${memory ? ',"memories":[...],"facts":[...]' : ''}} for the new turn only.`;
  return { system, user };
}

export const TRACKER_REPAIR_PROMPT = 'Your previous output was not valid JSON. Reply again with ONLY a JSON object of the form {"ops":[...]} and nothing else.';

export interface TrackedMemory {
  text: string;
  about: string[];
  importance: number;
  private: boolean;
  to: string[];
}

export interface TrackedFact {
  about: string;
  key: string;
  value: string;
  text: string;
  changed: boolean;
}

export interface TrackerExtras {
  memories: TrackedMemory[];
  facts: TrackedFact[];
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x, 80)).filter(Boolean).slice(0, 12) : typeof v === 'string' && v.trim() ? [v.trim().slice(0, 80)] : []);

/** Tolerant reader for the memory part of a tracker reply. Anything malformed is dropped. */
export function readTrackerExtras(value: unknown): TrackerExtras {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const memories = (Array.isArray(v.memories) ? v.memories : [])
    .map((m: any) => (typeof m === 'string' ? { text: m } : m))
    .filter((m: any) => m && typeof m === 'object')
    .map((m: any) => ({ text: str(m.text ?? m.summary, 600), about: names(m.about ?? m.who), importance: Math.min(3, Math.max(1, Math.round(Number(m.importance) || 1))), private: m.private === true || m.secret === true, to: names(m.to) }))
    .filter((m) => m.text.length >= 8)
    .slice(0, 6);
  const facts = (Array.isArray(v.facts) ? v.facts : [])
    .filter((f: any) => f && typeof f === 'object')
    .map((f: any) => ({ about: str(f.about ?? f.entity, 80), key: str(f.key, 40), value: str(f.value, 200), text: str(f.text, 400), changed: f.changed === true }))
    .filter((f) => f.about && f.key && f.value)
    .slice(0, 6);
  return { memories, facts };
}

export function parseTrackerOutput(text: string): ValidatedOps & TrackerExtras & { parsed: boolean } {
  const r = extractJson(text);
  if (!r.ok) return { ok: [], rejected: [], parsed: false, memories: [], facts: [] };
  return { ...validateOps(r.value), ...readTrackerExtras(r.value), parsed: true };
}
