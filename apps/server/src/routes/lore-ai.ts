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
import { parse } from '../util/validate.js';

export function registerLoreAi(app: FastifyInstance, ctx: AppContext) {
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
