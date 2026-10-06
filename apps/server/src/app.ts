import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Bus } from './bus.js';
import type { Config } from './config.js';
import { HttpError, type AppContext } from './context.js';
import { reconcileLegacyCampaigns } from './services/campaigns.js';
import { openDb, type DB } from './db/index.js';
import { lockedDb, openSystemDb, Vault } from './vault/vault.js';
import { registerAuth } from './routes/auth.js';
import { runWithShield } from './privacy/shield.js';
import { installShield } from './services/shield.js';
import { registerPrivacy } from './routes/privacy.js';
import { registerVault } from './routes/vault.js';
import { FRAME_CSP, registerScripts } from './routes/scripts.js';
import { registerExtensions } from './routes/extensions.js';
import { registerDesktop } from './routes/desktop.js';
import { loadAllExtensions, stopAllDevWatches } from './services/extensions.js';
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
import { registerCustomize } from './routes/customize.js';
import { registerLive2d } from './routes/live2d.js';
import { registerAssetRoutes } from './routes/assets.js';
import { logSafeError, recordError, setContentFreeLogs } from './services/diagnostics.js';
import { backfillMeta } from './services/characters.js';
import { registerInspector } from './routes/inspector.js';
import { registerMemory } from './routes/memory.js';
import { registerLibrary } from './routes/library.js';
import { registerSystem } from './routes/system.js';
import { decryptWithPassword, encryptWithPassword, isPasswordEncrypted } from './vault/crypto.js';

export const VERSION = '0.1.0';

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
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
  // With the vault on, the content database stays closed (locked) until the passphrase is given;
  // accounts and sessions live in the small plain system store.
  const vault = new Vault(cfg);
  const db = vault.enabled ? lockedDb() : (opts.db ?? openDb(cfg.dbPath));
  const sys = vault.enabled ? openSystemDb(vault.systemPath) : db;
  const ctx: AppContext = { cfg, db, sys, bus: new Bus(), vault };
  setContentFreeLogs(() => ctx.vault.enabled);
  if (!vault.enabled) {
    // Library columns for characters made before they existed (fast; only rows still missing them).
    backfillMeta(ctx);
    // Campaigns saved by an older release keep the results they recorded (see the function).
    reconcileLegacyCampaigns(ctx);
  }
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
    // The script sandbox document is the one page that may be framed (by Everloom itself), under its own policy.
    const frame = reply.getHeader('x-everloom-frame') === '1';
    reply.header('x-frame-options', frame ? 'SAMEORIGIN' : 'DENY');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('permissions-policy', frame ? 'camera=(), geolocation=(), microphone=(), payment=(), usb=()' : 'camera=(), geolocation=(), microphone=(self)');
    reply.header('content-security-policy', frame ? FRAME_CSP : CSP);
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    return payload;
  });

  // Password-protected exports: a download asked for with x-export-password comes back sealed
  // (scrypt + AES-256-GCM) and named .evlt; an upload of such a file is opened with x-import-password.
  app.addHook('onSend', async (req, reply, payload) => {
    const pw = req.headers['x-export-password'];
    const cd = String(reply.getHeader('content-disposition') ?? '');
    if (typeof pw !== 'string' || !pw || !cd.startsWith('attachment') || reply.statusCode >= 300) return payload;
    let buf: Buffer;
    if (Buffer.isBuffer(payload)) buf = payload;
    else if (typeof payload === 'string') buf = Buffer.from(payload);
    else if (payload && typeof (payload as any)[Symbol.asyncIterator] === 'function') {
      const parts: Buffer[] = [];
      for await (const c of payload as AsyncIterable<Buffer | string>) parts.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      buf = Buffer.concat(parts);
    } else return payload;
    const sealed = await encryptWithPassword(pw, buf);
    reply.header('content-disposition', cd.replace(/filename="([^"]+)"/, (_m, n: string) => `filename="${n}.evlt"`));
    reply.header('content-type', 'application/octet-stream');
    reply.removeHeader('content-length');
    return sealed;
  });
  app.addHook('preValidation', async (req) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || !isPasswordEncrypted(body)) return;
    const pw = req.headers['x-import-password'];
    if (typeof pw !== 'string' || !pw) throw new HttpError(400, 'This file is protected with a password', 'password_required');
    const plain = await decryptWithPassword(pw, body);
    if (!plain) throw new HttpError(400, 'That password does not open this file', 'wrong_password');
    req.body = plain;
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.message, code: err.code });
    }
    if (err.validation) return reply.code(400).send({ error: err.message, code: 'validation' });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message, code: err.code });
    req.log.error(logSafeError(err));
    recordError(req.method, req.url, err);
    return reply.code(500).send({ error: 'Something went wrong on the server', code: 'internal' });
  });

  app.get('/api/health', async () => {
    db.prepare('SELECT 1').get();
    return { ok: true, version: VERSION, build: process.env.EVERLOOM_COMMIT || null };
  });

  registerAuth(app, ctx);
  // Name shield: each request runs with its owner (and chat, when the address names one), so every
  // outgoing model, voice or image request it causes is shielded with the right terms.
  installShield(ctx);
  app.addHook('preHandler', (req, _reply, done) => {
    const m = /^\/api\/chats\/([^/?]+)/.exec(req.url);
    runWithShield({ owner: req.user?.id ?? null, chatId: m && m[1] !== 'import' ? m[1] : null, allowOnce: req.headers['x-shield-allow-once'] === '1' }, done);
  });
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
  registerCustomize(app, ctx, VERSION);
  registerLive2d(app, ctx);
  registerAssetRoutes(app, ctx);
  registerSystem(app, ctx);
  registerPrivacy(app, ctx);
  registerVault(app, ctx);
  registerScripts(app, ctx);
  registerExtensions(app, ctx);
  registerDesktop(app, ctx);
  // Custom game ops from installed extensions (needs the content database: after unlocking when the vault is on).
  if (!ctx.vault.locked) loadAllExtensions(ctx);
  app.addHook('onClose', async () => stopAllDevWatches());

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
