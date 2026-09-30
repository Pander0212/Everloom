/** Save slots and diagnostics. */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { owner, type AppContext } from '../context.js';
import { debugBundle, diagnostics } from '../services/diagnostics.js';
import { deleteSlot, listSlots, loadSlot, renameSlot, saveSlot } from '../services/slots.js';
import { parse } from '../util/validate.js';

export function registerCustomize(app: FastifyInstance, ctx: AppContext, version: string) {
  app.get('/api/chats/:id/slots', async (req) => listSlots(ctx, owner(req), (req.params as { id: string }).id));
  app.post('/api/chats/:id/slots', async (req) => saveSlot(ctx, owner(req), (req.params as { id: string }).id, parse(z.object({ name: z.string().max(80).optional() }), req.body ?? {}).name));
  app.post('/api/slots/:id/load', async (req) => {
    const chat = loadSlot(ctx, owner(req), (req.params as { id: string }).id);
    ctx.bus.publish(owner(req), 'chat.created', { chat }, req.clientId);
    return chat;
  });
  app.patch('/api/slots/:id', async (req) => renameSlot(ctx, owner(req), (req.params as { id: string }).id, parse(z.object({ name: z.string().max(80) }), req.body).name));
  app.delete('/api/slots/:id', async (req) => {
    deleteSlot(ctx, owner(req), (req.params as { id: string }).id);
    return { ok: true };
  });

  app.get('/api/diagnostics', async (req) => diagnostics(ctx, owner(req), version));
  /** The browser adds what only it knows (screen, storage, service worker); the server scrubs it all. */
  app.post('/api/diagnostics/bundle', async (req, reply) => {
    const b = parse(z.object({ client: z.record(z.string(), z.unknown()).default({}) }), req.body ?? {});
    const name = `everloom-debug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    return reply.header('content-type', 'application/json; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`).send(JSON.stringify(debugBundle(ctx, owner(req), version, b.client), null, 2));
  });
}
