/** Scenarios: list, keep, share, and start a story from one (docs/ux/hakawati.md). */
import { buildNewGameState, defaultNewGame, expandMacros, fillQuestions, newEntry, normalizeScenario, type ScenarioDTO, type WIEntry } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { newId } from '../security/crypto.js';
import { setBaseState } from '../services/campaigns.js';
import { getCharacter } from '../services/characters.js';
import { createChat, getChat, insertMessage, updateChat } from '../services/chats.js';
import { createLorebook } from '../services/lorebooks.js';
import { defaultPersona, getPersona } from '../services/personas.js';
import { parse } from '../util/validate.js';

type Row = { id: string; data: string; created_at: number; updated_at: number };
const dto = (r: Row): ScenarioDTO => ({ ...normalizeScenario(JSON.parse(r.data)), id: r.id, createdAt: r.created_at, updatedAt: r.updated_at });

export function registerScenarios(app: FastifyInstance, ctx: AppContext) {
  const get = (o: string, id: string) => {
    const r = ctx.db.prepare('SELECT * FROM scenarios WHERE id = ? AND owner_id = ?').get(id, o) as Row | undefined;
    if (!r) throw new HttpError(404, 'Scenario not found');
    return dto(r);
  };
  const clean = (body: unknown) => {
    try {
      return normalizeScenario(body);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  };

  app.get('/api/scenarios', async (req) => (ctx.db.prepare('SELECT * FROM scenarios WHERE owner_id = ? ORDER BY updated_at DESC').all(owner(req)) as Row[]).map(dto));
  app.get('/api/scenarios/:id', async (req) => get(owner(req), (req.params as { id: string }).id));
  app.post('/api/scenarios', async (req) => {
    const data = clean(req.body);
    const id = newId('sc_');
    const now = Date.now();
    ctx.db.prepare('INSERT INTO scenarios (id, owner_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, owner(req), JSON.stringify(data), now, now);
    return get(owner(req), id);
  });
  app.put('/api/scenarios/:id', async (req) => {
    const { id } = req.params as { id: string };
    get(owner(req), id);
    ctx.db.prepare('UPDATE scenarios SET data = ?, updated_at = ? WHERE id = ? AND owner_id = ?').run(JSON.stringify(clean(req.body)), Date.now(), id, owner(req));
    return get(owner(req), id);
  });
  app.delete('/api/scenarios/:id', async (req) => {
    ctx.db.prepare('DELETE FROM scenarios WHERE id = ? AND owner_id = ?').run((req.params as { id: string }).id, owner(req));
    return { ok: true };
  });

  /** A new story from a scenario: everything it needs is copied into the chat. */
  app.post('/api/scenarios/:id/start', async (req) => {
    const o = owner(req);
    const s = get(o, (req.params as { id: string }).id);
    const b = parse(z.object({ characterId: z.string().nullable().optional(), personaId: z.string().nullable().optional(), mode: z.enum(['classic', 'story', 'full']).nullable().optional(), answers: z.record(z.string().max(300), z.string().max(2000)).optional() }), req.body ?? {});
    const characterId = s.characterId ?? b.characterId;
    if (!characterId) throw new HttpError(400, 'Pick a character for this scenario');
    const ch = getCharacter(ctx, o, characterId);
    const answers = b.answers ?? {};
    const fill = (t: string) => fillQuestions(t, answers);
    let chat = createChat(ctx, o, { characterId, personaId: b.personaId ?? null, features: b.mode ?? s.mode, greeting: !s.opening.trim(), answers, title: `${s.title} — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` });
    const persona = chat.personaId ? getPersona(ctx, o, chat.personaId) : defaultPersona(ctx, o);
    const userName = persona?.name ?? 'You';
    if (s.opening.trim()) insertMessage(ctx, o, chat.id, { role: 'assistant', name: ch.name, characterId: ch.id, swipes: [{ text: expandMacros(fill(s.opening), { char: ch.name, user: userName }), createdAt: Date.now() }] });
    chat = updateChat(ctx, o, chat.id, {
      metadata: {
        scenario: { id: s.id, title: s.title, instructions: fill(s.instructions), plot: fill(s.plot) },
        ...(s.note.trim() ? { authorsNote: { content: fill(s.note), depth: 4, role: 'system' } } : {}),
      },
    });
    if (s.cards.length) {
      const entries = Object.fromEntries(s.cards.map((c, i) => [String(i), newEntry(i, { comment: c.title, key: c.keys, content: fill(c.content), constant: !!c.pinned, cardType: c.type } as Partial<WIEntry>)]));
      createLorebook(ctx, o, { name: `${s.title} — story cards`, scope: 'chat', scopeId: chat.id, book: { entries } as never });
    }
    if (s.game && chat.campaignId) {
      const cfg = { ...defaultNewGame(Math.floor(Math.random() * 1e6)), title: s.title, ...s.game };
      setBaseState(ctx, o, chat.campaignId, buildNewGameState(cfg), req.clientId);
    }
    return getChat(ctx, o, chat.id);
  });
}
