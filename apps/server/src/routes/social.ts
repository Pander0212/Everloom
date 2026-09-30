import { formatClock, formatDate, stripInlineTags, validateOps, type CampaignState, type Op, type OpType } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { json } from '../db/index.js';
import { newId } from '../security/crypto.js';
import { appendOps, campaignRow, getState } from '../services/campaigns.js';
import { getChat } from '../services/chats.js';
import { indexDoc, removeDoc } from '../services/search.js';
import { utilityJson, utilityText } from '../services/utility.js';
import { parse } from '../util/validate.js';

/** Ops the helper may propose. Nothing happens until the player accepts. */
const HELPER_OPS: OpType[] = [
  'item.add', 'item.remove', 'currency.delta', 'tracker.set', 'tracker.delta', 'time.advance', 'weather.set', 'quest.add', 'quest.update',
  'databank.add', 'event.add', 'npc.upsert', 'location.upsert', 'relationship.delta', 'status.add', 'status.remove',
];

export function lastMessageId(ctx: AppContext, chatId: string): string | null {
  return (ctx.db.prepare('SELECT id FROM messages WHERE chat_id = ? ORDER BY seq DESC LIMIT 1').get(chatId) as { id: string } | undefined)?.id ?? null;
}

export function chatForCampaign(ctx: AppContext, ownerId: string, campaignId: string, chatId: string) {
  const chat = getChat(ctx, ownerId, chatId);
  if (chat.campaignId !== campaignId) throw new HttpError(400, 'Chat is not linked to this campaign');
  return chat;
}

/** Last few story turns as plain text, newest last. */
export function recentStory(ctx: AppContext, chatId: string, n = 8, maxChars = 5000): string {
  const rows = ctx.db.prepare('SELECT name, swipes, swipe_id FROM messages WHERE chat_id = ? AND hidden = 0 ORDER BY seq DESC LIMIT ?').all(chatId, n) as Array<{ name: string; swipes: string; swipe_id: number }>;
  const text = rows
    .reverse()
    .map((r) => `${r.name}: ${stripInlineTags(json<any[]>(r.swipes, [])[r.swipe_id]?.text ?? '')}`)
    .join('\n\n');
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

export function briefState(s: CampaignState): string {
  const loc = s.currentLocationId ? s.locations[s.currentLocationId]?.name : 'unknown';
  const trackers = Object.values(s.trackers).map((t) => `${t.label} ${Math.round(t.value)}/${t.max}`).join(', ');
  const items = Object.values(s.inventory).slice(0, 12).map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(', ');
  const quests = Object.values(s.quests).filter((q) => q.status === 'active').map((q) => q.title).join(', ');
  return [
    `Player: ${s.player.name}${s.player.className ? ` (${s.player.className})` : ''}, level ${s.player.level}`,
    `Time: ${formatDate(s.time.minutes, s.meta.calendar)} ${formatClock(s.time.minutes, s.meta.calendar)}, ${s.weather.kind}`,
    `Location: ${loc}`,
    trackers && `Needs: ${trackers}`,
    `${s.meta.currency.name}: ${s.player.currency}`,
    items && `Carrying: ${items}`,
    quests && `Active quests: ${quests}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface PhoneRow {
  id: string;
  npc_id: string;
  from_player: number;
  text: string;
  game_time: number | null;
  created_at: number;
  kind?: string;
  speaker_id?: string | null;
}

export const phoneDTO = (r: PhoneRow) => ({ id: r.id, npcId: r.npc_id, fromPlayer: !!r.from_player, text: r.text, gameTime: r.game_time, createdAt: r.created_at, kind: r.kind ?? 'text', speakerId: r.speaker_id ?? null });

export function thread(ctx: AppContext, ownerId: string, campaignId: string, npcId: string, limit = 60): PhoneRow[] {
  return (ctx.db.prepare('SELECT * FROM phone_messages WHERE owner_id = ? AND campaign_id = ? AND npc_id = ? ORDER BY created_at DESC LIMIT ?').all(ownerId, campaignId, npcId, limit) as PhoneRow[]).reverse();
}

export function insertPhone(ctx: AppContext, ownerId: string, campaignId: string, npcId: string, fromPlayer: boolean, text: string, gameTime: number | null, extra: { kind?: string; speakerId?: string | null } = {}): PhoneRow {
  const row: PhoneRow = { id: newId('ph_'), npc_id: npcId, from_player: fromPlayer ? 1 : 0, text: text.slice(0, 2000), game_time: gameTime, created_at: Date.now(), kind: extra.kind ?? 'text', speaker_id: extra.speakerId ?? null };
  // created_at must be strictly increasing within a thread for stable ordering.
  const last = ctx.db.prepare('SELECT MAX(created_at) AS t FROM phone_messages WHERE campaign_id = ? AND npc_id = ?').get(campaignId, npcId) as { t: number | null };
  if (last.t && row.created_at <= last.t) row.created_at = last.t + 1;
  ctx.db.prepare('INSERT INTO phone_messages (id, owner_id, campaign_id, npc_id, from_player, text, game_time, created_at, kind, speaker_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(row.id, ownerId, campaignId, row.npc_id, row.from_player, row.text, row.game_time, row.created_at, row.kind, row.speaker_id);
  return row;
}

export async function npcText(ctx: AppContext, ownerId: string, s: CampaignState, npcId: string, history: PhoneRow[], reason: string | null, mode: 'text' | 'call' | 'group' = 'text', groupName?: string): Promise<string> {
  const npc = s.npcs[npcId];
  const rel = Object.values(s.relationships).find((r) => r.npcId === npcId);
  const system = [
    mode === 'call'
      ? `You are ${npc.name}${npc.role && npc.role !== 'NPC' ? `, ${npc.role}` : ''}, on a voice call with ${s.player.name}.`
      : mode === 'group'
        ? `You are ${npc.name}${npc.role && npc.role !== 'NPC' ? `, ${npc.role}` : ''}, in the group chat "${groupName ?? 'Group'}" with ${s.player.name} and others.`
        : `You are ${npc.name}${npc.role && npc.role !== 'NPC' ? `, ${npc.role}` : ''}, texting ${s.player.name} on the phone.`,
    npc.personality && `Personality: ${npc.personality}`,
    rel && `How you feel about ${s.player.name}: ${rel.label} (affection ${rel.affection}, trust ${rel.trust}).`,
    rel?.memories.length ? `Shared memories: ${rel.memories.slice(-4).map((m) => m.text).join('; ')}` : '',
    `It is ${formatDate(s.time.minutes, s.meta.calendar)}, ${formatClock(s.time.minutes, s.meta.calendar)}.`,
    mode === 'call'
      ? 'Say your next line out loud: 1–3 natural spoken sentences in your own voice. No quotation marks, no name prefix, no stage directions.'
      : 'Write one short text message (1–3 sentences) in your own voice. No quotation marks, no name prefix, no narration, no emoji.',
  ]
    .filter(Boolean)
    .join('\n');
  const convo = history
    .slice(-12)
    .map((m) => `${m.from_player ? s.player.name : (s.npcs[m.speaker_id ?? '']?.name ?? npc.name)}: ${m.text}`)
    .join('\n');
  const user = reason ? `${convo ? `Earlier texts:\n${convo}\n\n` : ''}Start a new conversation. Reason: ${reason}.` : `Texts so far:\n${convo}\n\nReply to the last message.`;
  // Texts are in-character writing, so they come from the Main model.
  const text = await utilityText(ctx, ownerId, system, user, { maxTokens: 160, temperature: 0.9, role: 'main', purpose: mode === 'call' ? 'phone call' : mode === 'group' ? 'group text' : 'phone text' });
  return text.replace(/^["“]|["”]$/g, '').replace(new RegExp(`^${npc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`, 'i'), '').trim().slice(0, 600) || '…';
}

export function registerSocial(app: FastifyInstance, ctx: AppContext) {
  // ---------------------------------------------------------------- phone
  app.get('/api/campaigns/:id/phone', async (req) => {
    const o = owner(req);
    const campaignId = (req.params as { id: string }).id;
    const s = getState(ctx, o, campaignId);
    const last = ctx.db
      .prepare('SELECT p.* FROM phone_messages p JOIN (SELECT npc_id, MAX(created_at) AS t FROM phone_messages WHERE owner_id = ? AND campaign_id = ? GROUP BY npc_id) x ON x.npc_id = p.npc_id AND x.t = p.created_at WHERE p.campaign_id = ?')
      .all(o, campaignId, campaignId) as PhoneRow[];
    const byNpc = new Map(last.map((r) => [r.npc_id, r]));
    const ids = new Set([...byNpc.keys(), ...Object.values(s.npcs).filter((n) => n.phone).map((n) => n.id), ...Object.keys(s.phone.unread)]);
    const threads = [...ids]
      .filter((id) => s.npcs[id])
      .map((id) => ({ npcId: id, name: s.npcs[id].name, portrait: s.npcs[id].portrait ?? null, characterId: s.npcs[id].characterId ?? null, unread: s.phone.unread[id] ?? 0, last: byNpc.get(id) ? phoneDTO(byNpc.get(id)!) : null }))
      .sort((a, b) => b.unread - a.unread || (b.last?.createdAt ?? 0) - (a.last?.createdAt ?? 0));
    const groups = Object.values(s.phone.groups ?? {}).map((g) => ({ id: g.id, name: g.name, members: g.members.map((id) => s.npcs[id]?.name ?? '?'), last: byNpc.get(`group:${g.id}`) ? phoneDTO(byNpc.get(`group:${g.id}`)!) : null }));
    return { threads, groups };
  });

  /** Open a thread: waiting texts from the simulation are written now, then the thread is marked read. */
  app.post('/api/campaigns/:id/phone/:npcId/open', async (req) => {
    const o = owner(req);
    const { id: campaignId, npcId } = req.params as { id: string; npcId: string };
    const b = parse(z.object({ chatId: z.string() }), req.body);
    chatForCampaign(ctx, o, campaignId, b.chatId);
    const s = getState(ctx, o, campaignId);
    if (!s.npcs[npcId]) throw new HttpError(404, 'Contact not found');
    const pending = s.phone.pending.filter((p) => p.npcId === npcId);
    let error: string | null = null;
    for (const p of pending.slice(-3)) {
      try {
        const text = await npcText(ctx, o, s, npcId, thread(ctx, o, campaignId, npcId), p.reason);
        insertPhone(ctx, o, campaignId, npcId, false, text, p.at);
      } catch (e) {
        error = (e as Error).message;
        break;
      }
    }
    let state = s;
    if (!error && (pending.length || s.phone.unread[npcId])) {
      state = appendOps(ctx, o, campaignId, { chatId: b.chatId, messageId: lastMessageId(ctx, b.chatId), swipeId: null, source: 'user', ops: [{ type: 'phone.read', npc: npcId } as Op], origin: req.clientId }).state;
    }
    return { messages: thread(ctx, o, campaignId, npcId).map(phoneDTO), state, error };
  });

  app.post('/api/campaigns/:id/phone/:npcId', async (req) => {
    const o = owner(req);
    const { id: campaignId, npcId } = req.params as { id: string; npcId: string };
    const b = parse(z.object({ chatId: z.string(), text: z.string().trim().min(1).max(1000), reply: z.boolean().default(true) }), req.body);
    chatForCampaign(ctx, o, campaignId, b.chatId);
    const s = getState(ctx, o, campaignId);
    if (!s.npcs[npcId]) throw new HttpError(404, 'Contact not found');
    const sent = insertPhone(ctx, o, campaignId, npcId, true, b.text, s.time.minutes);
    let reply: PhoneRow | null = null;
    let error: string | null = null;
    if (b.reply && s.npcs[npcId].status === 'alive') {
      try {
        reply = insertPhone(ctx, o, campaignId, npcId, false, await npcText(ctx, o, s, npcId, thread(ctx, o, campaignId, npcId), null), s.time.minutes);
      } catch (e) {
        error = (e as Error).message;
      }
    }
    // Make the NPC reachable by phone from now on.
    if (!s.npcs[npcId].phone) appendOps(ctx, o, campaignId, { chatId: b.chatId, messageId: lastMessageId(ctx, b.chatId), swipeId: null, source: 'user', ops: [{ type: 'npc.set', id: npcId, patch: { phone: true } } as Op], origin: req.clientId });
    return { sent: phoneDTO(sent), reply: reply ? phoneDTO(reply) : null, error };
  });

  app.delete('/api/campaigns/:id/phone/:npcId', async (req) => {
    const o = owner(req);
    const { id: campaignId, npcId } = req.params as { id: string; npcId: string };
    campaignRow(ctx, o, campaignId);
    ctx.db.prepare('DELETE FROM phone_messages WHERE owner_id = ? AND campaign_id = ? AND npc_id = ?').run(o, campaignId, npcId);
    return { ok: true };
  });

  // ---------------------------------------------------------------- helper
  const helperDTO = (r: any) => ({ id: r.id, role: r.role, text: r.text, proposal: json<Op[] | null>(r.proposal, null), status: r.status, createdAt: r.created_at });

  app.get('/api/helper', async (req) => {
    const q = req.query as { campaignId?: string };
    const rows = ctx.db.prepare('SELECT * FROM helper_messages WHERE owner_id = ? AND campaign_id IS ? ORDER BY created_at DESC LIMIT 80').all(owner(req), q.campaignId ?? null) as any[];
    return rows.reverse().map(helperDTO);
  });

  app.post('/api/helper/ask', async (req) => {
    const o = owner(req);
    const b = parse(z.object({ text: z.string().trim().min(1).max(2000), chatId: z.string().optional(), name: z.string().max(40).default('Pip') }), req.body);
    const chat = b.chatId ? getChat(ctx, o, b.chatId) : null;
    const campaignId = chat?.campaignId ?? null;
    const s = campaignId ? getState(ctx, o, campaignId) : null;
    const now = Date.now();
    ctx.db.prepare('INSERT INTO helper_messages (id, owner_id, campaign_id, role, text, proposal, status, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(newId('hm_'), o, campaignId, 'user', b.text, 'none', now);
    const history = (ctx.db.prepare('SELECT role, text FROM helper_messages WHERE owner_id = ? AND campaign_id IS ? ORDER BY created_at DESC LIMIT 8').all(o, campaignId) as Array<{ role: string; text: string }>).reverse();
    const system = [
      `You are ${b.name}, a small, friendly helper companion inside Everloom, a roleplay app with a light game layer. You speak briefly and warmly, in plain words.`,
      'You help the player understand their game (needs, items, quests, map, time), suggest what to do next, and explain app features (swipes, lorebooks, presets, map travel, New Game, phone, diary).',
      'You never write the story itself. If the player asks you to change the game state, propose changes as ops for them to accept.',
      'Reply with JSON only: {"reply":"your answer (max 80 words)","ops":[optional list of ops]}',
      `Allowed ops: ${HELPER_OPS.join(', ')}. Examples: {"type":"item.add","name":"Bread","qty":2}, {"type":"tracker.set","id":"hunger","value":10}, {"type":"time.advance","minutes":60}.`,
    ].join('\n');
    const user = [s ? `Game state:\n${briefState(s)}` : 'No game is running in this chat.', chat ? `Recent story:\n${recentStory(ctx, chat.id, 4, 2500)}` : '', `Conversation:\n${history.map((h) => `${h.role === 'user' ? 'Player' : b.name}: ${h.text}`).join('\n')}`].filter(Boolean).join('\n\n');
    const out = await utilityJson<{ reply?: string; ops?: unknown[] }>(ctx, o, system, user, 700, 'helper');
    const v = s && Array.isArray(out.ops) && out.ops.length ? validateOps(out.ops.slice(0, 12), HELPER_OPS) : { ok: [] as Op[], rejected: [] };
    const row = { id: newId('hm_'), text: String(out.reply ?? '').slice(0, 1500) || 'Hmm, I’m not sure.', proposal: v.ok.length ? JSON.stringify(v.ok) : null, status: v.ok.length ? 'pending' : 'none', created_at: Date.now() };
    ctx.db.prepare('INSERT INTO helper_messages (id, owner_id, campaign_id, role, text, proposal, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(row.id, o, campaignId, 'helper', row.text, row.proposal, row.status, row.created_at);
    return helperDTO({ ...row, role: 'helper' });
  });

  app.post('/api/helper/:id/:decision', async (req) => {
    const o = owner(req);
    const { id, decision } = req.params as { id: string; decision: string };
    if (decision !== 'accept' && decision !== 'reject') throw new HttpError(404, 'Not found');
    const b = parse(z.object({ chatId: z.string().optional() }), req.body ?? {});
    const row = ctx.db.prepare('SELECT * FROM helper_messages WHERE id = ? AND owner_id = ?').get(id, o) as any;
    if (!row) throw new HttpError(404, 'Not found');
    if (row.status !== 'pending') throw new HttpError(409, 'Already decided');
    let result: { state: CampaignState; summary: string[] } | null = null;
    if (decision === 'accept') {
      if (!row.campaign_id || !b.chatId) throw new HttpError(400, 'Open the chat to apply this');
      chatForCampaign(ctx, o, row.campaign_id, b.chatId);
      const v = validateOps(json<unknown[]>(row.proposal, []), HELPER_OPS);
      const r = appendOps(ctx, o, row.campaign_id, { chatId: b.chatId, messageId: lastMessageId(ctx, b.chatId), swipeId: null, source: 'user', ops: v.ok, origin: req.clientId });
      result = { state: r.state, summary: r.summary };
    }
    ctx.db.prepare('UPDATE helper_messages SET status = ? WHERE id = ?').run(decision === 'accept' ? 'accepted' : 'rejected', id);
    return { status: decision === 'accept' ? 'accepted' : 'rejected', ...(result ?? {}) };
  });

  app.delete('/api/helper', async (req) => {
    const q = req.query as { campaignId?: string };
    ctx.db.prepare('DELETE FROM helper_messages WHERE owner_id = ? AND campaign_id IS ?').run(owner(req), q.campaignId ?? null);
    return { ok: true };
  });

  // ---------------------------------------------------------------- diary
  const diaryContent = z.object({
    text: z.string().max(20000).default(''),
    mood: z.string().max(30).optional(),
    photos: z.array(z.object({ mediaId: z.string().max(80), caption: z.string().max(200).default(''), rot: z.number().min(-15).max(15).default(0) })).max(12).default([]),
    stickers: z.array(z.object({ icon: z.string().max(40), x: z.number().min(0).max(100), y: z.number().min(0).max(100), rot: z.number().min(-45).max(45).default(0) })).max(24).default([]),
  });
  const diaryDTO = (r: any) => ({ id: r.id, campaignId: r.campaign_id, number: r.number, title: r.title, content: json(r.content, { text: '', photos: [], stickers: [] }), gameTime: r.game_time, createdAt: r.created_at, updatedAt: r.updated_at });

  app.get('/api/campaigns/:id/diary', async (req) => {
    const o = owner(req);
    const campaignId = (req.params as { id: string }).id;
    campaignRow(ctx, o, campaignId);
    return (ctx.db.prepare('SELECT * FROM diary WHERE owner_id = ? AND campaign_id = ? ORDER BY number').all(o, campaignId) as any[]).map(diaryDTO);
  });

  app.post('/api/campaigns/:id/diary', async (req) => {
    const o = owner(req);
    const campaignId = (req.params as { id: string }).id;
    const b = parse(z.object({ title: z.string().max(200).default(''), content: diaryContent }), req.body);
    const s = getState(ctx, o, campaignId);
    const n = ((ctx.db.prepare('SELECT MAX(number) AS n FROM diary WHERE campaign_id = ?').get(campaignId) as { n: number | null }).n ?? 0) + 1;
    const id = newId('d_');
    const now = Date.now();
    const title = b.title.trim() || formatDate(s.time.minutes, s.meta.calendar);
    ctx.db.prepare('INSERT INTO diary (id, owner_id, campaign_id, number, title, content, game_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, o, campaignId, n, title, JSON.stringify(b.content), s.time.minutes, now, now);
    indexDoc(ctx, o, campaignId, 'diary', id, title, b.content.text);
    return diaryDTO(ctx.db.prepare('SELECT * FROM diary WHERE id = ?').get(id));
  });

  app.put('/api/diary/:id', async (req) => {
    const o = owner(req);
    const id = (req.params as { id: string }).id;
    const b = parse(z.object({ title: z.string().max(200), content: diaryContent }), req.body);
    const row = ctx.db.prepare('SELECT * FROM diary WHERE id = ? AND owner_id = ?').get(id, o) as any;
    if (!row) throw new HttpError(404, 'Entry not found');
    ctx.db.prepare('UPDATE diary SET title = ?, content = ?, updated_at = ? WHERE id = ?').run(b.title.trim() || row.title, JSON.stringify(b.content), Date.now(), id);
    indexDoc(ctx, o, row.campaign_id, 'diary', id, b.title, b.content.text);
    return diaryDTO(ctx.db.prepare('SELECT * FROM diary WHERE id = ?').get(id));
  });

  app.delete('/api/diary/:id', async (req) => {
    const o = owner(req);
    const id = (req.params as { id: string }).id;
    ctx.db.prepare('DELETE FROM diary WHERE id = ? AND owner_id = ?').run(id, o);
    removeDoc(ctx, o, 'diary', id);
    return { ok: true };
  });

  /** Draft today's entry in the player's voice from the recent story. Not saved until the player saves it. */
  app.post('/api/campaigns/:id/diary/draft', async (req) => {
    const o = owner(req);
    const campaignId = (req.params as { id: string }).id;
    const b = parse(z.object({ chatId: z.string() }), req.body);
    chatForCampaign(ctx, o, campaignId, b.chatId);
    const s = getState(ctx, o, campaignId);
    const out = await utilityJson<{ title?: string; text?: string; mood?: string }>(
      ctx,
      o,
      `Write a private diary entry in the first person as ${s.player.name}. Reflect on what happened, how it felt and what comes next. 120–220 words, natural and personal, no headings. Reply with JSON only: {"title":"short title","text":"the entry","mood":"one word"}`,
      `Game state:\n${briefState(s)}\n\nRecent story:\n${recentStory(ctx, b.chatId, 12, 7000)}`,
      900,
      'diary draft',
    );
    return { title: String(out.title ?? '').slice(0, 200), text: String(out.text ?? '').slice(0, 20000), mood: String(out.mood ?? '').slice(0, 30) };
  });
}
