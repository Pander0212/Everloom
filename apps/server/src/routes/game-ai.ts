/** Optional AI help for game systems (utility model, always confirmed by the player before it changes anything). */
import { buildRecipePrompt, OpSchemas, parseRecipeSuggestion } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { completeChat } from '../llm/providers.js';
import { logged, promptTokens } from '../services/calls.js';
import { getState } from '../services/campaigns.js';
import { utilityJson } from '../services/utility.js';
import { chatForCampaign, recentStory } from './social.js';
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

  // A cutscene drafted from the story so far. Returned for review; nothing is saved until the player adds it.
  app.post('/api/campaigns/:id/cutscenes/generate', async (req) => {
    const o = owner(req);
    const campaignId = (req.params as { id: string }).id;
    const b = parse(z.object({ chatId: z.string(), idea: z.string().max(500).default('') }), req.body);
    chatForCampaign(ctx, o, campaignId, b.chatId);
    const s = getState(ctx, o, campaignId);
    const people = Object.values(s.npcs).filter((n) => n.status === 'alive').map((n) => n.name).slice(0, 12);
    const out = await utilityJson<{ name?: string; steps?: unknown[] }>(
      ctx,
      o,
      `You direct short cutscenes for a visual-novel style roleplay. Write 3–8 steps that stage a moment from the story: each step is one or two sentences of narration or a line of dialogue. Only use people from the list. Optional per step: "speaker" (a name from the list), "fx" (shake, flash, fade, blur, vignette, heartbeat, sparkle, rain, snow, glitch), "mood" (calm, tense, battle, romantic, sad, mysterious, joyful), "seconds" (2–8). Reply with JSON only: {"name":"short title","steps":[{"text":"…","speaker":"…","fx":"…","mood":"…","seconds":4}]}`,
      `Setting: ${s.meta.style}. People: ${people.join(', ') || 'none named yet'}.${b.idea ? `\nThe player wants: ${b.idea}` : ''}\n\nRecent story:\n${recentStory(ctx, b.chatId, 8, 5000)}`,
      1200,
      'cutscene draft',
    );
    const r = OpSchemas['cutscene.add'].safeParse({ type: 'cutscene.add', name: out.name || 'Cutscene', steps: out.steps, source: 'ai' });
    if (!r.success) throw new HttpError(502, 'The model did not return a usable cutscene. Try again.');
    return { cutscene: r.data };
  });
}
