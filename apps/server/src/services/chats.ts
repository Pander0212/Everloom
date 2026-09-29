import {
  createInitialState, exportChatJsonl, expandMacros, parseChatJsonl,
  type ChatDTO, type ChatMeta, type ChatSummary, type GroupDTO, type MessageDTO, type SwipeDTO,
} from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';
import { json } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { createCampaign, deleteEntriesFor, forkCampaign, onMessagesDeleted, onSwipeDeleted, rebuildCampaign } from './campaigns.js';
import { getCharacter } from './characters.js';
import { defaultPersona, getPersona } from './personas.js';
import { getSettings } from './settings.js';
import { indexDoc } from './search.js';

// ---------------------------------------------------------------- mapping

export function toMessage(r: any): MessageDTO {
  return {
    id: r.id,
    chatId: r.chat_id,
    seq: r.seq,
    role: r.role,
    name: r.name,
    characterId: r.character_id,
    swipeId: r.swipe_id,
    swipes: json<SwipeDTO[]>(r.swipes, [{ text: '', createdAt: r.created_at }]),
    hidden: !!r.hidden,
    bookmarked: !!r.bookmarked,
    extra: json(r.extra, {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toChat(r: any): ChatDTO {
  return {
    id: r.id,
    title: r.title,
    characterId: r.character_id,
    groupId: r.group_id,
    personaId: r.persona_id,
    campaignId: r.campaign_id,
    parentChatId: r.parent_chat_id,
    messageCount: r.message_count ?? 0,
    lastMessage: r.last_message ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    metadata: json<ChatMeta>(r.metadata, {}),
  };
}

const CHAT_SELECT = `SELECT c.*,
  (SELECT COUNT(*) FROM messages WHERE chat_id = c.id) AS message_count,
  (SELECT json_extract(swipes, '$[' || swipe_id || '].text') FROM messages WHERE chat_id = c.id ORDER BY seq DESC LIMIT 1) AS last_message
  FROM chats c`;

export function listChats(ctx: AppContext, owner: string, filter: { characterId?: string; groupId?: string } = {}): ChatSummary[] {
  let sql = `${CHAT_SELECT} WHERE c.owner_id = ?`;
  const args: unknown[] = [owner];
  if (filter.characterId) {
    sql += ' AND c.character_id = ?';
    args.push(filter.characterId);
  }
  if (filter.groupId) {
    sql += ' AND c.group_id = ?';
    args.push(filter.groupId);
  }
  return (ctx.db.prepare(sql + ' ORDER BY c.updated_at DESC LIMIT 500').all(...args) as any[]).map((r) => {
    const { metadata: _m, ...rest } = toChat(r);
    return { ...rest, lastMessage: String(rest.lastMessage ?? '').slice(0, 200) };
  });
}

export function getChat(ctx: AppContext, owner: string, id: string): ChatDTO {
  const r = ctx.db.prepare(`${CHAT_SELECT} WHERE c.id = ? AND c.owner_id = ?`).get(id, owner);
  if (!r) throw new HttpError(404, 'Chat not found');
  return toChat(r);
}

export function listMessages(ctx: AppContext, owner: string, chatId: string): MessageDTO[] {
  getChat(ctx, owner, chatId);
  return (ctx.db.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY seq').all(chatId) as any[]).map(toMessage);
}

export function getMessage(ctx: AppContext, owner: string, id: string): MessageDTO {
  const r = ctx.db.prepare('SELECT * FROM messages WHERE id = ? AND owner_id = ?').get(id, owner);
  if (!r) throw new HttpError(404, 'Message not found');
  return toMessage(r);
}

function touchChat(ctx: AppContext, chatId: string) {
  ctx.db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?').run(Date.now(), chatId);
}

// ---------------------------------------------------------------- groups

function toGroup(r: any): GroupDTO {
  return { id: r.id, name: r.name, avatar: r.avatar ? `/media/${r.avatar}` : null, members: json(r.members, []), strategy: r.strategy, createdAt: r.created_at, updatedAt: r.updated_at };
}

export function listGroups(ctx: AppContext, owner: string): GroupDTO[] {
  return (ctx.db.prepare('SELECT * FROM groups WHERE owner_id = ? ORDER BY updated_at DESC').all(owner) as any[]).map(toGroup);
}

export function getGroup(ctx: AppContext, owner: string, id: string): GroupDTO {
  const r = ctx.db.prepare('SELECT * FROM groups WHERE id = ? AND owner_id = ?').get(id, owner);
  if (!r) throw new HttpError(404, 'Group not found');
  return toGroup(r);
}

export function saveGroup(ctx: AppContext, owner: string, input: { name: string; members: GroupDTO['members']; strategy?: GroupDTO['strategy'] }, id?: string): GroupDTO {
  const now = Date.now();
  for (const m of input.members) getCharacter(ctx, owner, m.characterId);
  if (id) {
    getGroup(ctx, owner, id);
    ctx.db.prepare('UPDATE groups SET name = ?, members = ?, strategy = ?, updated_at = ? WHERE id = ?').run(input.name, JSON.stringify(input.members), input.strategy ?? 'natural', now, id);
    return getGroup(ctx, owner, id);
  }
  const gid = newId('g_');
  ctx.db.prepare('INSERT INTO groups (id, owner_id, name, members, strategy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(gid, owner, input.name, JSON.stringify(input.members), input.strategy ?? 'natural', now, now);
  return getGroup(ctx, owner, gid);
}

export function deleteGroup(ctx: AppContext, owner: string, id: string) {
  ctx.db.prepare('DELETE FROM groups WHERE id = ? AND owner_id = ?').run(id, owner);
}

// ---------------------------------------------------------------- chats

export interface CreateChatInput {
  characterId?: string | null;
  groupId?: string | null;
  personaId?: string | null;
  title?: string;
  /** 'new' (default), 'none', or an existing campaign id to link. */
  campaign?: string;
  greeting?: boolean;
}

export function insertMessage(
  ctx: AppContext,
  owner: string,
  chatId: string,
  m: { role: MessageDTO['role']; name: string; characterId?: string | null; swipes: SwipeDTO[]; swipeId?: number; hidden?: boolean; extra?: Record<string, unknown>; createdAt?: number },
): MessageDTO {
  const id = newId('msg_');
  const now = m.createdAt ?? Date.now();
  const seq = ((ctx.db.prepare('SELECT MAX(seq) AS s FROM messages WHERE chat_id = ?').get(chatId) as { s: number | null }).s ?? 0) + 1;
  ctx.db
    .prepare('INSERT INTO messages (id, owner_id, chat_id, seq, role, name, character_id, swipe_id, swipes, hidden, bookmarked, extra, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)')
    .run(id, owner, chatId, seq, m.role, m.name, m.characterId ?? null, m.swipeId ?? 0, JSON.stringify(m.swipes), m.hidden ? 1 : 0, JSON.stringify(m.extra ?? {}), now, now);
  touchChat(ctx, chatId);
  return getMessage(ctx, owner, id);
}

export function createChat(ctx: AppContext, owner: string, input: CreateChatInput): ChatDTO {
  if (!input.characterId && !input.groupId) throw new HttpError(400, 'A chat needs a character or a group');
  const persona = input.personaId ? getPersona(ctx, owner, input.personaId) : defaultPersona(ctx, owner);
  const userName = persona?.name ?? 'You';
  const characters = input.groupId
    ? getGroup(ctx, owner, input.groupId).members.map((m) => getCharacter(ctx, owner, m.characterId))
    : [getCharacter(ctx, owner, input.characterId!)];
  const group = input.groupId ? getGroup(ctx, owner, input.groupId) : null;
  const title = input.title?.trim() || `${group?.name ?? characters[0].name} — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  let campaignId: string | null = null;
  if (input.campaign && input.campaign !== 'new' && input.campaign !== 'none') campaignId = input.campaign;
  else if (input.campaign !== 'none') {
    const state = createInitialState({ title, seed: Math.floor(Math.random() * 2 ** 31), playerName: userName });
    if (persona?.age != null) state.player.age = persona.age;
    if (persona?.ageStage) state.player.ageStage = persona.ageStage;
    if (persona?.data.engine?.className) state.player.className = persona.data.engine.className;
    campaignId = createCampaign(ctx, owner, title, state);
  }
  const id = newId('c_');
  const now = Date.now();
  const settings = getSettings(ctx, owner);
  ctx.db
    .prepare('INSERT INTO chats (id, owner_id, character_id, group_id, title, persona_id, campaign_id, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, owner, input.characterId ?? null, input.groupId ?? null, title, persona?.id ?? null, campaignId, JSON.stringify({ mode: settings.chat.defaultMode } satisfies ChatMeta), now, now);
  if (input.greeting !== false) {
    for (const ch of characters) {
      const greetings = [ch.card.first_mes, ...(group ? ch.card.group_only_greetings ?? [] : []), ...(ch.card.alternate_greetings ?? [])].filter((g) => g && g.trim());
      if (!greetings.length) continue;
      const macros = { char: ch.name, user: userName };
      insertMessage(ctx, owner, id, {
        role: 'assistant',
        name: ch.name,
        characterId: ch.id,
        swipes: greetings.map((g) => ({ text: expandMacros(g, macros), createdAt: now })),
      });
      if (!group) break;
    }
  }
  for (const ch of characters) ctx.db.prepare('UPDATE characters SET last_chat_at = ? WHERE id = ?').run(now, ch.id);
  return getChat(ctx, owner, id);
}

export function updateChat(ctx: AppContext, owner: string, id: string, patch: { title?: string; personaId?: string | null; metadata?: Partial<ChatMeta>; campaignId?: string | null }): ChatDTO {
  const cur = getChat(ctx, owner, id);
  const meta = patch.metadata ? { ...cur.metadata, ...patch.metadata } : cur.metadata;
  ctx.db
    .prepare('UPDATE chats SET title = ?, persona_id = ?, metadata = ?, campaign_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .run(patch.title ?? cur.title, patch.personaId === undefined ? cur.personaId : patch.personaId, JSON.stringify(meta), patch.campaignId === undefined ? cur.campaignId : patch.campaignId, Date.now(), id, owner);
  return getChat(ctx, owner, id);
}

export function deleteChat(ctx: AppContext, owner: string, id: string) {
  const chat = getChat(ctx, owner, id);
  ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM messages WHERE chat_id = ?').run(id);
    ctx.db.prepare('DELETE FROM chats WHERE id = ? AND owner_id = ?').run(id, owner);
    ctx.db.prepare('DELETE FROM memories WHERE chat_id = ?').run(id);
    ctx.db.prepare("DELETE FROM lorebooks WHERE scope = 'chat' AND scope_id = ? AND owner_id = ?").run(id, owner);
    if (chat.campaignId) {
      const others = (ctx.db.prepare('SELECT COUNT(*) AS n FROM chats WHERE campaign_id = ?').get(chat.campaignId) as { n: number }).n;
      if (!others) ctx.db.prepare('DELETE FROM campaigns WHERE id = ? AND owner_id = ?').run(chat.campaignId, owner);
      else ctx.db.prepare('DELETE FROM op_log WHERE campaign_id = ? AND chat_id = ?').run(chat.campaignId, id);
    }
  })();
  if (chat.campaignId) {
    try {
      rebuildCampaign(ctx, owner, chat.campaignId);
    } catch {
      /* campaign deleted */
    }
  }
}

/** Branch: copy messages up to and including `messageId` into a new chat, forking the campaign. */
export function branchChat(ctx: AppContext, owner: string, chatId: string, messageId: string, title?: string): ChatDTO {
  const chat = getChat(ctx, owner, chatId);
  const target = getMessage(ctx, owner, messageId);
  if (target.chatId !== chatId) throw new HttpError(400, 'Message is not in this chat');
  const rows = ctx.db.prepare('SELECT * FROM messages WHERE chat_id = ? AND seq <= ? ORDER BY seq').all(chatId, target.seq) as any[];
  const newChatId = newId('c_');
  const now = Date.now();
  const map = new Map<string, string>();
  ctx.db.transaction(() => {
    ctx.db
      .prepare('INSERT INTO chats (id, owner_id, character_id, group_id, title, persona_id, campaign_id, parent_chat_id, branch_message_id, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)')
      .run(newChatId, owner, chat.characterId, chat.groupId, title ?? `${chat.title} (branch)`, chat.personaId, chatId, messageId, JSON.stringify({ ...chat.metadata, lastPrompt: undefined }), now, now);
    const ins = ctx.db.prepare('INSERT INTO messages (id, owner_id, chat_id, seq, role, name, character_id, swipe_id, swipes, hidden, bookmarked, extra, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of rows) {
      const nid = newId('msg_');
      map.set(r.id, nid);
      ins.run(nid, owner, newChatId, r.seq, r.role, r.name, r.character_id, r.swipe_id, r.swipes, r.hidden, r.bookmarked, r.extra, r.created_at, r.updated_at);
    }
  })();
  if (chat.campaignId) {
    const cid = forkCampaign(ctx, owner, chat.campaignId, chatId, newChatId, map);
    ctx.db.prepare('UPDATE chats SET campaign_id = ? WHERE id = ?').run(cid, newChatId);
    rebuildCampaign(ctx, owner, cid);
  }
  return getChat(ctx, owner, newChatId);
}

export function duplicateChat(ctx: AppContext, owner: string, chatId: string): ChatDTO {
  const last = ctx.db.prepare('SELECT id FROM messages WHERE chat_id = ? ORDER BY seq DESC LIMIT 1').get(chatId) as { id: string } | undefined;
  const chat = getChat(ctx, owner, chatId);
  if (!last) return createChat(ctx, owner, { characterId: chat.characterId, groupId: chat.groupId, personaId: chat.personaId, title: `${chat.title} (copy)`, greeting: false });
  return branchChat(ctx, owner, chatId, last.id, `${chat.title} (copy)`);
}

// ---------------------------------------------------------------- messages

export function updateMessage(
  ctx: AppContext,
  owner: string,
  id: string,
  patch: { text?: string; hidden?: boolean; bookmarked?: boolean; extra?: Record<string, unknown>; reasoning?: string },
): { message: MessageDTO; textChanged: boolean } {
  const m = getMessage(ctx, owner, id);
  const swipes = m.swipes.slice();
  let textChanged = false;
  if (patch.text !== undefined && patch.text !== swipes[m.swipeId]?.text) {
    swipes[m.swipeId] = { ...swipes[m.swipeId], text: patch.text, changes: undefined };
    textChanged = true;
  }
  if (patch.reasoning !== undefined) swipes[m.swipeId] = { ...swipes[m.swipeId], reasoning: patch.reasoning };
  ctx.db
    .prepare('UPDATE messages SET swipes = ?, hidden = ?, bookmarked = ?, extra = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(swipes), (patch.hidden ?? m.hidden) ? 1 : 0, (patch.bookmarked ?? m.bookmarked) ? 1 : 0, JSON.stringify({ ...m.extra, ...(patch.extra ?? {}) }), Date.now(), id);
  if (textChanged) {
    const chat = getChat(ctx, owner, m.chatId);
    if (chat.campaignId) deleteEntriesFor(ctx, chat.campaignId, id, m.swipeId, ['ai']);
  }
  return { message: getMessage(ctx, owner, id), textChanged };
}

export function writeSwipes(ctx: AppContext, id: string, swipes: SwipeDTO[], swipeId: number) {
  ctx.db.prepare('UPDATE messages SET swipes = ?, swipe_id = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(swipes), swipeId, Date.now(), id);
}

export function setSwipe(ctx: AppContext, owner: string, id: string, swipeId: number): MessageDTO {
  const m = getMessage(ctx, owner, id);
  if (swipeId < 0 || swipeId >= m.swipes.length) throw new HttpError(400, 'No such swipe');
  if (swipeId === m.swipeId) return m;
  ctx.db.prepare('UPDATE messages SET swipe_id = ?, updated_at = ? WHERE id = ?').run(swipeId, Date.now(), id);
  const chat = getChat(ctx, owner, m.chatId);
  if (chat.campaignId) rebuildCampaign(ctx, owner, chat.campaignId);
  return getMessage(ctx, owner, id);
}

export function deleteSwipe(ctx: AppContext, owner: string, id: string, swipeId: number): MessageDTO {
  const m = getMessage(ctx, owner, id);
  if (m.swipes.length <= 1) throw new HttpError(400, 'Cannot delete the only swipe; delete the message instead');
  const swipes = m.swipes.filter((_, i) => i !== swipeId);
  const nextId = Math.min(swipes.length - 1, swipeId <= m.swipeId ? Math.max(0, m.swipeId - (swipeId < m.swipeId ? 1 : 0)) : m.swipeId);
  writeSwipes(ctx, id, swipes, nextId);
  const chat = getChat(ctx, owner, m.chatId);
  if (chat.campaignId) {
    onSwipeDeleted(ctx, chat.campaignId, id, swipeId);
    rebuildCampaign(ctx, owner, chat.campaignId);
  }
  return getMessage(ctx, owner, id);
}

/** Delete one message, or it and everything after it. */
export function deleteMessages(ctx: AppContext, owner: string, id: string, andAfter = false): string[] {
  const m = getMessage(ctx, owner, id);
  const chat = getChat(ctx, owner, m.chatId);
  const rows = (andAfter
    ? ctx.db.prepare('SELECT id, seq FROM messages WHERE chat_id = ? AND seq >= ?').all(m.chatId, m.seq)
    : [{ id: m.id, seq: m.seq }]) as Array<{ id: string; seq: number }>;
  ctx.db.transaction(() => {
    onMessagesDeleted(ctx, owner, m.chatId, rows, chat.campaignId);
    const ph = rows.map(() => '?').join(',');
    ctx.db.prepare(`DELETE FROM messages WHERE id IN (${ph})`).run(...rows.map((r) => r.id));
  })();
  touchChat(ctx, m.chatId);
  if (chat.campaignId) rebuildCampaign(ctx, owner, chat.campaignId);
  return rows.map((r) => r.id);
}

export function searchMessages(ctx: AppContext, owner: string, chatId: string, q: string): Array<{ id: string; seq: number; snippet: string }> {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const out: Array<{ id: string; seq: number; snippet: string }> = [];
  for (const m of listMessages(ctx, owner, chatId)) {
    const text = m.swipes[m.swipeId]?.text ?? '';
    const idx = text.toLowerCase().indexOf(needle);
    if (idx >= 0) out.push({ id: m.id, seq: m.seq, snippet: `${idx > 40 ? '…' : ''}${text.slice(Math.max(0, idx - 40), idx + needle.length + 60)}` });
  }
  return out.slice(0, 200);
}

// ---------------------------------------------------------------- import / export

export function exportChat(ctx: AppContext, owner: string, chatId: string): { filename: string; body: string } {
  const chat = getChat(ctx, owner, chatId);
  const messages = listMessages(ctx, owner, chatId);
  const persona = chat.personaId ? getPersona(ctx, owner, chat.personaId) : defaultPersona(ctx, owner);
  const charName = chat.characterId ? getCharacter(ctx, owner, chat.characterId).name : chat.title;
  const body = exportChatJsonl({
    userName: persona?.name ?? 'You',
    characterName: charName,
    createdAt: new Date(chat.createdAt).toISOString(),
    metadata: { note_prompt: chat.metadata.authorsNote?.content ?? '', note_depth: chat.metadata.authorsNote?.depth ?? 4, variables: chat.metadata.vars ?? {} },
    messages: messages.map((m) => ({
      role: m.role,
      name: m.name,
      swipeId: m.swipeId,
      swipes: m.swipes.map((s) => ({ text: s.text, reasoning: s.reasoning, createdAt: new Date(s.createdAt).toISOString(), model: s.model })),
      createdAt: new Date(m.createdAt).toISOString(),
      hidden: m.hidden,
      extra: {},
    })),
  });
  const safe = `${charName} - ${chat.title}`.replace(/[^\w\s.-]+/g, '').slice(0, 80) || 'chat';
  return { filename: `${safe}.jsonl`, body };
}

export function importChat(ctx: AppContext, owner: string, characterId: string, text: string, opts: { campaign?: boolean } = {}): ChatDTO {
  const character = getCharacter(ctx, owner, characterId);
  let file;
  try {
    file = parseChatJsonl(text);
  } catch (e) {
    throw new HttpError(400, `Not a chat file: ${(e as Error).message}`);
  }
  const chat = createChat(ctx, owner, { characterId, greeting: false, title: `${character.name} — imported`, campaign: opts.campaign === false ? 'none' : 'new' });
  const meta: Partial<ChatMeta> = {};
  if (typeof file.metadata.note_prompt === 'string' && file.metadata.note_prompt) {
    meta.authorsNote = { content: file.metadata.note_prompt, depth: Number(file.metadata.note_depth ?? 4) || 4, role: 'system' };
  }
  if (file.metadata.variables && typeof file.metadata.variables === 'object') meta.vars = file.metadata.variables as Record<string, string>;
  ctx.db.transaction(() => {
    for (const m of file.messages) {
      const t = Date.parse(m.createdAt);
      insertMessage(ctx, owner, chat.id, {
        role: m.role,
        name: m.role === 'assistant' ? m.name || character.name : m.name,
        characterId: m.role === 'assistant' ? characterId : null,
        swipes: m.swipes.map((s) => ({ text: s.text, reasoning: s.reasoning, createdAt: Date.parse(s.createdAt) || Date.now(), model: s.model })),
        swipeId: m.swipeId,
        hidden: m.hidden,
        createdAt: Number.isFinite(t) && t > 0 ? t : undefined,
      });
    }
  })();
  if (Object.keys(meta).length) updateChat(ctx, owner, chat.id, { metadata: meta });
  indexDoc(ctx, owner, chat.campaignId, 'chat', chat.id, chat.title, '');
  return getChat(ctx, owner, chat.id);
}
