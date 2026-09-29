import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { migrate, openDb } from './db/index.js';
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
