/**
 * Save slots. Saving copies the story as it is now into a hidden branch (messages, game state and
 * memory, through the same fork used for branches). Loading forks that copy again into a new chat,
 * so a slot can be loaded any number of times and never changes.
 */
import { formatClock, formatDate } from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { json } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { getState } from './campaigns.js';
import { branchChat, deleteChat, getChat } from './chats.js';

export interface SlotSummary {
  location: string | null;
  when: string | null;
  level: number | null;
  messages: number;
  last: string;
}
export interface SlotDTO {
  id: string;
  name: string;
  sourceChatId: string;
  createdAt: number;
  summary: SlotSummary;
}

/** The first chat of a story: branches, slots and loaded games all lead back to it. */
export function storyRoot(ctx: AppContext, chatId: string): string {
  let cur = chatId;
  for (let i = 0; i < 64; i++) {
    const r = ctx.db.prepare('SELECT parent_chat_id FROM chats WHERE id = ?').get(cur) as { parent_chat_id: string | null } | undefined;
    if (!r?.parent_chat_id) return cur;
    cur = r.parent_chat_id;
  }
  return cur;
}

const dto = (r: any): SlotDTO => ({ id: r.id, name: r.name, sourceChatId: r.source_chat_id, createdAt: r.created_at, summary: json<SlotSummary>(r.summary, { location: null, when: null, level: null, messages: 0, last: '' }) });

function lastMessage(ctx: AppContext, chatId: string) {
  return ctx.db.prepare('SELECT id, swipes, swipe_id FROM messages WHERE chat_id = ? ORDER BY seq DESC LIMIT 1').get(chatId) as { id: string; swipes: string; swipe_id: number } | undefined;
}

export function listSlots(ctx: AppContext, owner: string, chatId: string): SlotDTO[] {
  getChat(ctx, owner, chatId);
  return (ctx.db.prepare('SELECT * FROM save_slots WHERE owner_id = ? AND story_id = ? ORDER BY created_at DESC').all(owner, storyRoot(ctx, chatId)) as any[]).map(dto);
}

export function saveSlot(ctx: AppContext, owner: string, chatId: string, name?: string): SlotDTO {
  const chat = getChat(ctx, owner, chatId);
  const last = lastMessage(ctx, chatId);
  if (!last) throw new HttpError(400, 'Nothing to save yet');
  const n = (ctx.db.prepare('SELECT COUNT(*) AS n FROM save_slots WHERE owner_id = ? AND story_id = ?').get(owner, storyRoot(ctx, chatId)) as { n: number }).n;
  if (n >= 100) throw new HttpError(400, 'Up to 100 saves per story; delete an old one first');
  const s = chat.campaignId ? getState(ctx, owner, chat.campaignId) : null;
  const count = (ctx.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?').get(chatId) as { n: number }).n;
  const text = String(json<any[]>(last.swipes, [])[last.swipe_id]?.text ?? '').replace(/\s+/g, ' ').trim();
  const summary: SlotSummary = {
    location: s?.currentLocationId ? (s.locations[s.currentLocationId]?.name ?? null) : null,
    when: s ? `${formatDate(s.time.minutes, s.meta.calendar)}, ${formatClock(s.time.minutes, s.meta.calendar)}` : null,
    level: s ? s.player.level : null,
    messages: count,
    last: text.slice(0, 200),
  };
  const label = (name ?? '').trim() || `Save ${n + 1}`;
  const copy = branchChat(ctx, owner, chatId, last.id, `${chat.title} — ${label}`);
  ctx.db.prepare('UPDATE chats SET slot = 1 WHERE id = ?').run(copy.id);
  const id = newId('sv_');
  const row = { id, owner_id: owner, story_id: storyRoot(ctx, chatId), source_chat_id: chatId, slot_chat_id: copy.id, name: label.slice(0, 80), summary: JSON.stringify(summary), created_at: Date.now() };
  ctx.db.prepare('INSERT INTO save_slots (id, owner_id, story_id, source_chat_id, slot_chat_id, name, summary, created_at) VALUES (@id, @owner_id, @story_id, @source_chat_id, @slot_chat_id, @name, @summary, @created_at)').run(row);
  return dto(row);
}

function slotRow(ctx: AppContext, owner: string, id: string) {
  const r = ctx.db.prepare('SELECT * FROM save_slots WHERE id = ? AND owner_id = ?').get(id, owner) as any;
  if (!r) throw new HttpError(404, 'Save not found');
  return r;
}

/** Load: a new chat forked from the slot. The slot itself stays as it was. */
export function loadSlot(ctx: AppContext, owner: string, id: string) {
  const r = slotRow(ctx, owner, id);
  const last = lastMessage(ctx, r.slot_chat_id);
  if (!last) throw new HttpError(410, 'This save is empty');
  const source = ctx.db.prepare('SELECT title FROM chats WHERE id = ?').get(r.source_chat_id) as { title: string } | undefined;
  const chat = branchChat(ctx, owner, r.slot_chat_id, last.id, `${source?.title ?? 'Story'} (from ${r.name})`);
  return chat;
}

export function renameSlot(ctx: AppContext, owner: string, id: string, name: string) {
  slotRow(ctx, owner, id);
  ctx.db.prepare('UPDATE save_slots SET name = ? WHERE id = ?').run(name.trim().slice(0, 80) || 'Save', id);
  return dto(slotRow(ctx, owner, id));
}

export function deleteSlot(ctx: AppContext, owner: string, id: string) {
  const r = slotRow(ctx, owner, id);
  try {
    deleteChat(ctx, owner, r.slot_chat_id);
  } catch {
    /* already gone */
  }
  ctx.db.prepare('DELETE FROM save_slots WHERE id = ?').run(id);
}
