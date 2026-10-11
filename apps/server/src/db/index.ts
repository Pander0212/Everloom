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
 * is written first (VACUUM INTO). All pending migrations run in one transaction, so a failure
 * leaves the database exactly as it was, and the error says how to get back (README › Update).
 */
export function migrate(db: DB, opts: { backupDir?: string; migrations?: typeof MIGRATIONS } = {}): number[] {
  const all = opts.migrations ?? MIGRATIONS;
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const applied = new Set((db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version));
  const pending = all.filter((m) => !applied.has(m.version)).sort((a, b) => a.version - b.version);
  const backup = opts.backupDir && applied.size && pending.length ? backupBeforeMigrate(db, opts.backupDir, Math.max(...applied)) : null;
  const done: number[] = [];
  let failed: { version: number; name: string } | null = null;
  try {
    db.transaction(() => {
      for (const m of pending) {
        failed = m;
        db.exec(m.sql);
        db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(m.version, m.name, Date.now());
        done.push(m.version);
      }
    })();
  } catch (e) {
    const f = failed as { version: number; name: string } | null;
    throw new Error(
      [
        `Upgrading the database failed at step ${f?.version} (${f?.name}): ${(e as Error).message}`,
        'Nothing was changed: the database is as it was before this update.',
        backup ? `A copy from just before the upgrade is at ${backup}.` : '',
        'To go back: start the previous version of Everloom (it opens this database as it is), or restore a backup in Settings › Backups & import.',
        'If the database itself is damaged: stop Everloom, replace everloom.db with that copy and delete everloom.db-wal and everloom.db-shm next to it, then start the previous version.',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return done;
}

function backupBeforeMigrate(db: DB, dir: string, fromVersion: number): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `pre-migration-v${fromVersion}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  if (!existsSync(file)) db.prepare('VACUUM INTO ?').run(file);
  // Keep the three newest pre-migration copies.
  const old = readdirSync(dir).filter((f) => f.startsWith('pre-migration-')).sort().reverse().slice(3);
  for (const f of old) unlinkSync(path.join(dir, f));
  return file;
}

export function json<T>(value: string | null | undefined, fallback: T): T {
  if (value == null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
