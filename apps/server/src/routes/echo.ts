/**
 * ECHO inspector API: settings per chat, the character knowledge viewer, provenance, timeline at
 * an earlier moment, undetermined facts (with pre-decided twists), the leakage debugger, the
 * manual editor (message-bound ops with an audit history), the recall tool and migration.
 *
 * Spoiler guard: views that show more than one character's knowledge (omniscient, the truth of a
 * belief, pre-decided twists) need `spoilers=1`.
 */
import { echo, PLAYER } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { getChat, listMessages, updateChat } from '../services/chats.js';
import {
  addManualEvents,
  addOp,
  atLeast,
  chatNames,
  echoPacketFor,
  echoCacheStats,
  echoSettings,
  ECHO_PROFILES,
  globalEcho,
  invalidateEcho,
  migrateLegacy,
  PROFILE_FOR_PRESET,
  projectionFor,
  removeOp,
  revertMigration,
  searchCharacterMemory,
  setGlobalEcho,
} from '../services/echo.js';
import { parse } from '../util/validate.js';

const SettingsBody = z.object({
  profile: z.enum(ECHO_PROFILES as [string, ...string[]]).optional(),
  narration: z.enum(['character', 'persona', 'omniscient']).optional(),
  budget: z.number().int().min(100).max(2000).optional(),
  tunneling: z.boolean().optional(),
  drift: z.boolean().optional(),
  depth: z.union([z.literal(2), z.literal(3)]).optional(),
  semantic: z.boolean().optional(),
  historyNotes: z.boolean().optional(),
  guard: z.enum(['off', 'flag', 'repair']).optional(),
  characterFirst: z.boolean().optional(),
});

const OpBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('predecide'), s: z.string().min(1).max(80), p: z.string().min(1).max(60), value: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('retract-belief'), beliefId: z.string().min(1).max(400) }),
  z.object({ kind: z.literal('suppress'), unitId: z.string().min(1).max(400) }),
  z.object({ kind: z.literal('forget'), unitId: z.string().min(1).max(400) }),
  z.object({ kind: z.literal('drift'), unitId: z.string().min(1).max(400), note: z.string().min(1).max(200) }),
]);

const yes = (v: unknown) => v === '1' || v === 'true';

export function registerEcho(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/echo/settings', async (req) => ({ ...globalEcho(ctx, owner(req)), suggested: PROFILE_FOR_PRESET }));
  app.patch('/api/echo/settings', async (req) => setGlobalEcho(ctx, owner(req), parse(SettingsBody, req.body) as never));

  /** The chat's ECHO state: profile, counts, open issues. */
  app.get('/api/chats/:id/echo', async (req) => {
    const o = owner(req);
    const chat = getChat(ctx, o, (req.params as { id: string }).id);
    const s = echoSettings(ctx, o, chat);
    if (!atLeast(s.profile, 'fast')) return { settings: s, on: false };
    const { proj, leaf } = projectionFor(ctx, o, chat);
    const issues = listMessages(ctx, o, chat.id).flatMap((m) => ((m.extra?.echoIssues as echo.ValidationIssue[] | undefined) ?? []).map((i) => ({ ...i, messageId: m.id })));
    return {
      settings: s,
      on: true,
      leaf,
      counts: { events: proj.order.length, units: proj.units.length, beliefs: [...proj.beliefs.values()].filter((b) => b.status === 'in').length, hypotheses: proj.hypotheses.size, undetermined: [...proj.undetermined.values()].filter((u) => u.status !== 'collapsed').length },
      actors: [...new Set(proj.units.map((u) => u.owner))].map((id) => ({ id, name: proj.name(id) })),
      violations: proj.violations,
      issues,
      cache: echoCacheStats,
    };
  });

  app.patch('/api/chats/:id/echo', async (req) => {
    const o = owner(req);
    const chat = getChat(ctx, o, (req.params as { id: string }).id);
    const body = parse(SettingsBody, req.body);
    const next = updateChat(ctx, o, chat.id, { metadata: { echo: { ...(chat.metadata.echo ?? {}), ...body } } });
    invalidateEcho(chat.id);
    return echoSettings(ctx, o, next);
  });

  /** Character knowledge viewer. `at` = a story seq for "what did they know then". */
  app.get('/api/chats/:id/echo/knowledge/:actor', async (req) => {
    const o = owner(req);
    const { id, actor } = req.params as { id: string; actor: string };
    const q = req.query as { at?: string; spoilers?: string };
    const chat = getChat(ctx, o, id);
    const { proj, leaf } = projectionFor(ctx, o, chat);
    const omni = actor === 'all';
    if (omni && !yes(q.spoilers)) throw new HttpError(403, 'The omniscient view is behind the spoiler guard');
    const view = echo.authorize(proj, { actorId: omni ? 'narrator' : actor, storyId: chat.id, leaf, atSeq: q.at !== undefined ? Number(q.at) : undefined, accessScope: omni ? 'omniscient' : actor === PLAYER ? 'persona-narrator' : 'actor' });
    return {
      actor,
      name: omni ? 'Everyone' : proj.name(actor),
      memories: view.units.map((u) => ({ id: u.id, l0: u.l0, l1: u.l1, level: u.level, kind: u.kind, status: u.status, seq: u.seq, at: u.occurredAt, importance: u.importance, drift: u.drift, quote: u.quote })),
      beliefs: view.beliefs.map((b) => ({ ...b, line: echo.beliefLine(b, proj.cfg.names), truth: yes(q.spoilers) ? b.truth : undefined })),
      doubted: view.doubted,
      hypotheses: view.hypotheses.map((h) => ({ id: h.id, question: h.question, status: h.status, options: h.options.map((x) => ({ label: x.label, amplitude: Math.round(x.amplitude * 1000) / 1000 })), history: h.history })),
      higher: view.higher.map((h) => ({ id: h.id, text: h.text, depth: h.depth })),
      commitments: view.commitments,
      relations: view.relations,
      unknowns: view.unknowns,
      common: view.common,
    };
  });

  /** Provenance: "Anna's claim → Ben heard it → Ben told Daniel → Daniel believes it". */
  app.get('/api/chats/:id/echo/provenance', async (req) => {
    const o = owner(req);
    const chat = getChat(ctx, o, (req.params as { id: string }).id);
    const { beliefId, spoilers } = req.query as { beliefId?: string; spoilers?: string };
    if (!beliefId) throw new HttpError(400, 'beliefId is required');
    const { proj } = projectionFor(ctx, o, chat);
    const b = proj.beliefs.get(beliefId);
    if (!b) throw new HttpError(404, 'No such belief');
    const chain: string[] = [];
    const via = [...b.via].reverse();
    if (via.length) {
      chain.push(`${proj.name(via[0])}'s claim`);
      for (let i = 1; i < via.length; i++) chain.push(`${proj.name(via[i - 1])} told ${proj.name(via[i])}`);
      chain.push(`${proj.name(via[via.length - 1])} told ${proj.name(b.owner)}`);
    } else chain.push(b.mode === 'observed' ? `${proj.name(b.owner)} saw it` : `${proj.name(b.owner)} concluded it`);
    chain.push(`${proj.name(b.owner)} ${b.status === 'in' ? 'believes it' : `no longer believes it (${b.outReason})`}`);
    const supports = b.supports.map((s) => ({ id: s, holds: s.startsWith('bel:') ? proj.beliefs.get(s)?.status === 'in' : true, text: s.startsWith('bel:') ? proj.beliefs.get(s)?.text : undefined }));
    return { belief: { ...b, truth: yes(spoilers) ? (proj.isCanonical(b.prop) ? 'true' : 'unknown or false') : undefined }, chain, supports };
  });

  /** Undetermined facts: constraints, candidates, and pre-deciding a twist (spoiler-guarded values). */
  app.get('/api/chats/:id/echo/undetermined', async (req) => {
    const o = owner(req);
    const chat = getChat(ctx, o, (req.params as { id: string }).id);
    const spoil = yes((req.query as { spoilers?: string }).spoilers);
    const { proj } = projectionFor(ctx, o, chat);
    return [...proj.undetermined.values()].map((u) => ({ key: u.key, label: u.label, status: u.status, constraints: u.constraints, possible: spoil ? proj.possible(u.key) : undefined, value: spoil || u.status === 'collapsed' ? u.value : undefined }));
  });

  /** The manual editor: corrections and decisions as ops (message-bound when `messageId` is given). */
  app.post('/api/chats/:id/echo/ops', async (req) => {
    const o = owner(req);
    const id = (req.params as { id: string }).id;
    const body = req.body as { messageId?: string | null };
    const op = parse(OpBody, req.body);
    const msg = body.messageId ? listMessages(ctx, o, id).find((m) => m.id === body.messageId) : null;
    if (body.messageId && !msg) throw new HttpError(400, 'That message is not in this chat');
    const r = addOp(ctx, o, id, op as never, { messageId: msg?.id ?? null, swipeId: msg?.swipeId ?? null });
    invalidateEcho(id);
    return r;
  });
  app.delete('/api/chats/:id/echo/ops/:opId', async (req) => {
    const o = owner(req);
    const { id, opId } = req.params as { id: string; opId: string };
    removeOp(ctx, o, id, opId);
    invalidateEcho(id);
    return { ok: true };
  });
  app.get('/api/chats/:id/echo/audit', async (req) => {
    const o = owner(req);
    const chat = getChat(ctx, o, (req.params as { id: string }).id);
    return ctx.db.prepare('SELECT action, detail, created_at FROM echo_audit WHERE chat_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT 200').all(chat.id, o);
  });

  /** Author-written events (and test fixtures). */
  app.post('/api/chats/:id/echo/events', async (req) => {
    const o = owner(req);
    const id = (req.params as { id: string }).id;
    const body = req.body as { events?: unknown[]; messageId?: string | null };
    if (!Array.isArray(body?.events) || !body.events.length) throw new HttpError(400, 'events must be a non-empty list');
    const out = addManualEvents(ctx, o, id, body.events.slice(0, 20), body.messageId ?? null);
    invalidateEcho(id);
    return { events: out.map((e) => e.id) };
  });

  /** Leakage debugger: what a reply was given and why each line was authorized. */
  app.get('/api/chats/:id/echo/packets', async (req) => {
    const o = owner(req);
    const chat = getChat(ctx, o, (req.params as { id: string }).id);
    const { messageId } = req.query as { messageId?: string };
    const rows = (messageId
      ? ctx.db.prepare('SELECT * FROM echo_packets WHERE chat_id = ? AND owner_id = ? AND message_id = ?').all(chat.id, o, messageId)
      : ctx.db.prepare('SELECT * FROM echo_packets WHERE chat_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT 20').all(chat.id, o)) as Array<{ message_id: string; swipe_id: number; data: string; created_at: number }>;
    return rows.map((r) => ({ messageId: r.message_id, swipeId: r.swipe_id, at: r.created_at, ...JSON.parse(r.data) }));
  });

  /** The on-demand recall tool. The actor is the chat's current speaker, bound here. */
  app.post('/api/chats/:id/echo/recall', async (req) => {
    const body = parse(z.object({ query: z.string().min(1).max(300), temporal_hint: z.string().max(60).optional(), detail_level: z.enum(['gist', 'account', 'exact']).optional(), max_tokens: z.number().int().min(60).max(400).optional() }).strict(), req.body);
    return searchCharacterMemory(ctx, owner(req), (req.params as { id: string }).id, body);
  });

  /**
   * Prefetch: called (debounced) while the player types and right after a reply. Warms the
   * projection for the active leaf and compiles a packet for the draft, so the real turn finds
   * everything cached. Returns only timings and size, never content.
   */
  app.post('/api/chats/:id/echo/prefetch', async (req) => {
    const o = owner(req);
    const chat = getChat(ctx, o, (req.params as { id: string }).id);
    if (!atLeast(echoSettings(ctx, o, chat).profile, 'fast')) return { on: false };
    const draft = String((req.body as { draft?: string })?.draft ?? '').slice(0, 2000);
    const t0 = performance.now();
    projectionFor(ctx, o, chat);
    const t1 = performance.now();
    const msgs = listMessages(ctx, o, chat.id);
    const speaker = [...msgs].reverse().find((m) => m.role === 'assistant')?.characterId ?? chat.characterId ?? '';
    const recent = msgs.slice(-3).map((m) => m.swipes[m.swipeId]?.text ?? '').join('\n');
    const r = await echoPacketFor(ctx, o, chat, { speakerCardId: speaker, recentText: `${recent}\n${draft}`, focus: draft || undefined, seed: `prefetch:${msgs.length}`, chatCharacters: chatNames(ctx, o, chat).characters.map((c) => c.id) });
    return { on: true, projectionMs: Math.round((t1 - t0) * 100) / 100, packetMs: Math.round((performance.now() - t1) * 100) / 100, tokens: r?.packet.tokens ?? 0 };
  });

  app.post('/api/chats/:id/echo/migrate', async (req) => ({ migrated: migrateLegacy(ctx, owner(req), (req.params as { id: string }).id) }));
  app.delete('/api/chats/:id/echo/migrate', async (req) => ({ removed: revertMigration(ctx, owner(req), (req.params as { id: string }).id) }));
}
