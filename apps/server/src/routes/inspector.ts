/** World inspector: health check with fixes, unresolved names, and the transaction log with revert. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { owner, type AppContext } from '../context.js';
import { opLogFor, undoEntry } from '../services/campaigns.js';
import { getChat } from '../services/chats.js';
import { checkHealth, dismissUnresolved, fixIssue, resolveUnresolved } from '../services/health.js';
import { parse } from '../util/validate.js';
import { appendOps } from '../services/campaigns.js';
import { proposeWorld } from '../services/worldimport.js';
import { validateOps } from '@everloom/engine';
import { HttpError } from '../context.js';

function campaignOf(ctx: AppContext, o: string, chatId: string) {
  const chat = getChat(ctx, o, chatId);
  if (!chat.campaignId) throw new HttpError(400, 'This chat has no game world');
  return { chat, campaignId: chat.campaignId };
}

export function registerInspector(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/chats/:id/health', async (req) => {
    const o = owner(req);
    const { campaignId } = campaignOf(ctx, o, (req.params as { id: string }).id);
    return checkHealth(ctx, o, campaignId);
  });

  app.post('/api/chats/:id/health/fix', async (req) => {
    const o = owner(req);
    const { chat, campaignId } = campaignOf(ctx, o, (req.params as { id: string }).id);
    const b = parse(z.object({ id: z.string().max(200) }), req.body);
    const r = fixIssue(ctx, o, campaignId, chat.id, b.id);
    return { summary: r.summary, errors: r.errors.map((e) => e.error), ...checkHealth(ctx, o, campaignId) };
  });

  app.post('/api/chats/:id/unresolved', async (req) => {
    const o = owner(req);
    const { chat, campaignId } = campaignOf(ctx, o, (req.params as { id: string }).id);
    const b = parse(z.object({ name: z.string().max(120), action: z.enum(['create', 'alias', 'dismiss']), kind: z.enum(['person', 'place', 'organization']).default('person'), targetId: z.string().max(80).optional() }), req.body);
    if (b.action === 'dismiss') dismissUnresolved(ctx, o, campaignId, b.name);
    else resolveUnresolved(ctx, o, campaignId, chat.id, { name: b.name, action: b.action, kind: b.kind, targetId: b.targetId });
    return checkHealth(ctx, o, campaignId);
  });

  /** Read a lorebook (and the card) into proposed places, people, groups and facts. */
  app.post('/api/chats/:id/world-import', async (req) => {
    const b = parse(z.object({ lorebookId: z.string().max(80).nullable().optional(), includeCard: z.boolean().default(false) }), req.body);
    return { proposals: await proposeWorld(ctx, owner(req), (req.params as { id: string }).id, b) };
  });

  /** Apply the proposals the owner kept, as their own (undoable) change. */
  app.post('/api/chats/:id/world-import/apply', async (req) => {
    const o = owner(req);
    const { chat, campaignId } = campaignOf(ctx, o, (req.params as { id: string }).id);
    const b = parse(z.object({ ops: z.array(z.unknown()).max(80) }), req.body);
    const v = validateOps(b.ops);
    const r = appendOps(ctx, o, campaignId, { chatId: chat.id, messageId: null, swipeId: null, source: 'user', ops: v.ok, origin: req.clientId });
    return { applied: r.applied.length, summary: r.summary, errors: [...v.rejected.map((x) => x.error), ...r.errors.map((e) => e.error)] };
  });

  /** Every change to the world, newest first, with where it came from. */
  app.get('/api/chats/:id/transactions', async (req) => {
    const o = owner(req);
    const { campaignId } = campaignOf(ctx, o, (req.params as { id: string }).id);
    const q = req.query as { limit?: string };
    const live = ctx.db.prepare('SELECT 1 FROM messages WHERE id = ? AND swipe_id = ?');
    return opLogFor(ctx, o, campaignId, Math.min(500, Number(q.limit ?? 150))).map((e) => ({
      ...e,
      // Entries anchored to a swipe that isn't showing don't count right now.
      active: !e.messageId || e.swipeId === null || !!live.get(e.messageId, e.swipeId),
    }));
  });

  app.post('/api/chats/:id/transactions/:entryId/revert', async (req) => {
    const o = owner(req);
    const { id, entryId } = req.params as { id: string; entryId: string };
    const { campaignId } = campaignOf(ctx, o, id);
    undoEntry(ctx, o, campaignId, entryId, req.clientId);
    return { ok: true };
  });
}
