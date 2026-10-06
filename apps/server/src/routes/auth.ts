import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { clearOnceGrants } from '../services/scripts.js';
import { desktopMode, desktopSettings, noPasswordApplies, ownerId, setupNoPassword } from './desktop.js';
import { lockVault, onPasswordChanged, unlockVault } from '../services/vault.js';
import QRCode from 'qrcode';
import { z } from 'zod';
import { HttpError, type AppContext } from '../context.js';
import { decrypt, encrypt, hashPassword, newId, newTotpSecret, randomToken, sha256, verifyPassword, verifyTotp } from '../security/crypto.js';
import { WindowLimiter, clearFailures, isLocked, recordFailure } from '../security/ratelimit.js';
import { parse } from '../util/validate.js';

export const SESSION_COOKIE = 'everloom_session';
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const PUBLIC = new Set(['/api/health', '/api/auth/status', '/api/auth/setup', '/api/auth/login', '/api/bridge/import', '/api/bridge/pair', '/api/bridge/ping', '/api/bridge/everloom-bridge.user.js', '/api/sandbox/frame', '/api/addon/ping', '/api/addon/avatars', '/api/addon/upload']);

const credentials = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(512),
  code: z.string().max(12).optional(),
});

function isSecure(ctx: AppContext, req: FastifyRequest) {
  return ctx.cfg.forceSecureCookies || req.protocol === 'https';
}

function setSessionCookie(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecure(ctx, req),
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL / 1000,
  });
}

function createSession(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = randomToken();
  const csrf = randomToken(24);
  const now = Date.now();
  ctx.sys
    .prepare('INSERT INTO sessions (id, user_id, csrf, created_at, last_seen, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sha256(token), userId, csrf, now, now, now + SESSION_TTL, String(req.headers['user-agent'] ?? '').slice(0, 200), req.ip);
  setSessionCookie(ctx, req, reply, token);
  return csrf;
}

/** What still answers while the vault is locked. */
const VAULT_OPEN = ['/api/health', '/api/auth', '/api/vault', '/api/events', '/api/sandbox/frame'];

export function registerAuth(app: FastifyInstance, ctx: AppContext) {
  const burst = new WindowLimiter(30, 60_000);

  // Authentication gate for every /api route (and media) except the public ones.
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    const needsAuth = url.startsWith('/api/') || url.startsWith('/media/');
    if (!needsAuth) return;
    req.clientId = String(req.headers['x-client-id'] ?? '').slice(0, 64) || undefined;
    if (url.startsWith('/api/auth/') && req.method === 'POST' && !burst.take(req.ip)) {
      throw new HttpError(429, 'Too many requests, slow down');
    }
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) {
      const row = ctx.sys
        .prepare('SELECT s.id, s.user_id, s.csrf, s.expires_at, s.last_seen, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?')
        .get(sha256(token)) as { id: string; user_id: string; csrf: string; expires_at: number; last_seen: number; username: string } | undefined;
      if (row && row.expires_at > Date.now()) {
        req.user = { id: row.user_id, username: row.username, sessionId: row.id, csrf: row.csrf };
        if (Date.now() - row.last_seen > 5 * 60_000) {
          ctx.sys.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?').run(Date.now(), Date.now() + SESSION_TTL, row.id);
        }
      }
    }
    // Bridge and Blender add-on routes use device tokens, and still wait for a locked vault.
    if (PUBLIC.has(url) && !url.startsWith('/api/bridge/') && !url.startsWith('/api/addon/')) return;
    // The Windows app's control routes check their own token (see routes/desktop.ts).
    if (url.startsWith('/api/desktop/')) return;
    // Vault locked: nothing with content answers until it is unlocked (accounts and the vault itself do).
    if (ctx.vault.locked && !VAULT_OPEN.some((p) => url === p || url.startsWith(p + '/'))) throw new HttpError(423, 'The vault is locked. Unlock it to continue.', 'locked');
    if (PUBLIC.has(url)) return;
    if (!req.user) throw new HttpError(401, 'Not signed in', 'auth_required');
    if (!url.startsWith('/api/events')) ctx.vault.lastActivity = Date.now();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const header = String(req.headers['x-csrf-token'] ?? '');
      if (!header || header !== req.user.csrf) throw new HttpError(403, 'Invalid CSRF token', 'csrf');
    }
  });

  app.get('/api/auth/status', async (req, reply) => {
    const users = (ctx.sys.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    // The Windows app with "No password on this PC": this computer is signed in as the owner.
    if (!req.user && users > 0 && noPasswordApplies(ctx, req)) {
      const id = ownerId(ctx)!;
      const u = ctx.sys.prepare('SELECT username FROM users WHERE id = ?').get(id) as { username: string };
      const csrf = createSession(ctx, req, reply, id);
      req.user = { id, username: u.username, sessionId: '', csrf };
    }
    const desktop = desktopMode() ? { noPassword: !!desktopSettings(ctx).noPassword, local: ['127.0.0.1', '::1', 'localhost'].includes(ctx.cfg.host) } : null;
    return { setupRequired: users === 0, authenticated: !!req.user, username: req.user?.username ?? null, csrf: req.user?.csrf ?? null, desktop, vault: { enabled: ctx.vault.enabled, locked: ctx.vault.locked, loginIsPassphrase: !!ctx.vault.file?.loginIsPassphrase } };
  });

  app.post('/api/auth/setup', async (req, reply) => {
    const raw = (req.body ?? {}) as { noPassword?: boolean; password?: string };
    // The Windows app may set up without a password (this PC only; a random one is stored).
    const noPassword = raw.noPassword === true && desktopMode();
    const body = parse(noPassword ? credentials.extend({ password: z.string().max(512).optional().default('') }) : credentials, req.body);
    if (!noPassword && body.password.length < 10) throw new HttpError(400, 'Use at least 10 characters for the password');
    const id = newId('u_');
    const hash = noPassword ? await setupNoPassword(ctx) : await hashPassword(body.password);
    // Atomic: only the very first account can be created through setup.
    const created = ctx.sys.transaction(() => {
      const n = (ctx.sys.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
      if (n > 0) return false;
      ctx.sys.prepare('INSERT INTO users (id, username, pass_hash, created_at) VALUES (?, ?, ?, ?)').run(id, body.username, hash, Date.now());
      return true;
    })();
    if (!created) throw new HttpError(409, 'Setup is already complete');
    const csrf = createSession(ctx, req, reply, id);
    return { ok: true, username: body.username, csrf };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = parse(credentials, req.body);
    const ipKey = `ip:${req.ip}`;
    const userKey = `user:${body.username.toLowerCase()}`;
    const locked = Math.max(isLocked(ctx.sys, ipKey), isLocked(ctx.sys, userKey));
    if (locked) {
      reply.header('retry-after', Math.ceil((locked - Date.now()) / 1000));
      throw new HttpError(429, 'Too many failed attempts. Try again later.', 'locked');
    }
    const user = ctx.sys.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(body.username) as any;
    const ok = user ? await verifyPassword(body.password, user.pass_hash) : await hashPassword('dummy-work').then(() => false);
    if (!ok) {
      recordFailure(ctx.sys, ipKey);
      recordFailure(ctx.sys, userKey);
      throw new HttpError(401, 'Wrong username or password', 'bad_credentials');
    }
    if (user.totp_enabled) {
      if (!body.code) return reply.code(401).send({ error: 'Enter your 2FA code', code: 'totp_required' });
      const secret = decrypt(user.totp_secret_enc, ctx.cfg.secretKey);
      if (!verifyTotp(secret, body.code)) {
        recordFailure(ctx.sys, ipKey);
        recordFailure(ctx.sys, userKey);
        throw new HttpError(401, 'Wrong 2FA code', 'bad_totp');
      }
    }
    clearFailures(ctx.sys, ipKey);
    clearFailures(ctx.sys, userKey);
    const csrf = createSession(ctx, req, reply, user.id);
    // The login password is also the vault passphrase: signing in unlocks.
    if (ctx.vault.locked && ctx.vault.file?.loginIsPassphrase) await unlockVault(ctx, { passphrase: body.password }).catch(() => undefined);
    return { ok: true, username: user.username, csrf };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.user) ctx.sys.prepare('DELETE FROM sessions WHERE id = ?').run(req.user.sessionId);
    if (req.user) clearOnceGrants(req.user.id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    lockVault(ctx, 'logout');
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const user = ctx.sys.prepare('SELECT id, username, totp_enabled, created_at FROM users WHERE id = ?').get(req.user!.id) as any;
    const sessions = ctx.sys.prepare('SELECT id, created_at, last_seen, user_agent, ip FROM sessions WHERE user_id = ? ORDER BY last_seen DESC').all(req.user!.id) as any[];
    return {
      id: user.id,
      username: user.username,
      totpEnabled: !!user.totp_enabled,
      csrf: req.user!.csrf,
      sessions: sessions.map((s) => ({ current: s.id === req.user!.sessionId, createdAt: s.created_at, lastSeen: s.last_seen, userAgent: s.user_agent, ip: s.ip })),
    };
  });

  app.post('/api/auth/password', async (req) => {
    const body = parse(z.object({ current: z.string().min(1), next: z.string().min(10).max(512) }), req.body);
    const user = ctx.sys.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
    if (!(await verifyPassword(body.current, user.pass_hash))) throw new HttpError(401, 'Current password is wrong');
    // When the login password is the vault passphrase, the vault key is rewrapped first.
    await onPasswordChanged(ctx, body.current, body.next);
    ctx.sys.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(body.next), user.id);
    // Sign out other sessions.
    ctx.sys.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, req.user!.sessionId);
    return { ok: true };
  });

  app.post('/api/auth/sessions/revoke-others', async (req) => {
    ctx.sys.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user!.id, req.user!.sessionId);
    return { ok: true };
  });

  app.post('/api/auth/totp/setup', async (req) => {
    const secret = newTotpSecret();
    ctx.sys.prepare('UPDATE users SET totp_secret_enc = ?, totp_enabled = 0 WHERE id = ?').run(encrypt(secret, ctx.cfg.secretKey), req.user!.id);
    const uri = `otpauth://totp/Everloom:${encodeURIComponent(req.user!.username)}?secret=${secret}&issuer=Everloom&digits=6&period=30`;
    const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { secret, uri, svg };
  });

  app.post('/api/auth/totp/enable', async (req) => {
    const { code } = parse(z.object({ code: z.string().max(12) }), req.body);
    const user = ctx.sys.prepare('SELECT totp_secret_enc FROM users WHERE id = ?').get(req.user!.id) as any;
    if (!user?.totp_secret_enc) throw new HttpError(400, 'Start 2FA setup first');
    if (!verifyTotp(decrypt(user.totp_secret_enc, ctx.cfg.secretKey), code)) throw new HttpError(400, 'That code did not match. Check the time on your phone.');
    ctx.sys.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(req.user!.id);
    return { ok: true };
  });

  app.post('/api/auth/totp/disable', async (req) => {
    const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
    const user = ctx.sys.prepare('SELECT pass_hash FROM users WHERE id = ?').get(req.user!.id) as any;
    if (!(await verifyPassword(password, user.pass_hash))) throw new HttpError(401, 'Wrong password');
    ctx.sys.prepare('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL WHERE id = ?').run(req.user!.id);
    return { ok: true };
  });
}
