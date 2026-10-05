import Database from 'better-sqlite3-multiple-ciphers';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './migrations.js';

export type DB = Database.Database;

export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db, { backupDir: path.join(path.dirname(file), 'backups') });
  return db;
}

/**
 * Apply pending migrations. When an existing database is about to be upgraded, a consistent copy
 * is written first (VACUUM INTO) so an upgrade can always be undone by hand.
 */
export function migrate(db: DB, opts: { backupDir?: string } = {}): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version));
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version));
  if (opts.backupDir && applied.size && pending.length) backupBeforeMigrate(db, opts.backupDir, Math.max(...applied));
  const done: number[] = [];
  for (const m of MIGRATIONS.slice().sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, Date.now());
    });
    tx();
    done.push(m.version);
  }
  return done;
}

function backupBeforeMigrate(db: DB, dir: string, fromVersion: number) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pre-migration-v${fromVersion}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  if (!existsSync(file)) db.prepare('VACUUM INTO ?').run(file);
  // Keep the three newest pre-migration copies.
  const old = readdirSync(dir).filter((f) => f.startsWith('pre-migration-')).sort().reverse().slice(3);
  for (const f of old) unlinkSync(path.join(dir, f));
}

export function json<T>(value: string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
