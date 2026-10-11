/** AI help in the lorebook editor: propose entries on a topic, or write/improve one entry. */
import { buildLoreEntryPrompt, buildLoreGenPrompt, parseLoreEntry, parseLoreProposals } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { completeChat } from '../llm/providers.js';
import { logged, promptTokens } from '../services/calls.js';
import { getCharacter } from '../services/characters.js';
import { connectionForRole } from '../services/connections.js';
import { getLorebook } from '../services/lorebooks.js';
import { getChat, listMessages } from '../services/chats.js';
import { utilityJson } from '../services/utility.js';
import { parse } from '../util/validate.js';

export interface CardProposal {
  type: 'character' | 'place' | 'thing' | 'concept';
  title: string;
  keys: string[];
  content: string;
}

export function registerLoreAi(app: FastifyInstance, ctx: AppContext) {
  /**
   * Story cards from the story so far: people, places, things and ideas worth remembering, as
   * proposals (not saved) for the chat's own lorebook. docs/ux/hakawati.md › Story cards.
   */
  app.post('/api/chats/:id/cards/generate', async (req) => {
    const o = owner(req);
    const chatId = (req.params as { id: string }).id;
    const b = parse(z.object({ count: z.number().int().min(1).max(10).default(5), known: z.array(z.string().max(120)).max(200).default([]) }), req.body ?? {});
    const chat = getChat(ctx, o, chatId);
    const recent = listMessages(ctx, o, chatId)
      .filter((m) => !m.hidden)
      .slice(-30)
      .map((m) => `${m.name}: ${(m.swipes[m.swipeId]?.text ?? '').slice(0, 1200)}`)
      .join('\n\n');
    if (!recent.trim()) throw new HttpError(400, 'Nothing has happened in this story yet');
    const raw = await utilityJson<{ cards?: Array<Partial<CardProposal>> }>(
      ctx,
      o,
      'You write story cards for a roleplay story: short reference notes the narrator reads when a keyword comes up. Only use what the story has established. Reply with JSON only.',
      `Story "${chat.title}", most recent part:\n${recent.slice(-14000)}\n\nAlready have cards for: ${b.known.join(', ') || 'nothing yet'}.\nWrite up to ${b.count} new cards for the people, places, things and ideas that matter most. JSON: {"cards":[{"type":"character|place|thing|concept","title":"","keys":["words that bring it up"],"content":"2-4 sentences in present tense"}]}`,
      1600,
      'story cards',
    );
    const types = ['character', 'place', 'thing', 'concept'] as const;
    const known = new Set(b.known.map((k) => k.toLowerCase()));
    const cards: CardProposal[] = (raw.cards ?? [])
      .map((c) => ({
        type: types.includes(c.type as never) ? (c.type as CardProposal['type']) : 'concept',
        title: String(c.title ?? '').trim().slice(0, 120),
        keys: (Array.isArray(c.keys) ? c.keys : []).map((k) => String(k).trim().slice(0, 60)).filter(Boolean).slice(0, 8),
        content: String(c.content ?? '').trim().slice(0, 2000),
      }))
      .filter((c) => c.title && c.content && !known.has(c.title.toLowerCase()))
      .slice(0, b.count);
    return { cards };
  });

  const setup = (req: any) => {
    const o = owner(req);
    const book = getLorebook(ctx, o, req.params.id);
    const conn = connectionForRole(ctx, o, 'main');
    if (!conn) throw new HttpError(400, 'Add a connection first');
    let about = '';
    if (book.scope === 'character' && book.scopeId) {
      try {
        const c = getCharacter(ctx, o, book.scopeId);
        about = `${c.name}: ${c.card.description}\n${c.card.scenario}`;
      } catch {
        /* character gone */
      }
    }
    const existing = Object.values(book.book.entries).map((e) => ({ comment: e.comment, key: e.key }));
    return { o, book, conn, about, existing };
  };

  app.post('/api/lorebooks/:id/generate', async (req) => {
    const b = parse(z.object({ topic: z.string().trim().min(3).max(2000), count: z.number().int().min(1).max(12).default(5) }), req.body);
    const { o, book, conn, about, existing } = setup(req);
    const messages = buildLoreGenPrompt({ topic: b.topic, count: b.count, bookName: book.name, existing, about });
    const r = await logged(ctx, o, conn, { purpose: 'lorebook entries', role: 'main' }, promptTokens(messages), () =>
      completeChat(conn, { messages, overrides: { temperature: 0.8, max_tokens: Math.min(4000, 350 * b.count + 200), reasoning: false, stop: [] }, signal: AbortSignal.timeout(180_000) }),
    );
    try {
      return { entries: parseLoreProposals(r.text, existing).slice(0, b.count) };
    } catch (e) {
      throw new HttpError(502, (e as Error).message);
    }
  });

  app.post('/api/lorebooks/:id/write-entry', async (req) => {
    const b = parse(
      z.object({ entry: z.object({ comment: z.string().max(200).default(''), key: z.array(z.string().max(100)).max(50).default([]), content: z.string().max(20000).default('') }), instruction: z.string().max(1000).optional() }),
      req.body,
    );
    if (!b.entry.comment.trim() && !b.entry.key.length && !b.entry.content.trim()) throw new HttpError(400, 'Give the entry a title or a key first');
    const { o, book, conn, about, existing } = setup(req);
    const messages = buildLoreEntryPrompt({ entry: b.entry, instruction: b.instruction, bookName: book.name, existing, about });
    const r = await logged(ctx, o, conn, { purpose: 'lorebook entry', role: 'main' }, promptTokens(messages), () =>
      completeChat(conn, { messages, overrides: { temperature: 0.7, max_tokens: 700, reasoning: false, stop: [] }, signal: AbortSignal.timeout(120_000) }),
    );
    try {
      return parseLoreEntry(r.text);
    } catch (e) {
      throw new HttpError(502, (e as Error).message);
    }
  });
}
