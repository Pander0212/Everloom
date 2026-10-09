import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { expect, it } from 'vitest';
import { migrate } from '../src/db/index.js';

it('a failed upgrade changes nothing, keeps a copy, and says how to get back', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'everloom-mig-'));
  const db = new Database(path.join(dir, 'everloom.db'));
  migrate(db, { migrations: [{ version: 1, name: 'start', sql: 'CREATE TABLE a (x INTEGER); INSERT INTO a VALUES (1);' }] });
  const next = [
    { version: 1, name: 'start', sql: '' },
    { version: 2, name: 'fine', sql: 'CREATE TABLE b (y INTEGER);' },
    { version: 3, name: 'broken', sql: 'CREATE TABLE a (oops INTEGER);' },
  ];
  let err = '';
  try {
    migrate(db, { migrations: next, backupDir: path.join(dir, 'backups') });
  } catch (e) {
    err = (e as Error).message;
  }
  expect(err).toMatch(/failed at step 3 \(broken\)/);
  expect(err).toMatch(/Nothing was changed/);
  const copy = /A copy from just before the upgrade is at (.+\.db)\./.exec(err)?.[1];
  expect(copy && existsSync(copy)).toBe(true);
  // Step 2 rolled back with step 3: the database is as it was.
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").get()).toBeUndefined();
  expect((db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version)).toEqual([1]);
  expect(db.prepare('SELECT x FROM a').get()).toEqual({ x: 1 });
});
