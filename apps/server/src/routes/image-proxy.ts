/**
 * Pictures in creator notes and online previews are shown through the server: the page's security
 * policy only allows images from Everloom itself, the phone never contacts third-party hosts, and
 * the same private-address guard as every content-driven fetch applies. Signed-in users only.
 */
import { sniffImageType } from '@everloom/engine';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, owner, type AppContext } from '../context.js';
import { PROVIDERS, sourceImage } from '../services/sources.js';
import { fetchPublic } from '../util/public-fetch.js';
import { parse } from '../util/validate.js';

const buckets = new Map<string, { tokens: number; at: number }>();
function allow(key: string) {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: 40, at: now };
  b.tokens = Math.min(40, b.tokens + ((now - b.at) / 1000) * 10);
  b.at = now;
  buckets.set(key, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export function registerImageProxy(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/image-proxy', async (req, reply) => {
    const o = owner(req);
    const { url } = parse(z.object({ url: z.string().min(8).max(2000) }), req.query);
    if (!/^https?:\/\//i.test(url)) throw new HttpError(400, 'Only http(s) images');
    if (!allow(o)) throw new HttpError(429, 'Too many images at once');
    // Pictures hosted by an online source go through that source (its pacing and cache).
    const host = new URL(url).hostname;
    const source = Object.values(PROVIDERS).find((p) => p.spec.imageHosts.includes(host));
    let body: Buffer;
    if (source && url.startsWith('https://')) body = await sourceImage(ctx, o, source.id, url).catch(() => Buffer.alloc(0));
    else {
      const r = await fetchPublic(url, { maxBytes: 8 * 1024 * 1024, timeoutMs: 15_000, allowPrivate: ctx.cfg.fetchPrivate, headers: { accept: 'image/*' } });
      body = r.status === 200 ? r.body : Buffer.alloc(0);
    }
    if (!body.length) return reply.code(404).header('cache-control', 'private, max-age=600').send({ error: 'Image not available' });
    const r = { body };
    const type = sniffImageType(new Uint8Array(r.body.subarray(0, 16)));
    if (!type) return reply.code(415).send({ error: 'Not an image' });
    return reply.header('content-type', `image/${type}`).header('cache-control', 'private, max-age=86400').header('x-content-type-options', 'nosniff').header('content-security-policy', "default-src 'none'").send(r.body);
  });
}
