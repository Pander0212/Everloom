/** The browser bridge: device tokens, the token-authenticated import, the bookmarklet hand-off and the userscript. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { WindowLimiter } from '../security/ratelimit.js';
import { bookmarklet, userscript } from '../services/bridge-script.js';
import { addDevice, bridgeImport, bridgePayload, completePairing, listDevices, ownerForToken, removeDevice, startPairing } from '../services/bridge.js';
import { parse } from '../util/validate.js';

/** Where this Everloom is reached, as the browser sees it (no client-supplied value, so a link can't point the script elsewhere). */
const originOf = (req: FastifyRequest) => `${req.protocol}://${String(req.headers.host ?? 'localhost')}`;

function cors(reply: FastifyReply) {
  // Only the import endpoint allows other origins, and it never uses cookies: the device token is the credential.
  reply.header('access-control-allow-origin', '*').header('access-control-allow-methods', 'POST, OPTIONS').header('access-control-allow-headers', 'authorization, content-type').header('access-control-max-age', '600');
}

export function registerBridge(app: FastifyInstance, ctx: AppContext) {
  const perToken = new WindowLimiter(30, 60_000);
  const bodyLimit = 30 * 1024 * 1024;

  app.get('/api/bridge/devices', async (req) => ({ devices: listDevices(ctx, owner(req)), bookmarklet: bookmarklet(originOf(req)), userscriptUrl: `${originOf(req)}/api/bridge/everloom-bridge.user.js` }));
  app.post('/api/bridge/devices', async (req) => addDevice(ctx, owner(req), parse(z.object({ label: z.string().trim().min(1).max(60) }), req.body).label));
  app.delete('/api/bridge/devices/:id', async (req) => {
    removeDevice(ctx, owner(req), (req.params as { id: string }).id);
    return { ok: true };
  });

  for (const path of ['/api/bridge/import', '/api/bridge/pair', '/api/bridge/ping'])
    app.options(path, async (_req, reply) => {
      cors(reply);
      return reply.code(204).send();
    });

  // Install-and-pair: the settings page asks for a code; the userscript link carries it.
  app.post('/api/bridge/pairing', async (req) => {
    const p = startPairing(ctx, owner(req), parse(z.object({ label: z.string().trim().min(1).max(60) }), req.body).label);
    return { ...p, userscriptUrl: `${originOf(req)}/api/bridge/everloom-bridge.user.js?pair=${encodeURIComponent(p.code)}` };
  });
  const perIp = new WindowLimiter(20, 60_000);
  app.post('/api/bridge/pair', async (req, reply) => {
    cors(reply);
    if (!perIp.take(req.ip)) throw new HttpError(429, 'Too many attempts; wait a minute');
    const r = completePairing(ctx, parse(z.object({ code: z.string().regex(/^evp_[A-Za-z0-9_-]{10,}$/) }), req.body).code);
    return { token: r.token, label: r.label };
  });
  app.post('/api/bridge/ping', async (req, reply) => {
    cors(reply);
    if (!ownerForToken(ctx, req.headers.authorization)) throw new HttpError(401, 'This device token is not known to Everloom.', 'auth_required');
    return { ok: true, name: 'Everloom' };
  });
  app.post('/api/bridge/import', { bodyLimit }, async (req, reply) => {
    cors(reply);
    const who = ownerForToken(ctx, req.headers.authorization);
    if (!who) throw new HttpError(401, 'This device is not allowed. Pair it in Settings › Character sources › Browser bridge.', 'auth_required');
    if (!perToken.take(String(req.headers.authorization))) throw new HttpError(429, 'Too many cards at once; wait a minute');
    const c = await bridgeImport(ctx, who, parse(bridgePayload, req.body));
    ctx.bus.publish(who, 'characters.changed', {});
    return { id: c.id, name: c.name };
  });

  // The bookmarklet hands the card to Everloom's receive page, which posts it with the signed-in session.
  app.post('/api/bridge/receive', { bodyLimit }, async (req) => {
    const c = await bridgeImport(ctx, owner(req), parse(bridgePayload, req.body));
    ctx.bus.publish(owner(req), 'characters.changed', {}, req.clientId);
    return { id: c.id, name: c.name };
  });

  // Public on purpose: the script holds no secret (each device pastes its own token on first use).
  // With ?pair=, the script carries a one-time pairing code (which is useless once used or after ten minutes).
  app.get('/api/bridge/everloom-bridge.user.js', async (req, reply) => {
    const pair = parse(z.object({ pair: z.string().regex(/^evp_[A-Za-z0-9_-]{10,}$/).optional() }), req.query).pair;
    return reply.header('content-type', 'text/javascript; charset=utf-8').header('cache-control', 'no-store').send(userscript(originOf(req), pair));
  });
}
