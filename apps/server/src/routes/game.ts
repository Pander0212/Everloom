import { emptyCardData, extractJson, stripInlineTags, type Op } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { completeChat } from '../llm/providers.js';
import { appendOps, getState } from '../services/campaigns.js';
import { createCharacter, getCharacter } from '../services/characters.js';
import { getChat, listMessages } from '../services/chats.js';
import { connectionForRole } from '../services/connections.js';
import { parse } from '../util/validate.js';
import { registerGameExtras } from './game-extras.js';

export function registerGame(app: FastifyInstance, ctx: AppContext) {
  /** Three short things the player could do next, written by the utility model. */
  app.post('/api/chats/:id/suggest', async (req) => {
    const chat = getChat(ctx, owner(req), (req.params as any).id);
    const conn = connectionForRole(ctx, owner(req), 'utility');
    if (!conn) throw new HttpError(400, 'Add a connection first');
    const recent = listMessages(ctx, owner(req), chat.id)
      .filter((m) => !m.hidden)
      .slice(-6)
      .map((m) => `${m.name}: ${stripInlineTags(m.swipes[m.swipeId]?.text ?? '').slice(0, 1200)}`)
      .join('\n\n');
    const r = await completeChat(conn, {
      messages: [
        { role: 'system', content: 'You suggest what the player character could do next in a roleplay. Reply with JSON only: {"actions":["...","...","..."]}. Each action is one short first-person line (max 14 words), varied: one bold, one cautious, one social.' },
        { role: 'user', content: recent || 'The story is just starting.' },
      ],
      overrides: { temperature: 0.9, max_tokens: 200, reasoning: false, stop: [] },
      signal: AbortSignal.timeout(45_000),
    });
    const j = extractJson<{ actions?: string[] }>(r.text);
    const actions = j.ok && Array.isArray(j.value?.actions) ? j.value!.actions.filter((a) => typeof a === 'string').slice(0, 3) : r.text.split('\n').map((l) => l.replace(/^[-*\d.\s"]+|"$/g, '').trim()).filter(Boolean).slice(0, 3);
    return { actions };
  });

  /** Turn an NPC into a full character card and link them. */
  app.post('/api/campaigns/:id/npcs/:npcId/to-character', async (req) => {
    const { id, npcId } = req.params as { id: string; npcId: string };
    const b = parse(z.object({ chatId: z.string() }), req.body);
    const state = getState(ctx, owner(req), id);
    const npc = state.npcs[npcId];
    if (!npc) throw new HttpError(404, 'NPC not found');
    if (npc.characterId) return getCharacter(ctx, owner(req), npc.characterId);
    const card = emptyCardData(npc.name);
    card.description = [npc.title && `${npc.name} is ${npc.title}.`, npc.role && npc.role !== 'NPC' ? `Role: ${npc.role}.` : '', npc.age != null ? `Age: ${npc.age}.` : '', npc.appearance].filter(Boolean).join('\n');
    card.personality = npc.personality;
    card.creator_notes = npc.notes;
    card.tags = ['npc'];
    const ch = createCharacter(ctx, owner(req), card, { avatar: npc.portrait });
    appendOps(ctx, owner(req), id, { chatId: b.chatId, messageId: null, swipeId: null, source: 'user', ops: [{ type: 'npc.set', id: npc.id, patch: { characterId: ch.id } } as Op], origin: req.clientId });
    return ch;
  });

  /** Bring a character card into the campaign as an NPC. */
  app.post('/api/campaigns/:id/npcs/from-character', async (req) => {
    const { id } = req.params as { id: string };
    const b = parse(z.object({ chatId: z.string(), characterId: z.string() }), req.body);
    const ch = getCharacter(ctx, owner(req), b.characterId);
    const last = ctx.db.prepare('SELECT id FROM messages WHERE chat_id = ? ORDER BY seq DESC LIMIT 1').get(b.chatId) as { id: string } | undefined;
    const r = appendOps(ctx, owner(req), id, {
      chatId: b.chatId,
      messageId: last?.id ?? null,
      swipeId: null,
      source: 'user',
      ops: [{ type: 'npc.upsert', name: ch.name, personality: ch.card.personality.slice(0, 3000), appearance: ch.card.description.slice(0, 3000) } as Op],
      origin: req.clientId,
    });
    const npc = Object.values(r.state.npcs).find((n) => n.name === ch.name || n.characterId === ch.id);
    if (npc && !npc.characterId) appendOps(ctx, owner(req), id, { chatId: b.chatId, messageId: last?.id ?? null, swipeId: null, source: 'user', ops: [{ type: 'npc.set', id: npc.id, patch: { characterId: ch.id, portrait: null } } as Op] });
    return { ok: true };
  });

  registerGameExtras(app, ctx);
}
