/**
 * Character studio: prompts and reply parsing for AI-assisted card writing. The server only picks
 * the connection and makes the call; everything the model sees and every way its reply is read is here.
 */
import type { CardData } from '../cards/card.js';
import { extractJson } from '../util/json-extract.js';

export type StudioField = 'name' | 'description' | 'personality' | 'scenario' | 'first_mes' | 'mes_example' | 'alternate_greetings' | 'tags' | 'creator_notes' | 'system_prompt' | 'post_history_instructions';

export const STUDIO_FIELDS: Array<{ key: StudioField; label: string; hint: string }> = [
  { key: 'name', label: 'Name', hint: 'what the character is called' },
  { key: 'description', label: 'Description', hint: 'who they are: looks, history, situation, how they talk; the core of the card' },
  { key: 'personality', label: 'Personality', hint: 'a short summary of temperament and quirks' },
  { key: 'scenario', label: 'Scenario', hint: 'where and how the story starts' },
  { key: 'first_mes', label: 'First message', hint: 'the opening message, written in the character\'s voice, that sets the scene and invites {{user}} in' },
  { key: 'mes_example', label: 'Example messages', hint: 'two or three short example exchanges, each starting with <START>, using {{user}}: and {{char}}: lines' },
  { key: 'alternate_greetings', label: 'Alternate greetings', hint: 'other opening messages for different starts' },
  { key: 'tags', label: 'Tags', hint: 'a few lowercase genre and theme tags' },
  { key: 'creator_notes', label: 'Creator notes', hint: 'a note for people browsing the card: what it is and how to play it' },
  { key: 'system_prompt', label: 'System prompt', hint: 'optional instructions that replace the main prompt for this character' },
  { key: 'post_history_instructions', label: 'Post-history instructions', hint: 'optional short reminders sent after the chat history' },
];

export interface StudioPreset {
  id: string;
  name: string;
  system: string;
}

const BASE = `You are a skilled character writer helping someone build a roleplay character card.
Write in plain, vivid prose. Refer to the player as {{user}} and to the character as {{char}} inside the card text.
Never write actions or dialogue for {{user}}.`;

export const STUDIO_PRESETS: StudioPreset[] = [
  { id: 'balanced', name: 'Balanced', system: `${BASE}\nAim for a card around 400–700 words of description: specific, playable, with room for the story to grow.` },
  { id: 'rich', name: 'Rich and detailed', system: `${BASE}\nGo deep: history, relationships, habits, speech patterns, secrets and wants. Descriptions of 800–1200 words are fine.` },
  { id: 'concise', name: 'Concise', system: `${BASE}\nKeep everything short and token-efficient: description under 250 words, first message under 120 words.` },
];

export type StudioRequest =
  | { mode: 'brainstorm'; brief: string }
  | { mode: 'create'; brief: string }
  | { mode: 'refine'; instruction: string }
  | { mode: 'field'; field: StudioField; instruction?: string }
  | { mode: 'revise'; field: StudioField; selection: string; instruction: string };

export type StudioResult =
  | { mode: 'brainstorm'; ideas: Array<{ title: string; pitch: string }> }
  | { mode: 'create' | 'refine'; card: Partial<CardData>; notes: string }
  | { mode: 'field'; field: StudioField; value: string | string[] }
  | { mode: 'revise'; field: StudioField; text: string };

type Draft = Partial<Pick<CardData, StudioField>>;

const label = (k: StudioField) => STUDIO_FIELDS.find((f) => f.key === k)!.label;
const LIST_FIELDS = new Set<StudioField>(['alternate_greetings', 'tags']);

/** The current draft, as the model should see it (empty fields left out). */
export function draftText(d: Draft): string {
  const parts: string[] = [];
  for (const { key } of STUDIO_FIELDS) {
    const v = d[key];
    if (Array.isArray(v) ? !v.length : !String(v ?? '').trim()) continue;
    parts.push(`## ${label(key)} (${key})\n${Array.isArray(v) ? (key === 'tags' ? v.join(', ') : v.map((g, i) => `[${i + 1}] ${g}`).join('\n')) : v}`);
  }
  return parts.join('\n\n') || '(empty so far)';
}

const FIELD_GUIDE = STUDIO_FIELDS.map((f) => `- ${f.key}: ${f.hint}`).join('\n');

export function buildStudioMessages(req: StudioRequest, draft: Draft, system: string): Array<{ role: 'system' | 'user'; content: string }> {
  const sys = (s: string) => ({ role: 'system' as const, content: `${system.trim()}\n\n${s}` });
  const user = (s: string) => ({ role: 'user' as const, content: s });
  switch (req.mode) {
    case 'brainstorm':
      return [
        sys('Pitch distinct character concepts. Vary tone, setting and dynamic; avoid the obvious first idea.\nReply with JSON only: {"ideas": [{"title": "short name or hook", "pitch": "two or three sentences"}]} with exactly 5 ideas.'),
        user(`What I'm after:\n${req.brief.trim() || 'Surprise me.'}`),
      ];
    case 'create':
      return [
        sys(`Write a complete character card from the brief. Fields:\n${FIELD_GUIDE}\nLeave system_prompt and post_history_instructions empty unless the brief asks for them.\nReply with JSON only: {"card": {"name": "...", "description": "...", "personality": "...", "scenario": "...", "first_mes": "...", "mes_example": "...", "alternate_greetings": ["..."], "tags": ["..."], "creator_notes": "..."}, "notes": "one sentence on the choices you made"}`),
        user(`Brief:\n${req.brief.trim()}${draftHas(draft) ? `\n\nKeep what already works in this draft:\n${draftText(draft)}` : ''}`),
      ];
    case 'refine':
      return [
        sys(`Revise the card as asked. Change only what the request needs, keep everything else as it is. Fields:\n${FIELD_GUIDE}\nReply with JSON only: {"card": {only the fields you changed, each complete}, "notes": "one sentence on what changed"}`),
        user(`Current card:\n${draftText(draft)}\n\nRequest: ${req.instruction.trim()}`),
      ];
    case 'field':
      return [
        sys(`Write the "${label(req.field)}" field (${STUDIO_FIELDS.find((f) => f.key === req.field)!.hint}). Fit it to the rest of the card.\nReply with only the field's text${LIST_FIELDS.has(req.field) ? ', one item per line' : ''}, no heading or commentary.`),
        user(`Card so far:\n${draftText(draft)}${req.instruction?.trim() ? `\n\nAlso: ${req.instruction.trim()}` : ''}`),
      ];
    case 'revise':
      return [
        sys('Rewrite only the marked passage as asked, so it still fits the text around it. Reply with only the replacement passage: no quotes, no commentary.'),
        user(`Card:\n${draftText(draft)}\n\nIn the ${label(req.field)} field, rewrite this passage:\n<<<\n${req.selection}\n>>>\nHow: ${req.instruction.trim()}`),
      ];
  }
}

function draftHas(d: Draft) {
  return STUDIO_FIELDS.some(({ key }) => (Array.isArray(d[key]) ? (d[key] as string[]).length : String(d[key] ?? '').trim()));
}

/** Strips a wrapping code fence or quotes a model sometimes adds around plain text. */
function plain(text: string): string {
  let t = text.trim();
  const fence = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(t);
  if (fence) t = fence[1]!.trim();
  if (/^(["“])[\s\S]*(["”])$/.test(t) && !t.slice(1, -1).includes('"')) t = t.slice(1, -1).trim();
  return t.replace(/^<<<\n?|\n?>>>$/g, '').trim();
}

const str = (v: unknown, max = 20000) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const list = (v: unknown, max = 40, sep: RegExp = /\n/) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(sep) : [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, max);

/** Keeps only known fields, with the right types. */
export function cleanCardPatch(raw: unknown): Partial<CardData> {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<CardData> = {};
  for (const { key } of STUDIO_FIELDS) {
    if (!(key in r)) continue;
    if (key === 'tags') out.tags = list(r.tags, 20, /[\n,]/).map((t) => t.toLowerCase().replace(/^#/, '').slice(0, 40));
    else if (key === 'alternate_greetings') out.alternate_greetings = list(r.alternate_greetings, 20);
    else {
      const v = str(r[key]);
      if (v !== undefined) (out as any)[key] = key === 'name' ? v.trim().slice(0, 120) : v.trim();
    }
  }
  return out;
}

export function parseStudioReply(req: StudioRequest, text: string): StudioResult {
  switch (req.mode) {
    case 'brainstorm': {
      const j = extractJson<{ ideas?: unknown }>(text);
      const raw = j.ok && Array.isArray(j.value?.ideas) ? j.value.ideas : [];
      const ideas = raw
        .map((x: any) => ({ title: String(x?.title ?? '').trim().slice(0, 80), pitch: String(x?.pitch ?? '').trim().slice(0, 600) }))
        .filter((x) => x.title && x.pitch)
        .slice(0, 8);
      if (!ideas.length) throw new Error('The model did not return any ideas');
      return { mode: 'brainstorm', ideas };
    }
    case 'create':
    case 'refine': {
      const j = extractJson<{ card?: unknown; notes?: unknown }>(text);
      if (!j.ok) throw new Error('The model did not return a card');
      const card = cleanCardPatch(j.value?.card ?? j.value);
      if (!Object.keys(card).length) throw new Error('The model did not change anything');
      if (req.mode === 'create' && !card.name) throw new Error('The model did not name the character');
      return { mode: req.mode, card, notes: String(j.value?.notes ?? '').slice(0, 300) };
    }
    case 'field': {
      const t = plain(text);
      if (!t) throw new Error('The model returned nothing');
      return { mode: 'field', field: req.field, value: LIST_FIELDS.has(req.field) ? cleanCardPatch({ [req.field]: t })[req.field as 'tags'] ?? [] : req.field === 'name' ? t.split('\n')[0]!.slice(0, 120) : t };
    }
    case 'revise': {
      const t = plain(text);
      if (!t) throw new Error('The model returned nothing');
      return { mode: 'revise', field: req.field, text: t };
    }
  }
}
