/**
 * Quickstart: a whole new story from a short idea or a genre. The server writes the character
 * card here (not saved); the app then creates the character, the chat and, for a game, the world,
 * step by step, so the player sees progress and can cancel without losing what they typed.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { owner, type AppContext } from '../context.js';
import { utilityJson } from '../services/utility.js';
import { parse } from '../util/validate.js';

export interface QuickstartDraft {
  card: { name: string; description: string; personality: string; scenario: string; first_mes: string; tags: string[] };
  /** One paragraph about the world, for the game setup. */
  premise: string;
  style: 'fantasy' | 'modern' | 'scifi' | 'historical' | 'postapoc';
}

const STYLES = ['fantasy', 'modern', 'scifi', 'historical', 'postapoc'] as const;

export function registerQuickstart(app: FastifyInstance, ctx: AppContext) {
  app.post('/api/quickstart/draft', async (req) => {
    const b = parse(z.object({ idea: z.string().max(2000).default(''), genre: z.string().max(60).default(''), mode: z.enum(['classic', 'story', 'full']).default('story') }), req.body);
    const raw = await utilityJson<Partial<QuickstartDraft> & { card?: Partial<QuickstartDraft['card']> }>(
      ctx,
      owner(req),
      'You write the start of an interactive story for a roleplay app: one main character the player meets, the world around them, and an opening scene. Write in clear, vivid English. The player is "{{user}}"; never decide what {{user}} does or says. Reply with JSON only.',
      `Genre: ${b.genre || 'any that fits the idea'}.\nIdea: ${b.idea || 'surprise me'}.\n${b.mode === 'full' ? 'This will be a full RPG with a map, items and quests.\n' : ''}\nReturn JSON: {"card":{"name":"","description":"who they are, how they look and talk (120-200 words)","personality":"a few traits","scenario":"the situation the story starts in (1-3 sentences)","first_mes":"the opening scene, ending with something for {{user}} to answer (120-220 words)","tags":["genre","..."]},"premise":"the world in 2-4 sentences","style":"one of ${STYLES.join('|')}"}`,
      1800,
      'quickstart',
    );
    const c: Partial<QuickstartDraft['card']> = raw.card ?? {};
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const draft: QuickstartDraft = {
      card: {
        name: str(c.name, 80) || 'Stranger',
        description: str(c.description, 4000),
        personality: str(c.personality, 1000),
        scenario: str(c.scenario, 2000),
        first_mes: str(c.first_mes, 6000),
        tags: Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, 30)).slice(0, 6) : [],
      },
      premise: str(raw.premise, 2000),
      style: STYLES.includes(raw.style as never) ? (raw.style as QuickstartDraft['style']) : 'fantasy',
    };
    return draft;
  });
}
