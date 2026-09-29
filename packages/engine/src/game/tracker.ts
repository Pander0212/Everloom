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

export function extractInlineOps(text: string): ValidatedOps & { found: boolean } {
  const all: unknown[] = [];
  let found = false;
  for (const m of text.matchAll(INLINE_TAG_RE)) {
    found = true;
    const r = extractJson(m[1]);
    if (r.ok) {
      const v = r.value as any;
      if (Array.isArray(v)) all.push(...v);
      else if (Array.isArray(v?.ops)) all.push(...v.ops);
      else if (v?.type) all.push(v);
    }
  }
  return { ...validateOps(all), found };
}

export const INLINE_INSTRUCTION = `After your reply, append the game-state changes that happened in it as <everloom>{"ops":[...]}</everloom>. Use only these ops; omit the tag if nothing changed.
${OP_REFERENCE}`;

export interface TrackerMessage {
  name: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

export function buildTrackerPrompt(state: CampaignState, messages: TrackerMessage[], opts: { characterNames?: string[] } = {}) {
  const system = `You are the bookkeeper for a roleplay game. Read the latest story turn and output ONLY the state changes it caused, as JSON: {"ops":[...]}.
Rules:
- Only record what actually happened in the latest turn. Never repeat changes from earlier turns.
- Numbers are small and realistic (a meal: hunger -20..-30; a short walk: 5..15 minutes).
- Use existing names from the state when referring to people, places, items and organizations.
- Include a "time.advance" op with the minutes the scene plausibly took (0 if unclear).
- If nothing changed, output {"ops":[]}.
- Output JSON only. No prose, no markdown.
${OP_REFERENCE}`;
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

Return {"ops":[...]} for the new turn only.`;
  return { system, user };
}

export const TRACKER_REPAIR_PROMPT = 'Your previous output was not valid JSON. Reply again with ONLY a JSON object of the form {"ops":[...]} and nothing else.';

export function parseTrackerOutput(text: string): ValidatedOps & { parsed: boolean } {
  const r = extractJson(text);
  if (!r.ok) return { ok: [], rejected: [], parsed: false };
  return { ...validateOps(r.value), parsed: true };
}
