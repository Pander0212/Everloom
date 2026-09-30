import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Bus } from './bus.js';
import type { Config } from './config.js';
import { HttpError, type AppContext } from './context.js';
import { openDb, type DB } from './db/index.js';
import { registerAuth } from './routes/auth.js';
import { registerChats } from './routes/chats.js';
import { registerEvents } from './routes/events.js';
import { registerGame } from './routes/game.js';
import { registerCharLib } from './routes/charlib.js';
import { registerCss } from './routes/css.js';
import { registerStudio } from './routes/studio.js';
import { registerLoreAi } from './routes/lore-ai.js';
import { registerSources } from './routes/sources.js';
import { registerImageProxy } from './routes/image-proxy.js';
import { registerGameAi } from './routes/game-ai.js';
import { registerComms } from './routes/comms.js';
import { registerBridge } from './routes/bridge.js';
import { backfillMeta } from './services/characters.js';
import { registerInspector } from './routes/inspector.js';
import { registerMemory } from './routes/memory.js';
import { registerLibrary } from './routes/library.js';
import { registerSystem } from './routes/system.js';

export const VERSION = '0.1.0';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
}

export async function buildApp(cfg: Config, opts: { db?: DB; logger?: boolean } = {}): Promise<BuiltApp> {
  const db = opts.db ?? openDb(cfg.dbPath);
  const ctx: AppContext = { cfg, db, bus: new Bus() };
  // Library columns for characters made before they existed (fast; only rows still missing them).
  backfillMeta(ctx);
  const app = Fastify({
    logger: opts.logger === false ? false : { level: cfg.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]'] },
    trustProxy: cfg.trustProxy,
    bodyLimit: 4 * 1024 * 1024,
  });

  await app.register(cookie);

  // Raw bodies for uploads (validated by magic bytes in the handlers).
  const raw = { parseAs: 'buffer' as const, bodyLimit: 64 * 1024 * 1024 };
  app.addContentTypeParser(['application/octet-stream', 'application/zip', 'application/x-zip-compressed', 'text/plain', 'application/jsonl', 'application/x-ndjson'], raw, (_req, body, done) => done(null, body));
  app.addContentTypeParser(/^(image|video|audio)\//, raw, (_req, body, done) => done(null, body));

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('permissions-policy', 'camera=(), geolocation=(), microphone=(self)');
    reply.header('content-security-policy', CSP);
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    return payload;
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.message, code: err.code });
    }
    if (err.validation) return reply.code(400).send({ error: err.message, code: 'validation' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message, code: err.code });
    req.log.error(err);
    return reply.code(500).send({ error: 'Something went wrong on the server', code: 'internal' });
  });

  app.get('/api/health', async () => {
    db.prepare('SELECT 1').get();
    return { ok: true, version: VERSION, build: process.env.EVERLOOM_COMMIT || null };
  });

  registerAuth(app, ctx);
  registerEvents(app, ctx);
  registerLibrary(app, ctx);
  registerChats(app, ctx);
  registerGame(app, ctx);
  registerMemory(app, ctx);
  registerInspector(app, ctx);
  registerCharLib(app, ctx);
  registerCss(app, ctx);
  registerStudio(app, ctx);
  registerLoreAi(app, ctx);
  registerSources(app, ctx);
  registerImageProxy(app, ctx);
  registerGameAi(app, ctx);
  registerComms(app, ctx);
  registerBridge(app, ctx);
  registerSystem(app, ctx);

  const indexFile = path.join(cfg.webDir, 'index.html');
  if (existsSync(indexFile)) {
    await app.register(fastifyStatic, {
      root: cfg.webDir,
      wildcard: false,
      index: false,
      // Serves the .br/.gz files written at build time when the browser accepts them.
      preCompressed: true,
      setHeaders(res, file) {
        const name = path.basename(file);
        if (name === 'index.html' || name === 'sw.js' || name === 'manifest.webmanifest' || name.startsWith('workbox-')) res.header('cache-control', 'no-cache');
        else if (file.includes(`${path.sep}assets${path.sep}`)) res.header('cache-control', 'public, max-age=31536000, immutable');
      },
    });
    app.get('/*', async (req, reply) => {
      const url = req.url.split('?')[0];
      if (url.startsWith('/api/') || url.startsWith('/media/')) return reply.code(404).send({ error: 'Not found' });
      const rel = decodeURIComponent(url).replace(/^\/+/, '');
      const candidate = path.resolve(cfg.webDir, rel);
      if (rel && candidate.startsWith(cfg.webDir + path.sep) && existsSync(candidate) && !rel.endsWith('/')) return reply.sendFile(rel);
      // A missing file (an old build's script after an update) must fail loudly, not come back as the app's HTML,
      // or the browser waits forever on a script that never runs.
      if (/^assets\//.test(rel) || /\.(?:m?js|css|map|woff2?|png|jpe?g|svg|webp|ico|json|webmanifest)$/i.test(rel)) return reply.code(404).header('cache-control', 'no-store').send({ error: 'Not found' });
      reply.header('cache-control', 'no-cache');
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found' }));
  }

  return { app, ctx };
}
