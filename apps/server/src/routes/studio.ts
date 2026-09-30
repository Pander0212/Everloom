/** Character studio: AI-assisted card writing (brainstorm, write, refine, write a field, revise a passage). */
import { buildStudioMessages, parseStudioReply, STUDIO_FIELDS, STUDIO_PRESETS, type StudioRequest } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { completeChat } from '../llm/providers.js';
import { logged, promptTokens } from '../services/calls.js';
import { connectionForRole } from '../services/connections.js';
import { getSettings } from '../services/settings.js';
import { parse } from '../util/validate.js';

const field = z.enum(STUDIO_FIELDS.map((f) => f.key) as [string, ...string[]]);
const request = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('brainstorm'), brief: z.string().max(4000).default('') }),
  z.object({ mode: z.literal('create'), brief: z.string().trim().min(3).max(4000) }),
  z.object({ mode: z.literal('refine'), instruction: z.string().trim().min(3).max(2000) }),
  z.object({ mode: z.literal('field'), field, instruction: z.string().max(2000).optional() }),
  z.object({ mode: z.literal('revise'), field, selection: z.string().trim().min(1).max(8000), instruction: z.string().trim().min(2).max(2000) }),
]);
const body = z.object({
  request,
  draft: z.record(z.string(), z.unknown()).default({}),
  preset: z.string().max(60).optional(),
  /** A one-off system prompt, used instead of the preset. */
  system: z.string().max(8000).optional(),
  connectionId: z.string().max(60).nullable().optional(),
});

const MAX_TOKENS: Record<StudioRequest['mode'], number> = { brainstorm: 900, create: 3000, refine: 2500, field: 1500, revise: 800 };

export function registerStudio(app: FastifyInstance, ctx: AppContext) {
  app.post('/api/studio/run', async (req) => {
    const o = owner(req);
    const b = parse(body, req.body);
    const settings = getSettings(ctx, o);
    const conn = connectionForRole(ctx, o, 'main', b.connectionId ?? settings.studio.connection);
    if (!conn) throw new HttpError(400, 'Add a connection first');
    const presetId = b.preset ?? settings.studio.preset;
    const system = b.system?.trim() || [...settings.studio.presets, ...STUDIO_PRESETS].find((p) => p.id === presetId)?.system || STUDIO_PRESETS[0]!.system;
    const r = b.request as StudioRequest;
    const messages = buildStudioMessages(r, b.draft as any, system);
    const res = await logged(ctx, o, conn, { purpose: `character studio (${r.mode})`, role: 'main' }, promptTokens(messages), () =>
      completeChat(conn, { messages, overrides: { temperature: r.mode === 'brainstorm' ? 1 : 0.8, max_tokens: MAX_TOKENS[r.mode], reasoning: false, stop: [] }, signal: AbortSignal.timeout(180_000) }),
    );
    try {
      return parseStudioReply(r, res.text);
    } catch (e) {
      throw new HttpError(502, (e as Error).message);
    }
  });
}
