/**
 * Background memory writers: the chronicler reads stretches of chat for what the turn-by-turn
 * pass missed (and is the only writer for chats without a game), and consolidation folds
 * finished scenes, days and chapters so the story so far stays short without losing milestones.
 * Both run after a reply is stored and never hold one up.
 */
import {
  buildChroniclePrompt,
  buildConsolidatePrompt,
  chronicleBatch,
  effectiveWatermark,
  ensureMilestones,
  fallbackSummary,
  novel,
  parseChronicle,
  parseConsolidate,
  planChapter,
  planDays,
  planScenes,
  PLAYER,
  stripInlineTags,
  type ChronicleRun,
  type Importance,
} from '@everloom/engine';
import type { AppContext } from '../context.js';
import { json } from '../db/index.js';
import { completeChat } from '../llm/providers.js';
import { logged, promptTokens } from './calls.js';
import { getState } from './campaigns.js';
import { getChat, listMessages } from './chats.js';
import { connectionForRole } from './connections.js';
import { embedPending, insertMemory, insertSummary, loadMemoryState, personId, scopeOf, writeModelFacts, type MemoryRow } from './mem.js';
import { getSettings } from './settings.js';
import { chatCharacterIds, playerName } from './tracker.js';
import { runSocial, runThreadSeeding } from './worldsim.js';

const inflight = new Set<string>();

function loadRuns(ctx: AppContext, chatId: string): ChronicleRun[] {
  const r = ctx.db.prepare('SELECT runs FROM chronicle_state WHERE chat_id = ?').get(chatId) as { runs: string } | undefined;
  return json<ChronicleRun[]>(r?.runs, []);
}

function isLive(ctx: AppContext) {
  const q = ctx.db.prepare('SELECT 1 FROM messages WHERE id = ? AND swipe_id = ?');
  return (messageId: string, swipeId: number) => !!q.get(messageId, swipeId);
}

function saveRun(ctx: AppContext, owner: string, chatId: string, run: ChronicleRun) {
  const live = isLive(ctx);
  // Keep live runs only (dead ones can never count again), newest 50.
  const runs = [...loadRuns(ctx, chatId).filter((r) => live(r.messageId, r.swipeId)), run].slice(-50);
  ctx.db
    .prepare('INSERT INTO chronicle_state (chat_id, owner_id, watermark_seq, runs, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET watermark_seq = excluded.watermark_seq, runs = excluded.runs, updated_at = excluded.updated_at')
    .run(chatId, owner, run.toSeq, JSON.stringify(runs), Date.now());
}

export function chronicleStatus(ctx: AppContext, owner: string, chatId: string) {
  getChat(ctx, owner, chatId);
  const runs = loadRuns(ctx, chatId);
  const watermark = effectiveWatermark(runs, isLive(ctx));
  const pending = (ctx.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND hidden = 0 AND seq > ?').get(chatId, watermark) as { n: number }).n;
  return { watermark, pending, running: inflight.has(chatId), lastRunAt: runs.length ? runs[runs.length - 1].at : null };
}

export interface ChronicleResult {
  ok: boolean;
  error?: string;
  read?: number;
  memories?: number;
  facts?: number;
  summary?: string;
}

/** Read the next unread stretch of the chat. Advances the watermark only when everything was written. */
export async function runChronicler(ctx: AppContext, owner: string, chatId: string, opts: { force?: boolean } = {}): Promise<ChronicleResult> {
  if (inflight.has(chatId)) return { ok: false, error: 'Already reading this chat' };
  inflight.add(chatId);
  try {
    const chat = getChat(ctx, owner, chatId);
    const settings = getSettings(ctx, owner);
    const conn = connectionForRole(ctx, owner, 'background');
    if (!conn) return { ok: false, error: 'No connection for background work' };
    const messages = listMessages(ctx, owner, chatId)
      .filter((m) => !m.hidden && m.role !== 'system')
      .map((m) => ({ id: m.id, swipeId: m.swipeId, seq: m.seq, name: m.name, text: stripInlineTags(m.swipes[m.swipeId]?.text ?? '') }));
    const watermark = effectiveWatermark(loadRuns(ctx, chatId), isLive(ctx));
    const batch = chronicleBatch(messages, watermark, { keepRecent: opts.force ? 0 : 4, force: opts.force });
    if (!batch) return { ok: false, error: 'Nothing new to read yet' };
    const scope = scopeOf(chat);
    const before = loadMemoryState(ctx, owner, scope);
    const names = { player: playerName(ctx, owner, chat), characters: chatCharacterIds(ctx, owner, chat) };
    const prompt = buildChroniclePrompt({ messages: batch, known: before.items.map((m) => m.text), player: names.player, summarize: !chat.campaignId, maxWords: settings.memory.maxWords });
    const last = batch[batch.length - 1];
    const r = await logged(ctx, owner, conn, { chatId, messageId: last.id, purpose: 'chronicler', role: 'background' }, promptTokens(prompt), () =>
      completeChat(conn, { messages: prompt, overrides: { temperature: 0.3, max_tokens: 1400, reasoning: false, stop: [] }, signal: AbortSignal.timeout(120_000) }),
    );
    const out = parseChronicle(r.text);
    if (!out) return { ok: false, error: 'The chronicler returned no usable JSON' };
    // Everything read must still be what it was: a swipe or edit meanwhile means try again later.
    const now = new Map(listMessages(ctx, owner, chatId).map((m) => [m.id, m]));
    if (batch.some((b) => now.get(b.id)?.swipeId !== b.swipeId || stripInlineTags(now.get(b.id)?.swipes[b.swipeId]?.text ?? '') !== b.text)) return { ok: false, error: 'The chat changed while it was being read' };

    const state = chat.campaignId ? getState(ctx, owner, chat.campaignId) : null;
    const anchor = { chatId, messageId: last.id, swipeId: last.swipeId };
    const cast = names.characters.map((c) => personId(state, c.name, names) ?? `char:${c.id}`);
    // When it happened: the latest turn memory in the stretch, else now.
    const ids = batch.map((b) => b.id);
    const turnRow = ctx.db.prepare(`SELECT game_time, location_id FROM mem_items WHERE message_id IN (${ids.map(() => '?').join(',')}) ORDER BY game_time DESC LIMIT 1`).get(...ids) as { game_time: number; location_id: string | null } | undefined;
    const gameTime = turnRow?.game_time ?? state?.time.minutes ?? 0;
    const locationId = turnRow ? turnRow.location_id : null;
    const evidence = batch.map((b) => `${b.name}: ${b.text}`).join('\n');
    let written = 0;
    let facts = 0;
    const fresh = novel(out.memories, before.items.map((m) => m.text));
    ctx.db.transaction(() => {
      for (const m of fresh) {
        const about = m.about.map((n) => personId(state, n, names)).filter((x): x is string => !!x);
        // Who saw it back then isn't known for sure: the player, the chat's characters and the
        // people it's about. Nobody else learns it from the chronicle.
        const witnesses = m.private ? [PLAYER, ...m.to.map((n) => personId(state, n, names)).filter((x): x is string => !!x), ...about] : [PLAYER, ...cast, ...about];
        insertMemory(ctx, owner, scope, anchor, 'chronicle', { kind: 'chronicle', text: m.text, participants: about, witnesses: [...new Set(witnesses)], locationId, gameTime, importance: m.importance as Importance, secret: m.private });
        written++;
      }
      const f = writeModelFacts(ctx, owner, scope, state, anchor, 'chronicle', out.facts, names, evidence, gameTime);
      facts = f.inserted + f.superseded + f.conflicts;
      if (out.summary && !chat.campaignId) {
        const milestones = fresh.filter((m) => m.importance >= 3).map((m) => m.text);
        insertSummary(ctx, owner, scope, anchor, {
          level: 'scene',
          title: `Messages ${batch[0].seq}–${last.seq}`,
          text: ensureMilestones(out.summary, milestones),
          fromTime: gameTime,
          toTime: gameTime,
          covers: [],
          importance: (milestones.length ? 3 : fresh.some((m) => m.importance >= 2) ? 2 : 1) as Importance,
        });
      }
      saveRun(ctx, owner, chatId, { fromSeq: batch[0].seq, toSeq: last.seq, messageId: last.id, swipeId: last.swipeId, at: Date.now() });
    })();
    ctx.bus.publish(owner, 'memory.changed', { chatId, campaignId: chat.campaignId });
    return { ok: true, read: batch.length, memories: written, facts, summary: out.summary || undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    inflight.delete(chatId);
  }
}

export interface ConsolidateResult {
  ok: boolean;
  scenes: number;
  days: number;
  chapters: number;
  usedModel: boolean;
  error?: string;
}

const consolidating = new Set<string>();

/** Fold finished scenes into scene memories, finished days into day summaries, and old summaries into chapters. */
export async function runConsolidation(ctx: AppContext, owner: string, chatId: string, opts: { useModel: boolean }): Promise<ConsolidateResult> {
  const res: ConsolidateResult = { ok: true, scenes: 0, days: 0, chapters: 0, usedModel: false };
  const key = chatId;
  if (consolidating.has(key)) return { ...res, ok: false, error: 'Already running' };
  consolidating.add(key);
  try {
    const chat = getChat(ctx, owner, chatId);
    const scope = scopeOf(chat);
    const state = chat.campaignId ? getState(ctx, owner, chat.campaignId) : null;
    const mem = loadMemoryState(ctx, owner, scope);
    const now = state?.time.minutes ?? 0;
    const unfolded = mem.items.filter((m) => !m.foldedInto && m.kind !== 'note');
    const scenes = state ? planScenes(unfolded, state.currentLocationId, now).slice(0, 4) : [];
    const inSummary = new Set<string>();
    const byId = new Map(mem.summaries.map((s) => [s.id, s]));
    for (const s of mem.summaries) if (s.level !== 'scene') for (const c of s.covers) {
      inSummary.add(c);
      for (const cc of byId.get(c)?.covers ?? []) inSummary.add(cc);
    }
    // A scene memory counts as summarized when every beat folded into it already is.
    for (const sc of mem.scenes) {
      const beats = mem.all.filter((b) => b.foldedInto === sc.id);
      if (beats.length && beats.every((b) => inSummary.has(b.id))) inSummary.add(sc.id);
    }
    const days = state ? planDays(mem.items, Math.floor(now / 1440), inSummary).slice(0, 3) : [];
    // A day also covers the finished scenes inside it, so the recap shows the day instead of them.
    const sceneBeats = new Map(mem.scenes.map((sc) => [sc.id, mem.all.filter((b) => b.foldedInto === sc.id).map((b) => b.id)]));
    const scenesOfDay = (ids: Set<string>) => [...sceneBeats].filter(([, beats]) => beats.length > 0 && beats.every((b) => ids.has(b))).map(([id]) => id);
    const chapter = planChapter(mem.summaries);
    if (!scenes.length && !days.length && !chapter) return res;

    const milestonesOf = (items: Array<{ text: string; importance: number }>) => items.filter((i) => i.importance >= 3).map((i) => i.text);
    const groups = [
      ...scenes.map((s, i) => ({ id: `s${i}`, kind: 'scene' as const, lines: s.beats.map((b) => b.text), milestones: milestonesOf(s.beats) })),
      ...days.map((d, i) => ({ id: `d${i}`, kind: 'day' as const, lines: d.items.map((m) => m.text), milestones: milestonesOf(d.items) })),
      ...(chapter ? [{ id: 'c0', kind: 'chapter' as const, lines: chapter.map((s) => s.text), milestones: [] as string[] }] : []),
    ];
    let prose = new Map<string, { title: string; text: string }>();
    const conn = opts.useModel ? connectionForRole(ctx, owner, 'background') : null;
    if (conn) {
      const prompt = buildConsolidatePrompt(groups);
      try {
        const r = await logged(ctx, owner, conn, { chatId, purpose: 'consolidation', role: 'background' }, promptTokens(prompt), () =>
          completeChat(conn, { messages: prompt, overrides: { temperature: 0.3, max_tokens: 1200, reasoning: false, stop: [] }, signal: AbortSignal.timeout(120_000) }),
        );
        prose = parseConsolidate(r.text);
        res.usedModel = prose.size > 0;
      } catch {
        /* the plain-text fallback below still folds */
      }
    }
    const textFor = (id: string, items: Array<{ text: string; importance: number }>) => ensureMilestones(prose.get(id)?.text ?? fallbackSummary(items, 700), milestonesOf(items));
    const exists = ctx.db.prepare('SELECT folded_into FROM mem_items WHERE id = ?');
    ctx.db.transaction(() => {
      scenes.forEach((s, i) => {
        // Something may have changed during the call: fold only beats that are still there and loose.
        if (!s.beats.every((b) => {
          const r = exists.get(b.id) as { folded_into: string | null } | undefined;
          return r && !r.folded_into;
        })) return;
        // Anchored where its newest beat is: if that take is swiped away, the fold goes with it.
        const newest = s.beats.reduce((a, b) => (b.seq > a.seq ? b : a)) as MemoryRow;
        const made = insertMemory(ctx, owner, scope, { chatId, messageId: newest.messageId, swipeId: newest.swipeId }, 'consolidate', {
          kind: 'scene',
          text: textFor(`s${i}`, s.beats),
          participants: s.participants,
          witnesses: s.witnesses,
          locationId: s.locationId,
          gameTime: s.to,
          importance: s.importance,
          secret: s.secret,
          foldedFrom: s.beats.map((b) => b.id),
        });
        sceneBeats.set(made.id, s.beats.map((b) => b.id));
        res.scenes++;
      });
      days.forEach((d, i) => {
        if (!d.items.every((m) => exists.get(m.id))) return;
        const newest = d.items.reduce((a, b) => (b.seq > a.seq ? b : a)) as MemoryRow;
        insertSummary(ctx, owner, scope, { chatId, messageId: newest.messageId, swipeId: newest.swipeId }, { level: 'day', title: prose.get(`d${i}`)?.title || `Day ${d.day + 1}`, text: textFor(`d${i}`, d.items), fromTime: d.day * 1440, toTime: d.day * 1440 + 1439, covers: [...d.items.map((m) => m.id), ...scenesOfDay(new Set(d.items.map((m) => m.id)))], importance: d.importance });
        res.days++;
      });
      if (chapter) {
        const imp = Math.max(...chapter.map((s) => s.importance)) as Importance;
        const text = prose.get('c0')?.text ?? chapter.map((s) => s.text).join(' ');
        // Milestones inside the folded summaries are carried up verbatim when the prose drops them.
        const ms = chapter.flatMap((s) => s.covers).map((id) => mem.all.find((m) => m.id === id)).filter((m): m is MemoryRow => !!m && m.importance >= 3).map((m) => m.text);
        const last = chapter.reduce((a, b) => (b.seq > a.seq ? b : a));
        const lastRow = ctx.db.prepare('SELECT message_id, swipe_id FROM mem_summaries WHERE id = ?').get(last.id) as { message_id: string | null; swipe_id: number | null } | undefined;
        insertSummary(ctx, owner, scope, { chatId, messageId: lastRow?.message_id ?? null, swipeId: lastRow?.swipe_id ?? null }, { level: 'chapter', title: prose.get('c0')?.title || 'Chapter', text: ensureMilestones(text, ms).slice(0, 4000), fromTime: Math.min(...chapter.map((s) => s.fromTime)), toTime: Math.max(...chapter.map((s) => s.toTime)), covers: chapter.map((s) => s.id), importance: imp });
        res.chapters++;
      }
    })();
    if (res.scenes || res.days || res.chapters) ctx.bus.publish(owner, 'memory.changed', { chatId, campaignId: chat.campaignId });
    return res;
  } catch (e) {
    return { ...res, ok: false, error: (e as Error).message };
  } finally {
    consolidating.delete(key);
  }
}

/**
 * After a reply is stored: what background memory work is due at this turn. Cadence comes from
 * the turn number (assistant replies so far), so swipes and edits never shift it.
 */
export function afterTurn(ctx: AppContext, owner: string, chatId: string): Record<'chronicler' | 'consolidate' | 'embed' | 'social' | 'seed', boolean> {
  try {
    return scheduleAfterTurn(ctx, owner, chatId);
  } catch {
    // Background memory work must never break a reply (or outlive a closed database).
    return { chronicler: false, consolidate: false, embed: false, social: false, seed: false };
  }
}

function scheduleAfterTurn(ctx: AppContext, owner: string, chatId: string): Record<'chronicler' | 'consolidate' | 'embed' | 'social' | 'seed', boolean> {
  const w = getSettings(ctx, owner).world;
  const turn = (ctx.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE chat_id = ? AND role = 'assistant' AND hidden = 0").get(chatId) as { n: number }).n;
  const due = {
    chronicler: w.chronicler && turn > 0 && turn % Math.max(1, w.chronicleEvery) === 0,
    consolidate: turn > 0 && turn % Math.max(1, w.consolidateEvery) === 0,
    embed: w.semantic,
    social: w.social && turn > 0 && turn % Math.max(1, w.socialEvery) === 0,
    seed: w.threads && w.threadSeeding && turn > 0 && turn % 15 === 0,
  };
  const chat = getChat(ctx, owner, chatId);
  const prev = background.get(chatId) ?? Promise.resolve();
  const p = prev
    .then(async () => {
      if (due.chronicler) await runChronicler(ctx, owner, chatId);
      if (due.consolidate) await runConsolidation(ctx, owner, chatId, { useModel: w.consolidate });
      if (due.embed) await embedPending(ctx, owner, scopeOf(chat), chatId);
      if (due.social) await runSocial(ctx, owner, chatId, turn).catch(() => false);
      if (due.seed) await runThreadSeeding(ctx, owner, chatId, turn).catch(() => false);
    })
    .catch(() => {})
    .finally(() => {
      if (background.get(chatId) === p) background.delete(chatId);
    });
  background.set(chatId, p);
  return due;
}

/** Background memory work queued per chat (one after another, never two at once). */
const background = new Map<string, Promise<void>>();

/** Resolves when the chat's queued background memory work is done (tests, benchmark, shutdown). */
export function settleBackground(chatId: string): Promise<void> {
  return background.get(chatId) ?? Promise.resolve();
}
