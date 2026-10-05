/** Settings › Privacy: stand-in suggestions and a try-it preview for the name shield. */
import { buildShield, makeStandin, termsInScope, type ShieldKind } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { owner, type AppContext } from '../context.js';
import { getSettings } from '../services/settings.js';
import { parse } from '../util/validate.js';

export function registerPrivacy(app: FastifyInstance, ctx: AppContext) {
  // A plausible stand-in of the same kind that isn't a real term or another stand-in already.
  app.post('/api/privacy/standin', async (req) => {
    const b = parse(z.object({ kind: z.enum(['first', 'last', 'full', 'place', 'other']), seed: z.string().max(200).default(''), avoid: z.array(z.string().max(120)).max(400).default([]) }), req.body);
    const s = getSettings(ctx, owner(req)).privacy.shield;
    const avoid = [...b.avoid, ...s.terms.flatMap((t) => [t.real, t.standin, ...t.forms])];
    return { standin: makeStandin(b.kind as ShieldKind, `${b.seed}:${Math.random()}`, avoid) };
  });
  // What a piece of text looks like to the provider, and back.
  app.post('/api/privacy/preview', async (req) => {
    const { text } = parse(z.object({ text: z.string().max(20_000) }), req.body);
    const s = getSettings(ctx, owner(req)).privacy.shield;
    const shield = buildShield(termsInScope(s.terms, {}));
    const sent = shield.outbound(text);
    return { sent, restored: shield.inbound(sent), leaks: shield.leaks(sent) };
  });
}
