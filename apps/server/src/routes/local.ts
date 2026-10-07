/**
 * Local control for the host scripts (backup.sh, run by update.sh): a random token written to
 * the data folder at start (readable by the server's own user only), and routes that answer only
 * on the loopback interface with that token. Inside the container, `curl` with the token asks the
 * running server for a backup — the server holds the database open (and the vault key), so it is
 * the one that can copy it consistently.
 */
import { timingSafeEqual } from 'node:crypto';
import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError, type AppContext } from '../context.js';
import { randomToken } from '../security/crypto.js';
import { createBackup } from '../services/backup.js';

let token = '';
const loopbackIp = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

export function localTokenPath(dataDir: string) {
  return path.join(dataDir, '.control-token');
}

function check(req: FastifyRequest) {
  const got = String(req.headers['x-control-token'] ?? '');
  if (!loopbackIp(req.socket.remoteAddress ?? '') || !token || got.length !== token.length || !timingSafeEqual(Buffer.from(got), Buffer.from(token))) {
    throw new HttpError(403, 'Not allowed', 'control_token');
  }
}

export function registerLocal(app: FastifyInstance, ctx: AppContext) {
  token = randomToken(32);
  const file = localTokenPath(ctx.cfg.dataDir);
  writeFileSync(file, token, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows */
  }
  /** A backup in the data folder's backups/ (the same zip the app makes), for the host to copy out. */
  app.post('/api/local/backup', async (req) => {
    check(req);
    const b = await createBackup(ctx, 'host');
    return { ok: true, name: b.name, size: b.size, dir: path.basename(ctx.cfg.backupDir) };
  });
}
