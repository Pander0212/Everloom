/**
 * ECHO on the server: the event log (SQLite, message-bound), projection caching by active leaf,
 * the write path (tracker extraction → validated events), the read path (perspective → access
 * engine → recall → context packet), lifecycle hooks, migration and the leakage debugger records.
 *
 * Isolation rules kept here:
 * - The perspective is built from server state (chat, speaker, settings). No request or model
 *   argument can set the actor or the scope.
 * - Projections are cached by (chat, active leaf, live event ids, ops); a different leaf never
 *   reuses another leaf's projection (the access engine also refuses a mismatched leaf).
 * - Lexical scores are computed over the authorized view only (engine BM25), so no index shared
 *   across actors can rank, let alone return, anything outside the view.
 */
import { echo, formatClock, PLAYER, type CampaignState, type ChatDTO, type MessageDTO, type TrackerExtras } from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { completeChat, embed } from '../llm/providers.js';
import { sha256 } from '../security/crypto.js';
import { newId } from '../security/crypto.js';
import { getState } from './campaigns.js';
import { logged, promptTokens } from './calls.js';
import { getChat, getGroup, getMessage, listMessages } from './chats.js';
import { characterRefs } from './campaigns.js';
import { connectionForRole } from './connections.js';
import { nameOfPerson, personId, presentIds } from './mem.js';
import { defaultPersona, getPersona } from './personas.js';
import { getKv, setKv } from './settings.js';
import { settingsFor } from './features.js';

export type EchoProfile = 'off' | 'light' | 'fast' | 'balanced' | 'strict';
export type EchoNarration = 'character' | 'persona' | 'omniscient';
export const ECHO_PROFILES: EchoProfile[] = ['off', 'light', 'fast', 'balanced', 'strict'];
const RANK: Record<EchoProfile, number> = { off: 0, light: 1, fast: 2, balanced: 3, strict: 4 };
export const atLeast = (p: EchoProfile, min: EchoProfile) => RANK[p] >= RANK[min];
/** The profile each feature preset suggests (§11). ECHO itself stays off until chosen. */
export const PROFILE_FOR_PRESET: Record<string, EchoProfile> = { classic: 'off', story: 'fast', full: 'balanced' };

export interface EchoSettings {
  profile: EchoProfile;
  narration: EchoNarration;
  /** Packet budget in tokens. */
  budget: number;
  /** Involuntary recall (balanced and up by default). */
  tunneling: boolean;
  /** Subjective recollection drift overlays (off by default). */
  drift: boolean;
  /** Higher-order depth. */
  depth: 2 | 3;
  /** Semantic recall through the embeddings connection (behind the name shield). */
  semantic: boolean;
}

export const DEFAULT_ECHO: EchoSettings = { profile: 'off', narration: 'character', budget: 700, tunneling: true, drift: false, depth: 2, semantic: false };

export function globalEcho(ctx: AppContext, owner: string): EchoSettings {
  return { ...DEFAULT_ECHO, ...getKv<Partial<EchoSettings>>(ctx, owner, 'echo', {}) };
}

export function setGlobalEcho(ctx: AppContext, owner: string, patch: Partial<EchoSettings>): EchoSettings {
  const next = sanitize({ ...globalEcho(ctx, owner), ...patch });
  setKv(ctx, owner, 'echo', next);
  return next;
}

function sanitize(s: EchoSettings): EchoSettings {
  return {
    profile: ECHO_PROFILES.includes(s.profile) ? s.profile : 'off',
    narration: (['character', 'persona', 'omniscient'] as const).includes(s.narration) ? s.narration : 'character',
    budget: Math.max(100, Math.min(2000, Math.round(Number(s.budget) || 700))),
    tunneling: s.tunneling !== false,
    drift: s.drift === true,
    depth: s.depth === 3 ? 3 : 2,
    semantic: s.semantic === true,
  };
}

/** The chat's own choice wins over the global one; ECHO can be turned off per chat. */
export function echoSettings(ctx: AppContext, owner: string, chat: Pick<ChatDTO, 'metadata'>): EchoSettings {
  const own = (chat.metadata?.echo ?? {}) as Partial<EchoSettings>;
  return sanitize({ ...globalEcho(ctx, owner), ...own });
}

// ------------------------------------------------------------------ names and people

export interface ChatNames {
  player: string;
  characters: Array<{ id: string; name: string }>;
}

export function chatNames(ctx: AppContext, owner: string, chat: ChatDTO): ChatNames {
  let player = 'You';
  try {
    player = (chat.personaId ? getPersona(ctx, owner, chat.personaId) : defaultPersona(ctx, owner))?.name ?? 'You';
  } catch {
    /* default */
  }
  const ids = chat.groupId ? safe(() => getGroup(ctx, owner, chat.groupId!).members.map((m) => m.characterId), [] as string[]) : chat.characterId ? [chat.characterId] : [];
  const refs = characterRefs(ctx, owner);
  return { player, characters: refs.filter((r) => ids.includes(r.id)) };
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function stateOf(ctx: AppContext, owner: string, chat: ChatDTO): CampaignState | null {
  if (!chat.campaignId) return null;
  const { features } = settingsFor(ctx, owner, chat);
  return features.on.game ? safe(() => getState(ctx, owner, chat.campaignId!), null) : null;
}

/** id → display name for every person the chat knows. */
export function nameMap(state: CampaignState | null, names: ChatNames): Record<string, string> {
  const out: Record<string, string> = { [PLAYER]: names.player };
  for (const c of names.characters) out[`char:${c.id}`] = c.name;
  for (const n of Object.values(state?.npcs ?? {})) out[n.id] = n.name;
  for (const l of Object.values(state?.locations ?? {})) out[l.id] = l.name;
  return out;
}

function nameIndex(map: Record<string, string>): echo.NameIndex {
  return { entities: Object.fromEntries(Object.entries(map).filter(([id]) => id !== PLAYER).map(([id, n]) => [id, [n]])) };
}

/** The actor a character card speaks as: its NPC when linked, else char:<cardId>. */
export function actorForCard(state: CampaignState | null, cardId: string): string {
  const npc = state ? Object.values(state.npcs).find((n) => n.characterId === cardId) : undefined;
  return npc ? npc.id : `char:${cardId}`;
}

/** Who could perceive an event right now: everyone present, here, awake and attentive. */
export function observersNow(state: CampaignState | null, chatCharacters: string[]): echo.ObserverState[] {
  return presentIds(state, chatCharacters).map((actor) => {
    const npc = state?.npcs[actor];
    const awake = !npc || npc.status === 'alive';
    return { actor, place: 'here', sight: true, hearing: 'clear', awake, impairment: 0, attention: actor === PLAYER ? 1 : 0.85 };
  });
}

// ------------------------------------------------------------------ the log

interface EventRow {
  id: string;
  message_id: string | null;
  swipe_id: number | null;
  seq: number;
  source: string;
  data: string;
}

export function activePath(ctx: AppContext, chatId: string): Map<string, number> {
  const rows = ctx.db.prepare('SELECT id, swipe_id FROM messages WHERE chat_id = ? ORDER BY seq').all(chatId) as Array<{ id: string; swipe_id: number }>;
  return new Map(rows.map((r) => [r.id, r.swipe_id]));
}

function allEvents(ctx: AppContext, chatId: string): echo.EchoEvent[] {
  return (ctx.db.prepare('SELECT * FROM echo_events WHERE chat_id = ? ORDER BY seq, id').all(chatId) as EventRow[]).map((r) => JSON.parse(r.data) as echo.EchoEvent);
}

function liveOps(ctx: AppContext, chatId: string, path: Map<string, number>): echo.ManualOp[] {
  const rows = ctx.db.prepare('SELECT * FROM echo_ops WHERE chat_id = ? ORDER BY created_at, id').all(chatId) as Array<{ id: string; message_id: string | null; swipe_id: number | null; data: string }>;
  return echo.onBranch(rows.map((r) => ({ ...(JSON.parse(r.data) as echo.ManualOp), id: r.id, messageId: r.message_id, swipeId: r.swipe_id })), path) as echo.ManualOp[];
}

export interface Projection {
  proj: echo.Projector & { leaf: string; storyId: string };
  leaf: string;
  path: Map<string, number>;
  names: Record<string, string>;
  state: CampaignState | null;
  chatNames: ChatNames;
}

const cache = new Map<string, { leaf: string; ids: string[]; sig: string; proj: echo.Projector & { leaf: string; storyId: string } }>();
export const echoCacheStats = { hits: 0, incremental: 0, rebuilds: 0 };

export function invalidateEcho(chatId: string) {
  cache.delete(chatId);
}

/** The projection of the chat's active branch, cached by leaf and extended incrementally. */
export function projectionFor(ctx: AppContext, owner: string, chat: ChatDTO, opts: { excludeMessage?: { id: string; swipeId: number } } = {}): Projection {
  const state = stateOf(ctx, owner, chat);
  const cn = chatNames(ctx, owner, chat);
  const names = nameMap(state, cn);
  const path = activePath(ctx, chat.id);
  let live = echo.onBranch(allEvents(ctx, chat.id), path);
  if (opts.excludeMessage) live = live.filter((e) => !(e.messageId === opts.excludeMessage!.id && e.swipeId === opts.excludeMessage!.swipeId));
  const ops = liveOps(ctx, chat.id, path);
  const settings = echoSettings(ctx, owner, chat);
  const leaf = `${echo.leafKey(path)}${opts.excludeMessage ? `-x${opts.excludeMessage.id}:${opts.excludeMessage.swipeId}` : ''}`;
  const cfg: Partial<echo.ProjectorConfig> = { names, maxDepth: settings.depth };
  const sig = `${JSON.stringify(ops)}|${JSON.stringify(names)}|${settings.depth}`;
  const ids = live.map((e) => e.id);
  const tag = (p: echo.Projector) => Object.assign(p, { leaf, storyId: chat.id });
  const c = opts.excludeMessage ? undefined : cache.get(chat.id);
  let proj: echo.Projector & { leaf: string; storyId: string };
  if (c && c.sig === sig && c.ids.length <= ids.length && c.ids.every((id, i) => ids[i] === id)) {
    proj = c.proj;
    if (c.ids.length === ids.length) echoCacheStats.hits++;
    else {
      echoCacheStats.incremental++;
      for (const e of live.slice(c.ids.length)) proj.apply(e);
      proj.finish();
    }
    proj.leaf = leaf;
  } else {
    echoCacheStats.rebuilds++;
    proj = tag(echo.project(live, cfg, ops));
  }
  if (!opts.excludeMessage) cache.set(chat.id, { leaf, ids, sig, proj });
  return { proj, leaf, path, names, state, chatNames: cn };
}

function insertEvents(ctx: AppContext, owner: string, chatId: string, events: echo.EchoEvent[], source: string) {
  const ins = ctx.db.prepare('INSERT OR REPLACE INTO echo_events (id, owner_id, chat_id, message_id, swipe_id, seq, source, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const now = Date.now();
  for (const e of events) ins.run(e.id, owner, chatId, e.messageId, e.swipeId, e.seq, source, JSON.stringify(e), now);
}

function deleteEventsFor(ctx: AppContext, messageId: string, swipeId: number, sources: string[]) {
  const marks = sources.map(() => '?').join(',');
  ctx.db.prepare(`DELETE FROM echo_events WHERE message_id = ? AND swipe_id = ? AND source IN (${marks})`).run(messageId, swipeId, ...sources);
}

// ------------------------------------------------------------------ write path

export interface EchoWriteResult {
  events: number;
  rejected: number;
  issues: echo.ValidationIssue[];
}

function extractContext(ctx: AppContext, owner: string, chat: ChatDTO, m: MessageDTO, state: CampaignState | null, cn: ChatNames, source: echo.EchoEvent['provenance'] = 'extraction'): echo.ExtractContext {
  const chatChars = cn.characters.map((c) => c.id);
  return {
    storyId: chat.id,
    messageId: m.id,
    swipeId: m.swipeId,
    seqBase: m.seq,
    occurredAt: state?.time.minutes ?? m.seq * 5,
    recordedAt: Date.now(),
    locationId: state?.currentLocationId ?? 'scene',
    observers: observersNow(state, chatChars),
    sourceMessageIds: [m.id],
    resolve: (n) => personId(state, n, cn),
    provenance: source,
  };
}

/**
 * After a reply's tracker reading: its events (structured, when the model gave them; otherwise
 * the memory lines, deterministically) are validated against the projection before this message
 * and appended to the log, anchored to the message + swipe. Idempotent per message + swipe.
 */
export function writeTurnEcho(ctx: AppContext, owner: string, chatId: string, messageId: string, swipeId: number, extras: TrackerExtras): EchoWriteResult | null {
  const chat = getChat(ctx, owner, chatId);
  const settings = echoSettings(ctx, owner, chat);
  if (!atLeast(settings.profile, 'fast')) return null;
  const m = getMessage(ctx, owner, messageId);
  if (m.swipeId !== swipeId) return null;
  const state = stateOf(ctx, owner, chat);
  const cn = chatNames(ctx, owner, chat);
  const xc = extractContext(ctx, owner, chat, m, state, cn);
  let events: echo.EchoEvent[] = [];
  let rejected = 0;
  if (extras.events?.length) {
    const r = echo.parseEchoEvents(extras.events, xc);
    events = r.events;
    rejected = r.rejected;
  }
  // The memory lines still count when the model gave no structured events for them.
  if (!events.length) events = extras.memories.map((x, i) => echo.eventFromTrackedMemory(x, i, xc)).filter((e): e is echo.EchoEvent => !!e);
  let issues: echo.ValidationIssue[] = [];
  if (atLeast(settings.profile, 'balanced') && events.length) {
    const before = projectionFor(ctx, owner, chat, { excludeMessage: { id: m.id, swipeId } });
    issues = echo.validateTurn(before.proj, events, { narration: settings.narration, liveEventIds: new Set(before.proj.order) });
  }
  ctx.db.transaction(() => {
    deleteEventsFor(ctx, m.id, swipeId, ['turn']);
    insertEvents(ctx, owner, chat.id, events, 'turn');
    const extra = { ...m.extra } as Record<string, unknown>;
    if (issues.length) extra.echoIssues = issues;
    else delete extra.echoIssues;
    ctx.db.prepare('UPDATE messages SET extra = ? WHERE id = ?').run(JSON.stringify(extra), m.id);
  })();
  if (events.length) {
    ctx.bus.publish(owner, 'echo.changed', { chatId, messageId, events: events.length, issues: issues.length });
    // Deferred enrichment: vectors for the new memories, and a warm projection for the next turn.
    void enrichVectors(ctx, owner, chat).catch(() => {});
  }
  setImmediate(() => {
    try {
      projectionFor(ctx, owner, getChat(ctx, owner, chatId));
    } catch {
      /* the chat may be gone */
    }
  });
  return { events: events.length, rejected, issues };
}

/** Chats without the game layer have no tracker pass: one small extraction call does the same job. */
export async function runEchoExtraction(ctx: AppContext, owner: string, chatId: string, messageId: string): Promise<EchoWriteResult | null> {
  const chat = getChat(ctx, owner, chatId);
  if (!atLeast(echoSettings(ctx, owner, chat).profile, 'fast')) return null;
  const conn = connectionForRole(ctx, owner, 'utility');
  if (!conn) return null;
  const m = getMessage(ctx, owner, messageId);
  const swipeId = m.swipeId;
  const textAtStart = m.swipes[swipeId]?.text ?? '';
  const cn = chatNames(ctx, owner, chat);
  const recent = listMessages(ctx, owner, chatId).filter((x) => !x.hidden && x.seq <= m.seq).slice(-4);
  const system = `You are the ECHO extraction for a roleplay story. Read the latest turn and return ONLY JSON: {"events":[...]}.\n${echo.ECHO_EXTRACTION_PROMPT}\nPeople: ${[cn.player, ...cn.characters.map((c) => c.name)].join(', ')}. ${cn.player} is the player.`;
  const user = recent.map((x) => `${x.name}: ${(x.swipes[x.swipeId]?.text ?? '').slice(0, 2400)}`).join('\n\n');
  const messages = [{ role: 'system' as const, content: system }, { role: 'user' as const, content: user }];
  let text = '';
  try {
    const out = await logged(ctx, owner, conn, { chatId, messageId, purpose: 'echo extraction', role: 'utility' }, promptTokens(messages), () =>
      completeChat(conn, { messages, overrides: { temperature: 0.2, max_tokens: 900, stream: false, reasoning: false, stop: [] }, signal: AbortSignal.timeout(90_000) }),
    );
    text = out.text;
  } catch {
    return null;
  }
  const now = getMessage(ctx, owner, messageId);
  if (now.swipeId !== swipeId || (now.swipes[swipeId]?.text ?? '') !== textAtStart) return null;
  let events: unknown[] = [];
  try {
    const m0 = text.match(/\{[\s\S]*\}/);
    const v = m0 ? JSON.parse(m0[0]) : {};
    events = Array.isArray(v.events) ? v.events : [];
  } catch {
    events = [];
  }
  return writeTurnEcho(ctx, owner, chatId, messageId, swipeId, { memories: [], facts: [], events });
}

/** Author-written events (inspector, tests, imports). Anchored to a message of the chat, or always live. */
export function addManualEvents(ctx: AppContext, owner: string, chatId: string, raw: unknown[], messageId: string | null): echo.EchoEvent[] {
  const chat = getChat(ctx, owner, chatId);
  const state = stateOf(ctx, owner, chat);
  const cn = chatNames(ctx, owner, chat);
  const msgs = listMessages(ctx, owner, chatId);
  const m = messageId ? msgs.find((x) => x.id === messageId) : null;
  if (messageId && !m) throw new HttpError(400, 'That message is not in this chat');
  const last = msgs[msgs.length - 1];
  const xc = m ? extractContext(ctx, owner, chat, m, state, cn, 'manual') : { ...extractContext(ctx, owner, chat, last ?? ({ id: 'none', seq: 0, swipeId: 0 } as MessageDTO), state, cn, 'manual'), messageId: null, swipeId: null, seqBase: (last?.seq ?? 0) + 0.5 };
  const { events } = echo.parseEchoEvents(raw, xc);
  // Manual events may carry the full structured fields (observers, cues, claims…) directly.
  const full = events.map((e, i) => {
    const r = raw[i] as Partial<echo.EchoEvent> & Record<string, unknown>;
    const pick = <K extends keyof echo.EchoEvent>(k: K) => (r && r[k] !== undefined ? { [k]: r[k] } : {});
    // People may be given by name or id; either way they go through the resolver.
    const who = (x: unknown) => (typeof x === 'string' ? personId(state, x, cn) ?? x : String(x));
    const observers = Array.isArray(r?.observers) ? { observers: (r.observers as echo.ObserverState[]).map((o) => ({ ...o, actor: who(o.actor) })) } : {};
    const interceptors = Array.isArray(r?.interceptors) ? { interceptors: (r.interceptors as string[]).map(who) } : {};
    return { ...e, ...observers, ...interceptors, ...pick('cues'), ...pick('claims'), ...pick('establishes'), ...pick('commitment'), ...pick('commitmentUpdate'), ...pick('undetermined'), ...pick('constrains'), ...pick('infers'), ...pick('hypotheses'), ...pick('meta'), ...pick('relations'), ...pick('groupJoin'), ...pick('common'), ...pick('visibility'), ...(r?.sincere === false ? { sincere: false } : {}) } as echo.EchoEvent;
  });
  insertEvents(ctx, owner, chatId, full, 'manual');
  audit(ctx, owner, chatId, 'event.add', `${full.length} event(s)${messageId ? ` on ${messageId}` : ''}`);
  return full;
}

// ------------------------------------------------------------------ read path

export interface EchoPacketResult {
  packet: echo.ContextPacket;
  actor: string;
  scope: echo.AccessScope;
  leaf: string;
  /** Unit ids recalled (for reconsolidation). */
  recalled: string[];
}

function liveRecalls(ctx: AppContext, chatId: string, path: Map<string, number>): Map<string, { count: number; lastTime: number }> {
  const rows = ctx.db.prepare('SELECT message_id, swipe_id, unit_id, game_time FROM echo_recalls WHERE chat_id = ?').all(chatId) as Array<{ message_id: string; swipe_id: number; unit_id: string; game_time: number }>;
  const out = new Map<string, { count: number; lastTime: number }>();
  for (const r of rows) {
    if (path.get(r.message_id) !== r.swipe_id) continue;
    const cur = out.get(r.unit_id) ?? { count: 0, lastTime: -Infinity };
    out.set(r.unit_id, { count: cur.count + 1, lastTime: Math.max(cur.lastTime, r.game_time) });
  }
  return out;
}

function recentAffordances(ctx: AppContext, chatId: string, path: Map<string, number>): string[] {
  const rows = ctx.db.prepare('SELECT message_id, swipe_id, data FROM echo_packets WHERE chat_id = ? ORDER BY created_at DESC LIMIT 6').all(chatId) as Array<{ message_id: string; swipe_id: number; data: string }>;
  return rows.filter((r) => path.get(r.message_id) === r.swipe_id).slice(0, 3).flatMap((r) => (JSON.parse(r.data).affordances as string[]) ?? []);
}

const SENSORY = /\b(smell|smells|scent|aroma|perfume|stench|song|melody|tune|hum|humming|taste|tastes|bells?)\b/i;

/**
 * The context packet for the reply being written. The perspective is the speaking character's
 * (NPC builder), or the persona's (narrator builder), or omniscient — never chosen by the model.
 */
export async function echoPacketFor(
  ctx: AppContext,
  owner: string,
  chat: ChatDTO,
  opts: { speakerCardId: string; recentText: string; focus?: string; seed: string; chatCharacters: string[] },
): Promise<EchoPacketResult | null> {
  const settings = echoSettings(ctx, owner, chat);
  if (!atLeast(settings.profile, 'fast')) return null;
  const p = projectionFor(ctx, owner, chat);
  const { proj, names, state } = p;
  const scope: echo.AccessScope = settings.narration === 'persona' ? 'persona-narrator' : settings.narration === 'omniscient' ? 'omniscient' : 'actor';
  const actor = scope === 'persona-narrator' ? PLAYER : scope === 'omniscient' ? 'narrator' : actorForCard(state, opts.speakerCardId);
  const view = echo.authorize(proj, { actorId: actor, storyId: chat.id, leaf: p.leaf, accessScope: scope });
  const now = state?.time.minutes ?? proj.lastTime + 5;
  const qText = opts.focus ? `${opts.focus}\n${opts.recentText.slice(-600)}` : opts.recentText.slice(-1500);
  const query = echo.understand(qText, nameIndex(names), now);
  const loc = state?.currentLocationId ?? 'scene';
  const scene: echo.CompileInput['scene'] = {
    now,
    present: presentIds(state, opts.chatCharacters),
    locationId: loc,
    objects: state ? Object.values(state.inventory ?? {}).map((i) => i.name).slice(0, 20) : [],
    sensory: SENSORY.test(opts.focus ?? '') ? [opts.focus!] : [],
    ...(state ? { place: state.locations[loc]?.name, time: formatClock(state.time.minutes, state.meta.calendar) } : {}),
  };
  const semantic = settings.semantic ? await semanticSignals(ctx, owner, chat.id, view, actor, opts.focus || opts.recentText.slice(-800)) : undefined;
  const packet = echo.compilePacket({
    view,
    query,
    scene,
    names,
    ...(semantic?.size ? { signals: { semantic } } : {}),
    state: { recalls: liveRecalls(ctx, chat.id, p.path) },
    recall: { maxResults: 6, tunneling: { enabled: settings.tunneling && atLeast(settings.profile, 'balanced'), rate: 0.03, seed: opts.seed } },
    budget: settings.budget,
    recentAffordances: recentAffordances(ctx, chat.id, p.path),
    hypotheses: atLeast(settings.profile, 'balanced'),
    adjudication: scope === 'actor' ? undefined : { slots: [...proj.undetermined.values()], possible: (k) => proj.possible(k), seed: opts.seed },
  });
  return { packet, actor, scope, leaf: p.leaf, recalled: packet.recall.hits.map((h) => h.unit.id) };
}

/** After the reply is stored: what it was given (leakage debugger) and what it recalled (reconsolidation). */
export function recordPacket(ctx: AppContext, owner: string, chatId: string, messageId: string, swipeId: number, r: EchoPacketResult, gameTime: number) {
  const data = {
    actor: r.actor,
    scope: r.scope,
    leaf: r.leaf,
    tokens: r.packet.tokens,
    text: r.packet.text,
    lines: r.packet.lines.map((l) => ({ section: l.section, text: l.text, source: l.source, reason: l.reason })),
    dropped: r.packet.dropped,
    affordances: r.packet.affordances,
    recall: r.packet.recall.hits.map((h) => ({ unit: h.unit.id, score: Math.round(h.score * 1e4) / 1e4, why: h.why, involuntary: !!h.involuntary, accessibility: Math.round(h.accessibility * 100) / 100 })),
    timings: r.packet.recall.timings,
  };
  ctx.db.transaction(() => {
    ctx.db.prepare('INSERT OR REPLACE INTO echo_packets (message_id, swipe_id, owner_id, chat_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(messageId, swipeId, owner, chatId, JSON.stringify(data), Date.now());
    ctx.db.prepare('DELETE FROM echo_recalls WHERE message_id = ? AND swipe_id = ?').run(messageId, swipeId);
    const ins = ctx.db.prepare('INSERT INTO echo_recalls (id, owner_id, chat_id, message_id, swipe_id, unit_id, game_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const u of r.recalled) ins.run(newId('er_'), owner, chatId, messageId, swipeId, u, gameTime, Date.now());
  })();
}

/** Lorebook knowledge scopes (§4): common (default), group:<id>, secret:<actor,actor>. */
export function loreVisible(scope: unknown, actor: string, proj: echo.Projector | null, privileged: boolean): boolean {
  if (privileged || typeof scope !== 'string' || !scope || scope === 'common') return true;
  if (scope.startsWith('group:')) return !!proj && proj.groupsOf(actor).includes(scope.slice(6));
  if (scope.startsWith('secret:')) return scope.slice(7).split(',').map((s) => s.trim()).includes(actor);
  return true;
}

/**
 * The on-demand recall tool: `search_character_memory`. The actor and scope are bound here from
 * the chat (the current speaker); the arguments can only narrow. Hard caps on calls and tokens.
 */
const toolCalls = new Map<string, number>();
export async function searchCharacterMemory(ctx: AppContext, owner: string, chatId: string, args: { query: string; temporal_hint?: string; detail_level?: 'gist' | 'account' | 'exact'; max_tokens?: number }) {
  const chat = getChat(ctx, owner, chatId);
  const msgs = listMessages(ctx, owner, chatId);
  const key = `${chatId}:${msgs[msgs.length - 1]?.id ?? ''}`;
  const n = (toolCalls.get(key) ?? 0) + 1;
  if (n > 3) throw new HttpError(429, 'Recall limit for this turn reached');
  toolCalls.set(key, n);
  const lastSpeaker = [...msgs].reverse().find((m) => m.role === 'assistant')?.characterId ?? chat.characterId ?? '';
  const cn = chatNames(ctx, owner, chat);
  const query = `${String(args.query ?? '').slice(0, 300)}${args.temporal_hint ? ` ${String(args.temporal_hint).slice(0, 60)}` : ''}${args.detail_level === 'exact' ? ' exactly' : ''}`;
  const r = await echoPacketFor(ctx, owner, { ...chat, metadata: { ...chat.metadata, echo: { ...(chat.metadata.echo ?? {}), budget: Math.max(60, Math.min(400, Number(args.max_tokens) || 250)) } } }, { speakerCardId: lastSpeaker, recentText: query, focus: query, seed: `${key}:tool${n}`, chatCharacters: cn.characters.map((c) => c.id) });
  if (!r) throw new HttpError(400, 'ECHO is off for this chat');
  return { actor: r.actor, text: r.packet.text || "(nothing comes to mind)", lines: r.packet.lines.filter((l) => l.section === 'memories').map((l) => l.text) };
}

// ------------------------------------------------------------------ semantic path (optional)

/**
 * Unit vectors, keyed by embedding model and the hash of the unit's own text (each actor's text is
 * already limited to what they perceived). Kept in memory only, so nothing new lands on disk;
 * they are computed in the background after a turn is written (deferred enrichment), and scored
 * only for the ids of the view being recalled — never used to find anything outside it.
 */
const vectors = new Map<string, Float32Array>();
const keyOf = (model: string, text: string) => `${model}|${sha256(text)}`;

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export async function enrichVectors(ctx: AppContext, owner: string, chat: ChatDTO): Promise<number> {
  if (!echoSettings(ctx, owner, chat).semantic) return 0;
  const conn = connectionForRole(ctx, owner, 'embeddings');
  if (!conn) return 0;
  const model = String(conn.params.embeddings_model || conn.model);
  const { proj } = projectionFor(ctx, owner, chat);
  const todo = [...new Set(proj.units.map((u) => u.l1))].filter((t) => !vectors.has(keyOf(model, t))).slice(0, 64);
  if (!todo.length) return 0;
  const out = await logged(ctx, owner, conn, { chatId: chat.id, purpose: 'echo memory embeddings', role: 'embeddings' }, Math.ceil(todo.join(' ').length / 4), () => embed(conn, todo), () => '');
  todo.forEach((t, i) => out[i] && vectors.set(keyOf(model, t), new Float32Array(out[i])));
  return todo.length;
}

async function semanticSignals(ctx: AppContext, owner: string, chatId: string, view: echo.AuthorizedView, actor: string, query: string, timeoutMs = 1200): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const conn = connectionForRole(ctx, owner, 'embeddings');
  if (!conn || !query.trim()) return out;
  const model = String(conn.params.embeddings_model || conn.model);
  const mine = view.units.filter((u) => u.owner === actor && vectors.has(keyOf(model, u.l1)));
  if (!mine.length) return out;
  try {
    const [q] = await Promise.race([
      logged(ctx, owner, conn, { chatId, purpose: 'echo query embedding', role: 'embeddings' }, Math.ceil(query.length / 4), () => embed(conn, [query.slice(0, 2000)]), () => ''),
      new Promise<number[][]>((_, rej) => setTimeout(() => rej(new Error('embedding timeout')), timeoutMs)),
    ]);
    if (q) for (const u of mine) out.set(u.id, cosine(q, vectors.get(keyOf(model, u.l1))!));
  } catch {
    /* no semantic signal this turn */
  }
  return out;
}

// ------------------------------------------------------------------ Strict: isolated proposals

/**
 * Strict mode (§11): every other character in the scene decides what they intend from THEIR OWN
 * packet only, in an isolated call; the writer receives the proposals, never those packets. Capped
 * at two characters, so a turn stays a handful of calls at most.
 */
export async function strictProposals(ctx: AppContext, owner: string, chat: ChatDTO, opts: { speakerCardId: string; recentText: string; seed: string; chatCharacters: string[] }): Promise<string[]> {
  const settings = echoSettings(ctx, owner, chat);
  if (settings.profile !== 'strict') return [];
  const conn = connectionForRole(ctx, owner, 'utility');
  if (!conn) return [];
  const p = projectionFor(ctx, owner, chat);
  const speaker = actorForCard(p.state, opts.speakerCardId);
  const others = presentIds(p.state, opts.chatCharacters).filter((a) => a !== PLAYER && a !== speaker).slice(0, 2);
  const out: string[] = [];
  for (const actor of others) {
    const view = echo.authorize(p.proj, { actorId: actor, storyId: chat.id, leaf: p.leaf, accessScope: 'actor' });
    const now = p.state?.time.minutes ?? p.proj.lastTime + 5;
    const packet = echo.compilePacket({ view, query: echo.understand(opts.recentText.slice(-800), nameIndex(p.names), now), scene: { now, present: presentIds(p.state, opts.chatCharacters), locationId: p.state?.currentLocationId ?? 'scene' }, names: p.names, budget: 350, hypotheses: true });
    const name = p.names[actor] ?? actor;
    const messages = [
      { role: 'system' as const, content: `You decide the intention of a single character, ${name}, in a roleplay scene. Use ONLY what ${name} knows (below); never assume anything else. Answer with one short sentence: what ${name} intends to do or say next, in third person.` },
      { role: 'user' as const, content: `${packet.text || `(${name} has no relevant memories.)`}\n\nRecent scene:\n${opts.recentText.slice(-1200)}` },
    ];
    try {
      const r = await logged(ctx, owner, conn, { chatId: chat.id, purpose: 'echo strict proposal', role: 'utility' }, promptTokens(messages), () => completeChat(conn, { messages, overrides: { temperature: 0.6, max_tokens: 80, stream: false, reasoning: false, stop: [] }, signal: AbortSignal.timeout(30_000) }));
      const line = r.text.trim().split('\n')[0].slice(0, 240);
      if (line) out.push(`${name}: ${line}`);
    } catch {
      /* a missing proposal leaves that character to the writer */
    }
  }
  return out;
}

// ------------------------------------------------------------------ lifecycle (message-bound)

/** A message's text was edited or regenerated: what was read from it is taken back. */
export function echoOnRewrite(ctx: AppContext, messageId: string, swipeId: number) {
  ctx.db.transaction(() => {
    deleteEventsFor(ctx, messageId, swipeId, ['turn']);
    ctx.db.prepare('DELETE FROM echo_packets WHERE message_id = ? AND swipe_id = ?').run(messageId, swipeId);
    ctx.db.prepare('DELETE FROM echo_recalls WHERE message_id = ? AND swipe_id = ?').run(messageId, swipeId);
  })();
}

/** A swipe was deleted: its rows go, later swipes' rows shift down one (like op_log). */
export function echoOnSwipeDeleted(ctx: AppContext, messageId: string, swipeId: number) {
  ctx.db.transaction(() => {
    for (const t of ['echo_events', 'echo_ops', 'echo_recalls', 'echo_packets']) ctx.db.prepare(`DELETE FROM ${t} WHERE message_id = ? AND swipe_id = ?`).run(messageId, swipeId);
    const rows = ctx.db.prepare('SELECT id, swipe_id, data FROM echo_events WHERE message_id = ? AND swipe_id > ?').all(messageId, swipeId) as Array<{ id: string; swipe_id: number; data: string }>;
    for (const r of rows) {
      const e = JSON.parse(r.data) as echo.EchoEvent;
      e.swipeId = r.swipe_id - 1;
      ctx.db.prepare('UPDATE echo_events SET swipe_id = ?, data = ? WHERE id = ?').run(r.swipe_id - 1, JSON.stringify(e), r.id);
    }
    for (const t of ['echo_ops', 'echo_recalls']) ctx.db.prepare(`UPDATE ${t} SET swipe_id = swipe_id - 1 WHERE message_id = ? AND swipe_id > ?`).run(messageId, swipeId);
    // echo_packets has (message_id, swipe_id) as its key: shift in ascending order.
    const pk = ctx.db.prepare('SELECT swipe_id FROM echo_packets WHERE message_id = ? AND swipe_id > ? ORDER BY swipe_id').all(messageId, swipeId) as Array<{ swipe_id: number }>;
    for (const r of pk) ctx.db.prepare('UPDATE echo_packets SET swipe_id = ? WHERE message_id = ? AND swipe_id = ?').run(r.swipe_id - 1, messageId, r.swipe_id);
  })();
}

/** Messages were deleted (or rewound): everything they caused goes with them. */
export function echoOnMessagesDeleted(ctx: AppContext, messageIds: string[]) {
  if (!messageIds.length) return;
  const ph = messageIds.map(() => '?').join(',');
  for (const t of ['echo_events', 'echo_ops', 'echo_recalls', 'echo_packets']) ctx.db.prepare(`DELETE FROM ${t} WHERE message_id IN (${ph})`).run(...messageIds);
}

/** Branch: the log is copied with message ids remapped (always-live rows are copied as they are). */
export function forkEcho(ctx: AppContext, owner: string, fromChat: string, toChat: string, map: Map<string, string>) {
  const rows = ctx.db.prepare('SELECT * FROM echo_events WHERE chat_id = ?').all(fromChat) as Array<EventRow & { created_at: number }>;
  const ins = ctx.db.prepare('INSERT INTO echo_events (id, owner_id, chat_id, message_id, swipe_id, seq, source, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of rows) {
    if (r.message_id && !map.has(r.message_id)) continue;
    const e = JSON.parse(r.data) as echo.EchoEvent;
    const id = `${e.id}~${toChat.slice(-6)}`;
    const msg = r.message_id ? map.get(r.message_id)! : null;
    const moved = { ...e, id, storyId: toChat, messageId: msg, sourceMessageIds: e.sourceMessageIds.map((x) => map.get(x) ?? x), causes: e.causes.map((c) => `${c}~${toChat.slice(-6)}`) };
    ins.run(id, owner, toChat, msg, r.swipe_id, r.seq, r.source, JSON.stringify(moved), r.created_at);
  }
  const ops = ctx.db.prepare('SELECT * FROM echo_ops WHERE chat_id = ?').all(fromChat) as Array<{ id: string; message_id: string | null; swipe_id: number | null; kind: string; data: string; created_at: number }>;
  for (const o of ops) {
    if (o.message_id && !map.has(o.message_id)) continue;
    ctx.db.prepare('INSERT INTO echo_ops (id, owner_id, chat_id, message_id, swipe_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(newId('eo_'), owner, toChat, o.message_id ? map.get(o.message_id)! : null, o.swipe_id, o.kind, o.data, o.created_at);
  }
}

// ------------------------------------------------------------------ manual editor and migration

export function audit(ctx: AppContext, owner: string, chatId: string, action: string, detail: string) {
  ctx.db.prepare('INSERT INTO echo_audit (id, owner_id, chat_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(newId('ea_'), owner, chatId, action, detail.slice(0, 500), Date.now());
}

export function addOp(ctx: AppContext, owner: string, chatId: string, op: Omit<echo.ManualOp, 'id'>, anchor: { messageId: string | null; swipeId: number | null }): echo.ManualOp {
  getChat(ctx, owner, chatId);
  const id = newId('eo_');
  const { messageId: _m, swipeId: _s, ...data } = op as echo.ManualOp;
  ctx.db.prepare('INSERT INTO echo_ops (id, owner_id, chat_id, message_id, swipe_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, owner, chatId, anchor.messageId, anchor.swipeId, op.kind, JSON.stringify(data), Date.now());
  audit(ctx, owner, chatId, `op.${op.kind}`, JSON.stringify(data));
  return { ...(data as echo.ManualOp), id };
}

export function removeOp(ctx: AppContext, owner: string, chatId: string, opId: string) {
  const r = ctx.db.prepare('DELETE FROM echo_ops WHERE id = ? AND chat_id = ? AND owner_id = ?').run(opId, chatId, owner);
  if (!r.changes) throw new HttpError(404, 'No such edit');
  audit(ctx, owner, chatId, 'op.remove', opId);
}

/**
 * Migration (§13): legacy memories become migration events, still bound to their messages. Their
 * recorded witnesses are their only observers; with none recorded, nobody is granted anything.
 * Reversible: `revertMigration` removes exactly what this added.
 */
export function migrateLegacy(ctx: AppContext, owner: string, chatId: string): number {
  const chat = getChat(ctx, owner, chatId);
  const scope = chat.campaignId ? { sql: 'campaign_id = ?', args: [chat.campaignId] } : { sql: 'chat_id = ? AND campaign_id IS NULL', args: [chatId] };
  const rows = ctx.db.prepare(`SELECT * FROM mem_items WHERE owner_id = ? AND ${scope.sql} AND forgotten = 0 AND kind != 'scene'`).all(owner, ...scope.args) as any[];
  const seqOf = new Map((ctx.db.prepare('SELECT id, seq FROM messages WHERE chat_id = ?').all(chatId) as Array<{ id: string; seq: number }>).map((r) => [r.id, r.seq]));
  const events = rows
    .filter((r) => !r.message_id || seqOf.has(r.message_id))
    .map((r) =>
      echo.eventFromLegacy(
        { id: r.id, text: r.text, participants: JSON.parse(r.participants), witnesses: JSON.parse(r.witnesses), locationId: r.location_id, gameTime: r.game_time, importance: r.importance, secret: !!r.secret, seq: (r.message_id ? seqOf.get(r.message_id)! : 0) + 0.9, messageId: r.message_id, swipeId: r.swipe_id },
        chatId,
      ),
    );
  ctx.db.transaction(() => {
    ctx.db.prepare("DELETE FROM echo_events WHERE chat_id = ? AND source = 'migration'").run(chatId);
    insertEvents(ctx, owner, chatId, events, 'migration');
  })();
  audit(ctx, owner, chatId, 'migrate', `${events.length} legacy memories`);
  invalidateEcho(chatId);
  return events.length;
}

export function revertMigration(ctx: AppContext, owner: string, chatId: string): number {
  getChat(ctx, owner, chatId);
  const r = ctx.db.prepare("DELETE FROM echo_events WHERE chat_id = ? AND source = 'migration'").run(chatId);
  audit(ctx, owner, chatId, 'migrate.revert', `${r.changes} events`);
  invalidateEcho(chatId);
  return r.changes;
}

export { nameOfPerson };
