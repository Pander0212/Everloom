/**
 * AI-assisted lorebook writing: propose several entries on a topic, or write/improve one entry.
 * Proposals are never saved directly; the person picks which to add.
 */
import { extractJson } from '../util/json-extract.js';
import type { WIEntry } from './types.js';

export interface LoreProposal {
  title: string;
  keys: string[];
  content: string;
  constant: boolean;
}

const GUIDE = `A lorebook entry is short background the story model sees only when one of its keys comes up in the chat.
- keys: 2–5 words or names a player would actually type when the subject comes up (names, nicknames, places, objects). Lowercase unless a proper noun.
- content: 40–150 words of plain facts written in third person, present tense; no story narration, no instructions to the model.
- constant: true only for a rule that should always be known (a world's magic system, the era); almost always false.
- Don't repeat what an existing entry already covers.`;

function context(opts: { bookName: string; existing: Array<Pick<WIEntry, 'comment' | 'key'>>; about?: string }) {
  const have = opts.existing.slice(0, 80).map((e) => `- ${e.comment || e.key[0] || 'untitled'}${e.key.length ? ` (keys: ${e.key.slice(0, 4).join(', ')})` : ''}`).join('\n');
  return `Lorebook: ${opts.bookName}${opts.about?.trim() ? `\nWhat the story is about:\n${opts.about.trim().slice(0, 3000)}` : ''}\nEntries it already has:\n${have || '(none yet)'}`;
}

export function buildLoreGenPrompt(opts: { topic: string; count: number; bookName: string; existing: Array<Pick<WIEntry, 'comment' | 'key'>>; about?: string }): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: `You write lorebook entries for a roleplay story.\n${GUIDE}\nReply with JSON only: {"entries": [{"title": "...", "keys": ["..."], "content": "...", "constant": false}]} with exactly ${opts.count} entries.` },
    { role: 'user', content: `${context(opts)}\n\nWrite ${opts.count} new entries about: ${opts.topic.trim()}` },
  ];
}

export function buildLoreEntryPrompt(opts: { entry: Pick<WIEntry, 'comment' | 'key' | 'content'>; instruction?: string; bookName: string; existing: Array<Pick<WIEntry, 'comment' | 'key'>>; about?: string }): Array<{ role: 'system' | 'user'; content: string }> {
  const e = opts.entry;
  const has = e.content.trim();
  return [
    { role: 'system', content: `You write lorebook entries for a roleplay story.\n${GUIDE}\nReply with JSON only: {"keys": ["..."], "content": "..."}` },
    {
      role: 'user',
      content: `${context({ ...opts, existing: opts.existing.filter((x) => x.comment !== e.comment) })}\n\n${has ? 'Improve' : 'Write'} the entry "${e.comment || e.key[0] || 'untitled'}"${e.key.length ? ` (keys so far: ${e.key.join(', ')})` : ''}.${has ? `\nCurrent text:\n${e.content}` : ''}${opts.instruction?.trim() ? `\nAlso: ${opts.instruction.trim()}` : ''}`,
    },
  ];
}

const keysOf = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
    .map((k) => String(k).trim())
    .filter((k) => k && k.length <= 60)
    .filter((k, i, a) => a.findIndex((x) => x.toLowerCase() === k.toLowerCase()) === i)
    .slice(0, 8);

/** Proposals with keys and content, minus near-copies of existing entries or of each other. */
export function parseLoreProposals(text: string, existing: Array<Pick<WIEntry, 'comment' | 'key'>> = []): LoreProposal[] {
  const j = extractJson<{ entries?: unknown[] }>(text);
  const raw = j.ok ? (Array.isArray(j.value) ? j.value : j.value?.entries) : null;
  if (!Array.isArray(raw)) throw new Error('The model did not return any entries');
  const taken = new Set(existing.map((e) => (e.comment || '').trim().toLowerCase()).filter(Boolean));
  const out: LoreProposal[] = [];
  for (const r of raw as any[]) {
    const title = String(r?.title ?? r?.comment ?? '').trim().slice(0, 120);
    const content = String(r?.content ?? '').trim().slice(0, 4000);
    const keys = keysOf(r?.keys ?? r?.key);
    if (!title || !content || taken.has(title.toLowerCase())) continue;
    taken.add(title.toLowerCase());
    out.push({ title, keys: keys.length ? keys : [title.toLowerCase()], content, constant: r?.constant === true });
  }
  if (!out.length) throw new Error('The model only suggested entries the book already has');
  return out;
}

export function parseLoreEntry(text: string): { keys: string[]; content: string } {
  const j = extractJson<{ keys?: unknown; content?: unknown }>(text);
  const content = j.ok ? String(j.value?.content ?? '').trim() : text.trim();
  if (!content) throw new Error('The model returned nothing');
  return { keys: j.ok ? keysOf(j.value?.keys) : [], content: content.slice(0, 4000) };
}
