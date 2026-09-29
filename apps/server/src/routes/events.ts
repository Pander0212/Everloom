import type { FastifyInstance } from 'fastify';
import { owner, type AppContext } from '../context.js';

/** Server-sent events: live state for every open device. */
export function registerEvents(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/events', async (req, reply) => {
    const ownerId = owner(req);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write(`retry: 3000\n\n`);
    raw.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
    const unsubscribe = ctx.bus.subscribe(ownerId, (e) => {
      raw.write(`event: ${e.type}\ndata: ${JSON.stringify({ ...((e.data as object) ?? {}), origin: e.origin ?? null })}\n\n`);
    });
    const ping = setInterval(() => raw.write(': ping\n\n'), 20000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });
}
