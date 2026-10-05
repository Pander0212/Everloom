/**
 * The Windows app's side of the server (only when started by it, EVERLOOM_DESKTOP=1):
 *
 * - control calls from the desktop shell (shut down cleanly, lock the vault, back up before an
 *   update, the phone address), authenticated with a random token the shell passes at start;
 * - "No password on this PC": while the server only listens on 127.0.0.1, a request from this
 *   computer is signed in as the owner without a password. Listening on the network (phone on
 *   Wi-Fi) switches this off by itself, and the shell refuses to turn the network on while it's set.
 */
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { HttpError, type AppContext } from '../context.js';
import { hashPassword, randomToken, verifyPassword } from '../security/crypto.js';
import { createBackup } from '../services/backup.js';
import { lockVault, vaultStatus } from '../services/vault.js';
import { requestShutdown } from '../shutdown.js';
import { parse } from '../util/validate.js';

export const desktopMode = () => process.env.EVERLOOM_DESKTOP === '1';

interface DesktopFile {
  noPassword?: boolean;
}
const fileOf = (ctx: AppContext) => path.join(ctx.cfg.dataDir, 'desktop-server.json');
export function desktopSettings(ctx: AppContext): DesktopFile {
  try {
    return existsSync(fileOf(ctx)) ? JSON.parse(readFileSync(fileOf(ctx), 'utf8')) : {};
  } catch {
    return {};
  }
}
function saveDesktop(ctx: AppContext, patch: DesktopFile) {
  writeFileSync(fileOf(ctx), JSON.stringify({ ...desktopSettings(ctx), ...patch }, null, 2));
}

const loopbackHost = (h: string) => h === '127.0.0.1' || h === '::1' || h === 'localhost';
const loopbackIp = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

/** Whether this request is signed in without a password (desktop, loopback only, owner chose it). */
export function noPasswordApplies(ctx: AppContext, req: FastifyRequest): boolean {
  // The Host header must name this PC too: a web page whose own domain resolves to 127.0.0.1 (DNS
  // rebinding) would otherwise count as "this computer".
  const host = String(req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return desktopMode() && !!desktopSettings(ctx).noPassword && loopbackHost(ctx.cfg.host) && loopbackIp(req.socket.remoteAddress ?? '') && loopbackHost(host);
}

/** The account a password-free request is signed in as: the first one. */
export function ownerId(ctx: AppContext): string | null {
  const r = ctx.sys.prepare('SELECT id FROM users ORDER BY created_at LIMIT 1').get() as { id: string } | undefined;
  return r?.id ?? null;
}

/** First-run setup on the desktop may choose no password: a random one is stored instead. */
export async function setupNoPassword(ctx: AppContext): Promise<string> {
  if (!desktopMode() || !loopbackHost(ctx.cfg.host)) throw new HttpError(400, 'Only the Windows app, listening on this PC only, can skip the password');
  saveDesktop(ctx, { noPassword: true });
  return hashPassword(randomToken(32));
}

function checkToken(req: FastifyRequest) {
  const want = process.env.EVERLOOM_DESKTOP_TOKEN ?? '';
  const got = String(req.headers['x-desktop-token'] ?? '');
  if (!want || want.length !== got.length || !timingSafeEqual(Buffer.from(want), Buffer.from(got))) throw new HttpError(403, 'Not the desktop app', 'desktop_token');
}

export function registerDesktop(app: FastifyInstance, ctx: AppContext) {
  if (!desktopMode()) return;

  app.get('/api/desktop/state', async (req) => {
    checkToken(req);
    return { noPassword: !!desktopSettings(ctx).noPassword, host: ctx.cfg.host, vault: vaultStatus(ctx) };
  });
  app.post('/api/desktop/shutdown', async (req) => {
    checkToken(req);
    // Answer first, then close the server and the database cleanly.
    setTimeout(() => requestShutdown('desktop app'), 50);
    return { ok: true };
  });
  app.post('/api/desktop/lock', async (req) => {
    checkToken(req);
    const locked = lockVault(ctx, 'manual');
    return { enabled: ctx.vault.enabled, locked: locked || ctx.vault.locked };
  });
  app.post('/api/desktop/backup', async (req) => {
    checkToken(req);
    // A locked vault can't be backed up consistently: the app asks to unlock first.
    if (ctx.vault.enabled && ctx.vault.locked) throw new HttpError(423, 'Unlock the vault first, so a backup can be made before the update', 'locked');
    const b = await createBackup(ctx, 'preupdate');
    return { ok: true, backup: b };
  });
  app.get('/api/desktop/lan', async (req) => {
    checkToken(req);
    const urls = Object.values(os.networkInterfaces())
      .flat()
      .filter((a): a is os.NetworkInterfaceInfo => !!a && a.family === 'IPv4' && !a.internal)
      .map((a) => `http://${a.address}:${ctx.cfg.port}`);
    const svg = urls[0] ? await QRCode.toString(urls[0], { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : '';
    return { urls, svg, listening: !loopbackHost(ctx.cfg.host) };
  });

  // Settings › Account › "No password on this PC" (signed-in owner, on this PC).
  app.post('/api/auth/no-password', async (req) => {
    const b = parse(z.object({ on: z.boolean(), password: z.string().max(512).optional(), next: z.string().min(10).max(512).optional() }), req.body);
    if (!loopbackIp(req.socket.remoteAddress ?? '') || !loopbackHost(ctx.cfg.host)) throw new HttpError(400, 'Only on this PC, while Everloom isn’t shared on the network');
    const user = ctx.sys.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as { pass_hash: string; id: string };
    if (b.on) {
      if (!b.password || !(await verifyPassword(b.password, user.pass_hash))) throw new HttpError(401, 'Enter your current password to turn this on');
      if (ctx.vault.file?.loginIsPassphrase) throw new HttpError(400, 'Your password also unlocks the vault; give the vault its own passphrase first (Settings › Privacy)');
      saveDesktop(ctx, { noPassword: true });
    } else {
      if (!b.next) throw new HttpError(400, 'Choose a password (10 characters or more)');
      ctx.sys.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(b.next), user.id);
      saveDesktop(ctx, { noPassword: false });
    }
    return { noPassword: !!desktopSettings(ctx).noPassword };
  });
}
