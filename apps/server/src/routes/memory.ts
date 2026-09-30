import { contentWords, formatClock, formatDate, HeardIndex, openConflicts, PLAYER, scoreMemory, knowledgeOf, type CampaignState } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { listCalls } from '../services/calls.js';
import { chronicleStatus } from '../services/chronicle.js';
import { getState } from '../services/campaigns.js';
import { characterRefs } from '../services/campaigns.js';
import { getChat, getGroup, listMessages } from '../services/chats.js';
import { lastPromptFor, previewPrompt } from '../services/generate.js';
import {
  deleteMemory,
  deleteSummary,
  insertMemory,
  lastRecall,
  lexicalScores,
  loadMemoryState,
  namedIn,
  nameOfPerson,
  presentIds,
  resolveConflict,
  scopeOf,
  updateFact,
  updateMemory,
  updateSummary,
  type MemoryRow,
} from '../services/mem.js';
import { defaultPersona, getPersona } from '../services/personas.js';
import { parse } from '../util/validate.js';

function namesFor(ctx: AppContext, o: string, chat: ReturnType<typeof getChat>) {
  let player = 'You';
  try {
    player = (chat.personaId ? getPersona(ctx, o, chat.personaId) : defaultPersona(ctx, o))?.name ?? 'You';
  } catch {
    /* default */
  }
  const refs = characterRefs(ctx, o);
  const ids = chat.groupId ? getGroup(ctx, o, chat.groupId).members.map((m) => m.characterId) : chat.characterId ? [chat.characterId] : [];
  return { player, characters: refs.filter((r) => ids.includes(r.id)), cardIds: ids };
}

function safeState(ctx: AppContext, o: string, campaignId: string | null): CampaignState | null {
  if (!campaignId) return null;
  try {
    return getState(ctx, o, campaignId);
  } catch {
    return null;
  }
}

export function registerMemory(app: FastifyInstance, ctx: AppContext) {
  /** Timeline, facts, conflicts and summaries for a chat's memory scope. */
  app.get('/api/chats/:id/memory', async (req) => {
    const o = owner(req);
    const chat = getChat(ctx, o, (req.params as { id: string }).id);
    const q = req.query as { q?: string; viewer?: string; include?: string };
    const state = safeState(ctx, o, chat.campaignId);
    const names = namesFor(ctx, o, chat);
    const mem = loadMemoryState(ctx, o, scopeOf(chat));
    const heard = new HeardIndex(mem.heard);
    const person = (id: string) => ({ id, name: nameOfPerson(state, id, names) });
    const sceneIds = new Set(mem.scenes.map((s) => s.id));
    const folded = new Set(mem.all.filter((m) => m.foldedInto && sceneIds.has(m.foldedInto)).map((m) => m.id));
    let list: MemoryRow[] = q.include === 'active' ? mem.all.filter((m) => !m.forgotten) : mem.all;
    if (q.q?.trim()) {
      const hits = lexicalScores(ctx, o, scopeOf(chat), q.q, new Set(list.map((m) => m.id)), 200);
      const words = contentWords(q.q);
      list = list.filter((m) => hits.has(m.id) || [...words].some((w) => m.text.toLowerCase().includes(w)));
    }
    if (q.viewer) list = list.filter((m) => knowledgeOf(q.viewer!, m, heard) !== null);
    const people = new Set<string>([PLAYER, ...(state ? Object.keys(state.npcs) : []), ...names.cardIds.map((id) => `char:${id}`)]);
    const heardBy = new Map<string, Array<{ id: string; distortion: number }>>();
    for (const h of mem.heard) (heardBy.get(h.memoryId) ?? heardBy.set(h.memoryId, []).get(h.memoryId)!).push({ id: h.viewer, distortion: h.distortion });
    const cal = state?.meta.calendar;
    return {
      people: [...people].map(person).filter((p) => p.name !== 'Someone' || p.id === PLAYER),
      items: list
        .slice()
        .reverse()
        .map((m) => ({
          id: m.id,
          text: m.text,
          kind: m.kind,
          importance: m.importance,
          secret: m.secret,
          pinned: m.pinned,
          forgotten: m.forgotten,
          folded: folded.has(m.id),
          edited: m.edited,
          source: m.source,
          messageId: m.messageId,
          gameTime: m.gameTime,
          when: cal ? `${formatDate(m.gameTime, cal, '{mon} {day}')}, ${formatClock(m.gameTime, cal)}` : null,
          place: m.locationId && state ? state.locations[m.locationId]?.name ?? null : null,
          participants: m.participants.map(person),
          witnesses: m.witnesses.map(person),
          heardBy: (heardBy.get(m.id) ?? []).map((h) => ({ ...person(h.id), distortion: h.distortion })),
        })),
      facts: mem.facts
        .slice()
        .reverse()
        .map((f) => ({ id: f.id, entityId: f.entityId, entityName: f.entityName, key: f.key, value: f.value, text: f.text, status: f.status, source: f.source, cite: f.cite, supersedes: f.supersedes ?? null })),
      conflicts: openConflicts(mem.facts.filter((f) => f.status === 'conflict' || mem.facts.some((x) => x.conflictsWith === f.id && x.status === 'conflict'))).map((c) => ({ claim: { id: c.claim.id, text: c.claim.text, value: c.claim.value, entityName: c.claim.entityName, key: c.claim.key }, against: c.against ? { id: c.against.id, text: c.against.text, value: c.against.value } : null })),
      summaries: mem.summaries
        .slice()
        .reverse()
        .map((s) => ({ id: s.id, level: s.level, title: s.title, text: s.text, importance: s.importance, edited: s.edited, fromTime: s.fromTime, toTime: s.toTime })),
    };
  });

  /** How far the chronicler has read. */
  app.get('/api/chats/:id/memory/status', async (req) => chronicleStatus(ctx, owner(req), (req.params as { id: string }).id));

  /** A note the player writes by hand: never tied to a message, so swipes don't remove it. */
  app.post('/api/chats/:id/memory', async (req) => {
    const o = owner(req);
    const chat = getChat(ctx, o, (req.params as { id: string }).id);
    const b = parse(z.object({ text: z.string().trim().min(3).max(1200), importance: z.number().int().min(1).max(3).default(2), about: z.array(z.string().max(80)).max(12).default([]), witnesses: z.array(z.string().max(80)).max(40).optional(), secret: z.boolean().default(false) }), req.body);
    const state = safeState(ctx, o, chat.campaignId);
    const names = namesFor(ctx, o, chat);
    const present = presentIds(state, names.cardIds);
    const m = insertMemory(ctx, o, scopeOf(chat), { chatId: chat.id, messageId: null, swipeId: null }, 'user', {
      text: b.text,
      participants: b.about,
      witnesses: b.witnesses?.length ? b.witnesses : present,
      locationId: state?.currentLocationId ?? null,
      gameTime: state?.time.minutes ?? 0,
      importance: b.importance as 1 | 2 | 3,
      secret: b.secret,
    });
    ctx.bus.publish(o, 'memory.changed', { chatId: chat.id, campaignId: chat.campaignId }, req.clientId);
    return { id: m.id };
  });

  app.patch('/api/memory/items/:id', async (req) => {
    const o = owner(req);
    const b = parse(z.object({ text: z.string().max(1200).optional(), pinned: z.boolean().optional(), forgotten: z.boolean().optional(), importance: z.number().int().min(1).max(3).optional(), secret: z.boolean().optional(), witnesses: z.array(z.string().max(80)).max(40).optional(), participants: z.array(z.string().max(80)).max(40).optional() }), req.body);
    const m = updateMemory(ctx, o, (req.params as { id: string }).id, b);
    ctx.bus.publish(o, 'memory.changed', { chatId: m.chatId }, req.clientId);
    return { ok: true };
  });

  app.delete('/api/memory/items/:id', async (req) => {
    const o = owner(req);
    deleteMemory(ctx, o, (req.params as { id: string }).id);
    ctx.bus.publish(o, 'memory.changed', {}, req.clientId);
    return { ok: true };
  });

  app.patch('/api/memory/facts/:id', async (req) => {
    const b = parse(z.object({ text: z.string().max(600).optional(), value: z.string().max(200).optional(), retracted: z.boolean().optional() }), req.body);
    updateFact(ctx, owner(req), (req.params as { id: string }).id, b);
    ctx.bus.publish(owner(req), 'memory.changed', {}, req.clientId);
    return { ok: true };
  });

  app.post('/api/memory/facts/:id/resolve', async (req) => {
    const b = parse(z.object({ choice: z.enum(['keep-old', 'use-new', 'both']) }), req.body);
    resolveConflict(ctx, owner(req), (req.params as { id: string }).id, b.choice);
    ctx.bus.publish(owner(req), 'memory.changed', {}, req.clientId);
    return { ok: true };
  });

  app.patch('/api/memory/summaries/:id', async (req) => {
    const b = parse(z.object({ text: z.string().trim().min(1).max(4000) }), req.body);
    updateSummary(ctx, owner(req), (req.params as { id: string }).id, b.text);
    return { ok: true };
  });

  app.delete('/api/memory/summaries/:id', async (req) => {
    deleteSummary(ctx, owner(req), (req.params as { id: string }).id);
    return { ok: true };
  });

  /** "Why was this recalled?" — the score breakdown against the current scene, per viewer who knows it. */
  app.get('/api/chats/:id/memory/why/:itemId', async (req) => {
    const o = owner(req);
    const { id, itemId } = req.params as { id: string; itemId: string };
    const chat = getChat(ctx, o, id);
    const state = safeState(ctx, o, chat.campaignId);
    const names = namesFor(ctx, o, chat);
    const mem = loadMemoryState(ctx, o, scopeOf(chat));
    const m = mem.all.find((x) => x.id === itemId);
    if (!m) throw new HttpError(404, 'Memory not found');
    // Scored exactly as the last recall scored it (same lexical, semantic and name signals);
    // before any recall, against the last few messages.
    const present = presentIds(state, names.cardIds);
    let rctx = lastRecall.get(chat.id)?.ctx;
    if (!rctx) {
      const recent = listMessages(ctx, o, chat.id)
        .filter((x) => !x.hidden)
        .slice(-3)
        .map((x) => x.swipes[x.swipeId]?.text ?? '')
        .join('\n');
      const n = namedIn(state, recent);
      rctx = { now: state?.time.minutes ?? 0, present, locationId: state?.currentLocationId ?? null, lexical: lexicalScores(ctx, o, scopeOf(chat), recent, new Set(mem.items.map((x) => x.id))), named: n.people, namedPlaces: n.places };
    }
    const score = scoreMemory(m, rctx);
    const heard = new HeardIndex(mem.heard);
    const last = lastRecall.get(chat.id);
    const usedFor = last
      ? [...(last.result.player.some((r) => r.m.id === itemId) ? [PLAYER] : []), ...last.result.people.filter((p) => [...p.knows, ...p.heard].some((r) => r.m.id === itemId)).map((p) => p.id), ...last.result.people.filter((p) => p.doesNotKnow.some((r) => r.m.id === itemId)).map((p) => `not:${p.id}`)]
      : [];
    return {
      score,
      inLastPrompt: usedFor.map((v) => (v.startsWith('not:') ? { viewer: nameOfPerson(state, v.slice(4), names), as: 'does not know' } : { viewer: nameOfPerson(state, v, names), as: v === PLAYER ? 'story so far' : 'knows' })),
      knownBy: present.map((p) => ({ name: nameOfPerson(state, p, names), knowledge: knowledgeOf(p, m, heard)?.kind ?? null })),
      semanticNote: 'Embedding similarity is included in the live score when an embeddings connection is set.',
    };
  });

  /** The model call log for a chat (or everything). */
  app.get('/api/calls', async (req) => {
    const q = req.query as { chatId?: string; messageId?: string; limit?: string };
    return listCalls(ctx, owner(req), { chatId: q.chatId, messageId: q.messageId, limit: q.limit ? Number(q.limit) : 200 });
  });

  /** The exact scene block from the last request (byte-identical), or a fresh preview. */
  app.get('/api/chats/:id/scene', async (req) => {
    const o = owner(req);
    const chatId = (req.params as { id: string }).id;
    getChat(ctx, o, chatId);
    const last = lastPromptFor(chatId) as any;
    if (last?.scene && (req.query as any).fresh !== '1') return { source: 'last request', at: last.at, ...last.scene };
    const p = await previewPrompt(ctx, o, chatId);
    return { source: 'preview', at: p.at, ...(p.scene ?? { text: '', tokens: 0, dropped: [] }) };
  });
}
