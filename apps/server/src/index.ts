import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate, openDb } from './db/index.js';
import { hashPassword, randomToken } from './security/crypto.js';
import { applyPendingRestore, startScheduler } from './services/backup.js';

async function main() {
  const cfg = loadConfig();
  if (applyPendingRestore(cfg.dataDir)) console.log('Restored data from a staged backup.');
  if (process.argv.includes('--migrate-only')) {
    const db = openDb(cfg.dbPath);
    const done = migrate(db);
    console.log(done.length ? `Applied migrations: ${done.join(', ')}` : 'Database is up to date');
    db.close();
    return;
  }
  const resetAt = process.argv.indexOf('--reset-password');
  if (resetAt >= 0) {
    await resetPassword(cfg.dbPath, process.argv[resetAt + 1], process.argv.includes('--disable-2fa'));
    return;
  }
  const { app, ctx } = await buildApp(cfg);
  const stopScheduler = startScheduler(ctx);
  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    stopScheduler();
    await app.close();
    ctx.db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  await app.listen({ port: cfg.port, host: cfg.host });
  console.log(`Everloom listening on http://${cfg.host}:${cfg.port} (data: ${cfg.dataDir})`);
}

/** Recovery for a locked-out owner: sets a new random password, signs out every session, clears lockouts. */
async function resetPassword(dbPath: string, username: string | undefined, disable2fa: boolean) {
  const db = openDb(dbPath);
  migrate(db);
  const users = db.prepare('SELECT id, username FROM users').all() as Array<{ id: string; username: string }>;
  const user = username ? users.find((u) => u.username === username) : users.length === 1 ? users[0] : undefined;
  if (!user) {
    console.error(users.length ? `Usage: --reset-password <username>. Accounts: ${users.map((u) => u.username).join(', ')}` : 'No account exists yet. Open the app to create one.');
    db.close();
    process.exitCode = 1;
    return;
  }
  const password = randomToken(12);
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
  if (disable2fa) db.prepare('UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL WHERE id = ?').run(user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM auth_failures').run();
  db.close();
  console.log(`New password for ${user.username}: ${password}`);
  console.log('Sign in with it, then change it in Settings → Account & security.' + (disable2fa ? ' Two-factor sign-in was turned off.' : ''));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
