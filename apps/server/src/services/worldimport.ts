/**
 * Build a world from a lorebook (and optionally the character card): the utility model proposes
 * places, people, groups and facts; the owner reviews them; the chosen ones are applied as the
 * player's own ops (logged and undoable).
 */
import { extractJson, validateOps, type Op } from '@everloom/engine';
import type { AppContext } from '../context.js';
import { HttpError } from '../context.js';
import { completeChat } from '../llm/providers.js';
import { logged, promptTokens } from './calls.js';
import { getCharacter } from './characters.js';
import { getChat } from './chats.js';
import { connectionForRole } from './connections.js';
import { getLorebook } from './lorebooks.js';

export interface ImportProposal {
  id: string;
  kind: 'place' | 'person' | 'group' | 'fact';
  label: string;
  detail: string;
  op: Op;
}

export async function proposeWorld(ctx: AppContext, owner: string, chatId: string, input: { lorebookId?: string | null; includeCard?: boolean }): Promise<ImportProposal[]> {
  const chat = getChat(ctx, owner, chatId);
  if (!chat.campaignId) throw new HttpError(400, 'This chat has no game world');
  const conn = connectionForRole(ctx, owner, 'utility');
  if (!conn) throw new HttpError(400, 'Add a connection first');
  const parts: string[] = [];
  if (input.lorebookId) {
    const book = getLorebook(ctx, owner, input.lorebookId);
    for (const e of Object.values(book.book.entries ?? {})) if (!e.disable && e.content?.trim()) parts.push(`## ${e.comment || (e.key ?? []).join(', ')}\n${e.content.trim()}`);
  }
  if (input.includeCard && chat.characterId) {
    const c = getCharacter(ctx, owner, chat.characterId);
    parts.push(`## Character: ${c.name}\n${[c.card.description, c.card.scenario].filter(Boolean).join('\n')}`);
  }
  const source = parts.join('\n\n').slice(0, 24000);
  if (!source.trim()) throw new HttpError(400, 'Nothing to read: pick a lorebook with entries, or include the card');
  const messages = [
    { role: 'system' as const, content: 'You turn setting notes into a structured game world. Output JSON only.' },
    {
      role: 'user' as const,
      content: `${source}

From these notes only (invent nothing), list:
{"places":[{"name":"","parent":"larger place it is inside, or null","kind":"city|district|building|room|landmark|wilderness|other","description":"one sentence"}],
 "people":[{"name":"","role":"","location":"a place above, or null","description":"one sentence"}],
 "groups":[{"name":"","type":"","purpose":"one sentence","location":"a place above, or null"}],
 "facts":["standing truths about the world, one sentence each"]}
At most 20 places, 20 people, 10 groups, 12 facts.`,
    },
  ];
  const r = await logged(ctx, owner, conn, { chatId, purpose: 'world import', role: 'utility' }, promptTokens(messages), () =>
    completeChat(conn, { messages, overrides: { temperature: 0.2, max_tokens: 2500, reasoning: false, stop: [] }, signal: AbortSignal.timeout(180_000) }),
  );
  const out = extractJson<{ places?: any[]; people?: any[]; groups?: any[]; facts?: any[] }>(r.text);
  if (!out.ok || !out.value) throw new HttpError(502, 'The model did not return a usable world');
  const v = out.value;
  const str = (x: unknown, n = 300) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
  const kinds = ['city', 'district', 'building', 'room', 'landmark', 'wilderness', 'other'];
  const raw: Array<Omit<ImportProposal, 'id' | 'op'> & { op: unknown }> = [];
  // Parents first, so children can attach to them.
  const places = (Array.isArray(v.places) ? v.places : []).slice(0, 20).filter((p) => str(p?.name));
  places.sort((a, b) => (str(a.parent) ? 1 : 0) - (str(b.parent) ? 1 : 0));
  for (const p of places) raw.push({ kind: 'place', label: str(p.name, 80), detail: str(p.description), op: { type: 'location.upsert', name: str(p.name, 80), ...(str(p.parent) ? { parent: str(p.parent, 80) } : {}), ...(kinds.includes(p.kind) ? { kind: p.kind } : {}), ...(str(p.description) ? { description: str(p.description, 600) } : {}) } });
  for (const g of (Array.isArray(v.groups) ? v.groups : []).slice(0, 10)) if (str(g?.name)) raw.push({ kind: 'group', label: str(g.name, 80), detail: str(g.purpose), op: { type: 'org.upsert', name: str(g.name, 80), ...(str(g.type) ? { orgType: str(g.type, 60) } : {}), ...(str(g.purpose) ? { purpose: str(g.purpose, 600) } : {}), ...(str(g.location) ? { location: str(g.location, 80) } : {}) } });
  for (const p of (Array.isArray(v.people) ? v.people : []).slice(0, 20)) if (str(p?.name)) raw.push({ kind: 'person', label: str(p.name, 80), detail: [str(p.role, 60), str(p.description)].filter(Boolean).join(' — '), op: { type: 'npc.upsert', name: str(p.name, 80), ...(str(p.role) ? { role: str(p.role, 60) } : {}), ...(str(p.description) ? { appearance: str(p.description, 600) } : {}), ...(str(p.location) ? { location: str(p.location, 80) } : {}) } });
  for (const f of (Array.isArray(v.facts) ? v.facts : []).slice(0, 12)) if (str(f)) raw.push({ kind: 'fact', label: str(f, 120), detail: '', op: { type: 'databank.add', text: str(f, 600) } });
  // Only ops that pass the normal rules.
  const out2: ImportProposal[] = [];
  raw.forEach((x, i) => {
    const op = validateOps([x.op]).ok[0];
    if (op) out2.push({ ...x, id: `p${i}`, op });
  });
  return out2;
}
