/**
 * Campaign state = base state + the live op-log entries, applied in story order.
 * Entries are anchored to (chat, message, swipe); swiping, editing, deleting and branching
 * change which entries are live, and the state is rebuilt from the log.
 */
import {
  applyOps, createInitialState, diffToPatches, migrateState, rebuild, selectActiveEntries, STATE_VERSION, summarizeChanges,
  type AnchoredEntry, type CampaignState, type Op, type OpSource,
} from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { json } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { recordError } from './diagnostics.js';
import { clearCampaignDocs, indexDoc } from './search.js';

interface EntryRow {
  id: string;
  campaign_id: string;
  chat_id: string;
  message_id: string | null;
  swipe_id: number | null;
  seq: number;
  source: string;
  ops: string;
  summary: string;
  created_at: number;
}

export function createCampaign(ctx: AppContext, owner: string, name: string, state?: CampaignState): string {
  const id = newId('cp_');
  const now = Date.now();
  const s = state ?? createInitialState({ title: name, seed: Math.floor(Math.random() * 2 ** 31) });
  ctx.db
    .prepare('INSERT INTO campaigns (id, owner_id, name, base_state, state, last_real_tick, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner, name, JSON.stringify(s), JSON.stringify(s), now, now, now);
  return id;
}

export function campaignRow(ctx: AppContext, owner: string, id: string): any {
  const r = ctx.db.prepare('SELECT * FROM campaigns WHERE id = ? AND owner_id = ?').get(id, owner);
  if (!r) throw new HttpError(404, 'Campaign not found');
  return r;
}

export function getState(ctx: AppContext, owner: string, id: string): CampaignState {
  return migrateState(json(campaignRow(ctx, owner, id).state, createInitialState()));
}

export function characterRefs(ctx: AppContext, owner: string): Array<{ id: string; name: string }> {
  return ctx.db.prepare('SELECT id, name FROM characters WHERE owner_id = ?').all(owner) as Array<{ id: string; name: string }>;
}

function saveState(ctx: AppContext, owner: string, id: string, state: CampaignState) {
  ctx.db.prepare('UPDATE campaigns SET state = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(JSON.stringify(state), Date.now(), id, owner);
  reindexCampaign(ctx, owner, id, state);
}

/** Keep FTS in sync with databank facts, quests and org run-ins. */
function reindexCampaign(ctx: AppContext, owner: string, id: string, s: CampaignState) {
  const tx = ctx.db.transaction(() => {
    clearCampaignDocs(ctx, owner, id, ['fact', 'quest', 'runin', 'npc']);
    for (const f of Object.values(s.databank)) indexDoc(ctx, owner, id, 'fact', f.id, f.title || f.tags.join(', '), f.text);
    for (const q of Object.values(s.quests)) indexDoc(ctx, owner, id, 'quest', q.id, q.title, `${q.desc}\n${q.objectives.map((o) => o.text).join('\n')}`);
    for (const o of Object.values(s.orgs)) for (const r of o.runins) indexDoc(ctx, owner, id, 'runin', `${o.id}:${r.id}`, o.name, r.text);
    for (const n of Object.values(s.npcs)) indexDoc(ctx, owner, id, 'npc', n.id, n.name, [n.role, n.title, n.appearance, n.personality, n.notes, ...n.rumors].filter(Boolean).join('\n'));
  });
  tx();
}

function entriesFor(ctx: AppContext, campaignId: string): EntryRow[] {
  return ctx.db.prepare('SELECT * FROM op_log WHERE campaign_id = ? ORDER BY seq').all(campaignId) as EntryRow[];
}

function linkedMessages(ctx: AppContext, owner: string, campaignId: string) {
  return ctx.db
    .prepare('SELECT m.id, m.chat_id AS chatId, m.swipe_id AS swipeId, m.created_at AS createdAt, m.seq FROM messages m JOIN chats c ON c.id = m.chat_id WHERE c.campaign_id = ? AND c.owner_id = ?')
    .all(campaignId, owner) as Array<{ id: string; chatId: string; swipeId: number; createdAt: number; seq: number }>;
}

/**
 * For one message, the model's bookkeeping comes first and the player's own edits last,
 * so a manual correction always wins over what the model read from that message.
 */
const SOURCE_RANK: Record<string, number> = { ai: 0, sim: 1, system: 2, helper: 3, user: 4, upgrade: 9 };
const rank = (s: string) => SOURCE_RANK[s] ?? 2;

/** Order entries by the story position of their anchor message, then source, then creation order. */
function orderedActive(ctx: AppContext, owner: string, campaignId: string) {
  const rows = entriesFor(ctx, campaignId);
  const msgs = linkedMessages(ctx, owner, campaignId);
  const byId = new Map(msgs.map((m) => [m.id, m]));
  const anchored: Array<AnchoredEntry & { anchorKey: [number, number] }> = rows.map((r) => {
    const m = r.message_id ? byId.get(r.message_id) : undefined;
    return {
      id: r.id,
      seq: r.seq,
      chatId: r.chat_id,
      messageId: r.message_id,
      swipeId: r.swipe_id,
      source: r.source as OpSource,
      ops: json<Op[]>(r.ops, []),
      anchorKey: [m ? m.createdAt : 0, m ? m.seq : -1],
    };
  });
  const active = selectActiveEntries(anchored, msgs);
  // Within one chat the message order decides; across linked chats, message creation time does.
  active.sort((a, b) => {
    if (a.messageId === null || b.messageId === null) return (a.messageId === null ? 0 : 1) - (b.messageId === null ? 0 : 1) || a.seq - b.seq;
    if (a.chatId === b.chatId) return a.anchorKey[1] - b.anchorKey[1] || (a.messageId === b.messageId ? rank(a.source) - rank(b.source) : 0) || a.seq - b.seq;
    return a.anchorKey[0] - b.anchorKey[0] || (a.messageId === b.messageId ? rank(a.source) - rank(b.source) : 0) || a.seq - b.seq;
  });
  // An upgrade pin sorts after everything on its message, then applies as a system entry.
  return active.map((e, i) => ({ ...e, seq: i + 1, source: ((e.source as string) === 'upgrade' ? 'system' : e.source) as OpSource }));
}

/**
 * A campaign saved by an older release keeps the results it recorded. Some rules changed (battles,
 * party healing on sleep, travel), so replaying its old log under today's rules could quietly give
 * different numbers on the next swipe or edit. Once, when such a campaign is first opened by this
 * release, the old log is replayed; anything that comes out differently is pinned back to what was
 * recorded by one "upgrade" entry on the latest message (applied after everything else there).
 * Returns how many campaigns needed pinning.
 */
export function reconcileLegacyCampaigns(ctx: AppContext): number {
  const rows = ctx.db.prepare('SELECT id, owner_id, state FROM campaigns').all() as Array<{ id: string; owner_id: string; state: string }>;
  let pinned = 0;
  for (const row of rows) {
    const stored = json<{ version?: number } | null>(row.state, null);
    if (!stored || (stored.version ?? 0) >= STATE_VERSION) continue;
    try {
      const recorded = migrateState(stored as CampaignState);
      const base = migrateState(json(campaignRow(ctx, row.owner_id, row.id).base_state, createInitialState()));
      const { state: replayed } = rebuild(base, orderedActive(ctx, row.owner_id, row.id), { characters: characterRefs(ctx, row.owner_id) });
      const patches = diffToPatches(replayed, recorded);
      const tx = ctx.db.transaction(() => {
        if (patches.length) {
          const latest = linkedMessages(ctx, row.owner_id, row.id).sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq)[0];
          const seq = ((ctx.db.prepare('SELECT MAX(seq) AS s FROM op_log WHERE campaign_id = ?').get(row.id) as { s: number | null }).s ?? 0) + 1;
          const chatId = latest?.chatId ?? (ctx.db.prepare('SELECT id FROM chats WHERE campaign_id = ? ORDER BY created_at LIMIT 1').get(row.id) as { id: string } | undefined)?.id;
          if (chatId) {
            ctx.db
              .prepare('INSERT INTO op_log (id, owner_id, campaign_id, chat_id, message_id, swipe_id, seq, source, ops, summary, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)')
              .run(newId('op_'), row.owner_id, row.id, chatId, latest?.id ?? null, seq, 'upgrade', JSON.stringify([{ type: 'patch', patches }]), JSON.stringify(['Kept the results recorded before the upgrade']), Date.now());
            pinned++;
          }
        }
        saveState(ctx, row.owner_id, row.id, recorded);
      });
      tx();
    } catch (e) {
      recordError('UPGRADE', `campaign ${row.id}`, e);
    }
  }
  return pinned;
}

export function rebuildCampaign(ctx: AppContext, owner: string, campaignId: string, origin?: string): CampaignState {
  const row = campaignRow(ctx, owner, campaignId);
  const base = migrateState(json(row.base_state, createInitialState()));
  const { state } = rebuild(base, orderedActive(ctx, owner, campaignId), { characters: characterRefs(ctx, owner) });
  saveState(ctx, owner, campaignId, state);
  ctx.bus.publish(owner, 'campaign.state', { campaignId, state }, origin);
  return state;
}

export interface AppendInput {
  chatId: string;
  messageId: string | null;
  swipeId: number | null;
  source: OpSource;
  ops: Op[];
  origin?: string;
  /** Replace existing entries from this source for the same anchor (idempotent tracker re-runs). */
  replace?: boolean;
}

export interface AppendResult {
  state: CampaignState;
  summary: string[];
  errors: Array<{ op: Op; error: string }>;
  applied: Op[];
}

export function appendOps(ctx: AppContext, owner: string, campaignId: string, input: AppendInput): AppendResult {
  campaignRow(ctx, owner, campaignId);
  let needsRebuild = false;
  if (input.replace && input.messageId) {
    const del = ctx.db
      .prepare('DELETE FROM op_log WHERE campaign_id = ? AND message_id = ? AND source = ? AND ((swipe_id IS NULL AND ? IS NULL) OR swipe_id = ?)')
      .run(campaignId, input.messageId, input.source, input.swipeId, input.swipeId);
    if (del.changes) needsRebuild = true;
  }
  // Incremental apply is only valid when the anchor is at the end of the story.
  const msgs = linkedMessages(ctx, owner, campaignId);
  const anchor = input.messageId ? msgs.find((m) => m.id === input.messageId) : undefined;
  // A model entry arriving after the player's edits on the same message goes underneath them.
  if (input.messageId && anchor && !needsRebuild) {
    const outranked = ctx.db
      .prepare('SELECT source FROM op_log WHERE campaign_id = ? AND message_id = ?')
      .all(campaignId, input.messageId) as Array<{ source: string }>;
    if (outranked.some((e) => rank(e.source) > rank(input.source))) needsRebuild = true;
  }
  if (input.messageId && anchor) {
    const later = ctx.db
      .prepare('SELECT COUNT(*) AS n FROM op_log o JOIN messages m ON m.id = o.message_id WHERE o.campaign_id = ? AND ((m.chat_id = ? AND m.seq > ?) OR (m.chat_id != ? AND m.created_at > ?))')
      .get(campaignId, anchor.chatId, anchor.seq, anchor.chatId, anchor.createdAt) as { n: number };
    if (later.n > 0) needsRebuild = true;
  }
  const base = needsRebuild ? rebuildCampaign(ctx, owner, campaignId) : getState(ctx, owner, campaignId);
  const result = applyOps(base, input.ops, { source: input.source, characters: characterRefs(ctx, owner) });
  const summary = summarizeChanges(result.changes);
  if (result.applied.length) {
    const seq = ((ctx.db.prepare('SELECT MAX(seq) AS s FROM op_log WHERE campaign_id = ?').get(campaignId) as { s: number | null }).s ?? 0) + 1;
    ctx.db
      .prepare('INSERT INTO op_log (id, owner_id, campaign_id, chat_id, message_id, swipe_id, seq, source, ops, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(newId('op_'), owner, campaignId, input.chatId, input.messageId, input.swipeId, seq, input.source, JSON.stringify(result.applied), JSON.stringify(summary), Date.now());
  }
  let state = result.state;
  if (needsRebuild && anchor) {
    state = rebuildCampaign(ctx, owner, campaignId, input.origin);
  } else {
    saveState(ctx, owner, campaignId, state);
    ctx.bus.publish(owner, 'campaign.state', { campaignId, state, changes: summary, source: input.source }, input.origin);
  }
  if (summary.length && needsRebuild) ctx.bus.publish(owner, 'campaign.toast', { campaignId, changes: summary });
  return { state, summary, errors: result.errors, applied: result.applied };
}

/** Called when a message is deleted: AI ops die with it, user/sim ops move to the previous message. */
export function onMessagesDeleted(ctx: AppContext, owner: string, chatId: string, deleted: Array<{ id: string; seq: number }>, campaignId: string | null) {
  if (!campaignId || !deleted.length) return;
  const ids = deleted.map((d) => d.id);
  const minSeq = Math.min(...deleted.map((d) => d.seq));
  const prev = ctx.db.prepare('SELECT id FROM messages WHERE chat_id = ? AND seq < ? ORDER BY seq DESC LIMIT 1').get(chatId, minSeq) as { id: string } | undefined;
  const tx = ctx.db.transaction(() => {
    const ph = ids.map(() => '?').join(',');
    ctx.db.prepare(`DELETE FROM op_log WHERE campaign_id = ? AND message_id IN (${ph}) AND source = 'ai'`).run(campaignId, ...ids);
    ctx.db.prepare(`UPDATE op_log SET message_id = ?, swipe_id = NULL WHERE campaign_id = ? AND message_id IN (${ph})`).run(prev?.id ?? null, campaignId, ...ids);
  });
  tx();
}

export function deleteEntriesFor(ctx: AppContext, campaignId: string, messageId: string, swipeId: number | null, sources: OpSource[] = ['ai']) {
  const ph = sources.map(() => '?').join(',');
  if (swipeId === null) ctx.db.prepare(`DELETE FROM op_log WHERE campaign_id = ? AND message_id = ? AND source IN (${ph})`).run(campaignId, messageId, ...sources);
  else ctx.db.prepare(`DELETE FROM op_log WHERE campaign_id = ? AND message_id = ? AND swipe_id = ? AND source IN (${ph})`).run(campaignId, messageId, swipeId, ...sources);
}

/** Shift swipe anchors after a swipe was removed from a message. */
export function onSwipeDeleted(ctx: AppContext, campaignId: string, messageId: string, swipeId: number) {
  ctx.db.prepare('DELETE FROM op_log WHERE campaign_id = ? AND message_id = ? AND swipe_id = ?').run(campaignId, messageId, swipeId);
  ctx.db.prepare('UPDATE op_log SET swipe_id = swipe_id - 1 WHERE campaign_id = ? AND message_id = ? AND swipe_id > ?').run(campaignId, messageId, swipeId);
}

/** Fork a campaign for a branched chat: same base, entries copied for the copied messages. */
export function forkCampaign(ctx: AppContext, owner: string, campaignId: string, fromChatId: string, newChatId: string, messageMap: Map<string, string>): string {
  const row = campaignRow(ctx, owner, campaignId);
  const newIdv = newId('cp_');
  const now = Date.now();
  ctx.db
    .prepare('INSERT INTO campaigns (id, owner_id, name, base_state, state, last_real_tick, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newIdv, owner, `${row.name} (branch)`, row.base_state, row.state, now, now, now);
  const entries = entriesFor(ctx, campaignId).filter((e) => e.chat_id === fromChatId && (e.message_id === null || messageMap.has(e.message_id)));
  const ins = ctx.db.prepare('INSERT INTO op_log (id, owner_id, campaign_id, chat_id, message_id, swipe_id, seq, source, ops, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const tx = ctx.db.transaction(() => {
    for (const e of entries) ins.run(newId('op_'), owner, newIdv, newChatId, e.message_id ? messageMap.get(e.message_id)! : null, e.swipe_id, e.seq, e.source, e.ops, e.summary, e.created_at);
  });
  tx();
  return newIdv;
}

export function setBaseState(ctx: AppContext, owner: string, campaignId: string, state: CampaignState, origin?: string): CampaignState {
  campaignRow(ctx, owner, campaignId);
  ctx.db.prepare('UPDATE campaigns SET base_state = ?, name = ? WHERE id = ? AND owner_id = ?').run(JSON.stringify(state), state.meta.title, campaignId, owner);
  return rebuildCampaign(ctx, owner, campaignId, origin);
}

/** Real-time day length: advance game time for real time that passed since the last tick. */
export function realtimeTick(ctx: AppContext, owner: string, campaignId: string, chatId: string): AppendResult | null {
  const row = campaignRow(ctx, owner, campaignId);
  const state = getState(ctx, owner, campaignId);
  const now = Date.now();
  if (state.meta.dayLength.mode !== 'realtime') {
    ctx.db.prepare('UPDATE campaigns SET last_real_tick = ? WHERE id = ?').run(now, campaignId);
    return null;
  }
  const last = row.last_real_tick ?? now;
  const realMin = (now - last) / 60000;
  const gameMin = Math.min(7 * 1440, Math.floor(realMin * (1440 / Math.max(1, state.meta.dayLength.realMinutesPerDay))));
  if (gameMin < 1) return null;
  ctx.db.prepare('UPDATE campaigns SET last_real_tick = ? WHERE id = ?').run(now, campaignId);
  const lastMsg = ctx.db.prepare('SELECT id FROM messages WHERE chat_id = ? ORDER BY seq DESC LIMIT 1').get(chatId) as { id: string } | undefined;
  return appendOps(ctx, owner, campaignId, { chatId, messageId: lastMsg?.id ?? null, swipeId: null, source: 'sim', ops: [{ type: 'time.advance', minutes: gameMin } as Op] });
}

export function opLogFor(ctx: AppContext, owner: string, campaignId: string, limit = 200) {
  campaignRow(ctx, owner, campaignId);
  return (ctx.db.prepare('SELECT * FROM op_log WHERE campaign_id = ? ORDER BY seq DESC LIMIT ?').all(campaignId, limit) as EntryRow[]).map((r) => ({
    id: r.id,
    chatId: r.chat_id,
    messageId: r.message_id,
    swipeId: r.swipe_id,
    seq: r.seq,
    source: r.source,
    ops: json(r.ops, []),
    summary: json(r.summary, []),
    createdAt: r.created_at,
  }));
}

export function undoEntry(ctx: AppContext, owner: string, campaignId: string, entryId: string, origin?: string): CampaignState {
  const r = ctx.db.prepare('DELETE FROM op_log WHERE id = ? AND campaign_id = ? AND owner_id = ?').run(entryId, campaignId, owner);
  if (!r.changes) throw new HttpError(404, 'Entry not found');
  return rebuildCampaign(ctx, owner, campaignId, origin);
}
