/** Optional AI help for game systems (utility model, always confirmed by the player before it changes anything). */
import { buildRecipePrompt, parseRecipeSuggestion } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { completeChat } from '../llm/providers.js';
import { logged, promptTokens } from '../services/calls.js';
import { getState } from '../services/campaigns.js';
import { connectionForRole } from '../services/connections.js';
import { parse } from '../util/validate.js';

export function registerGameAi(app: FastifyInstance, ctx: AppContext) {
  // A new recipe that fits the world. Returned for the player to review; only saved when they add it.
  app.post('/api/campaigns/:id/recipes/suggest', async (req) => {
    const o = owner(req);
    const b = parse(z.object({ discipline: z.enum(['cooking', 'alchemy', 'forge', 'enchantment', 'general']), idea: z.string().max(500).default('') }), req.body);
    const s = getState(ctx, o, (req.params as { id: string }).id);
    const conn = connectionForRole(ctx, o, 'utility');
    if (!conn) throw new HttpError(400, 'Add a connection first');
    const messages = buildRecipePrompt(s, b.discipline, b.idea);
    const r = await logged(ctx, o, conn, { purpose: 'recipe idea', role: 'utility' }, promptTokens(messages), () =>
      completeChat(conn, { messages, overrides: { temperature: 0.8, max_tokens: 600, reasoning: false, stop: [] }, signal: AbortSignal.timeout(90_000) }),
    );
    try {
      return { recipe: parseRecipeSuggestion(r.text, b.discipline) };
    } catch (e) {
      throw new HttpError(502, (e as Error).message);
    }
  });
}
