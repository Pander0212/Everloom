import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { FIXTURES } from './helpers.js';
import { STATE_VERSION } from '@everloom/engine';

// tests/fixtures/phase1.db was written by the Phase-1 release (commit f1388bc) through its own API:
// one campaign chat with a Tobias NPC, three turns, a pinned "fact" memory and a rolling summary.
let built: BuiltApp | null = null;
let dir = '';
afterEach(async () => {
  await built?.app.close();
  built?.ctx.db.close();
  built = null;
  rmSync(dir, { recursive: true, force: true });
});

async function login(app: BuiltApp['app']) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'owner', password: 'correct horse battery' } });
  expect(r.statusCode).toBe(200);
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  const csrf = JSON.parse(r.body).csrf;
  return (method: string, url: string, body?: unknown) =>
    app.inject({ method: method as any, url, payload: body === undefined ? undefined : JSON.stringify(body), headers: { cookie, 'x-csrf-token': csrf, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) } }).then((x) => ({ status: x.statusCode, json: JSON.parse(x.body || 'null') }));
}

it('upgrades a Phase-1 database in place, with a backup first and nothing lost', async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'everloom-mig-'));
  copyFileSync(path.join(FIXTURES, 'phase1.db'), path.join(dir, 'everloom.db'));
  const before = new Database(path.join(dir, 'everloom.db'), { readonly: true });
  const counts = (db: Database.Database) => Object.fromEntries(['characters', 'chats', 'messages', 'op_log', 'memories', 'campaigns'].map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));
  const was = counts(before);
  before.close();

  built = await buildApp(loadConfig({ dataDir: dir, webDir: path.join(dir, 'no-web'), logLevel: 'error' }), { logger: false });
  const db = built.ctx.db;
  // Schema is current and the pre-migration copy exists and is still a v1 database.
  expect((db.prepare(`SELECT MAX(version) AS v FROM schema_migrations`).get() as { v: number }).v).toBe(3);
  const backups = readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith('pre-migration-v1-'));
  expect(backups).toHaveLength(1);
  const bak = new Database(path.join(dir, 'backups', backups[0]), { readonly: true });
  expect((bak.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v).toBe(1);
  expect(counts(bak)).toEqual(was);
  bak.close();
  // Nothing in the old tables was touched.
  expect(counts(db)).toEqual(was);

  const req = await login(built.app);
  const chat = (await req('GET', '/api/chats')).json[0];
  // Old memories carry over: the pinned note became a fact, the rolling summary a chapter summary.
  const mem = (await req('GET', `/api/chats/${chat.id}/memory`)).json;
  expect(mem.facts.map((f: any) => f.text)).toContain('Anala is allergic to cats.');
  expect(mem.summaries.map((s: any) => s.text)).toContain('Anala arrived at the Lantern and met Tobias.');
  // The campaign reads as the current state version, with its NPC intact.
  const camp = (await req('GET', `/api/campaigns/${chat.campaignId}`)).json;
  expect(camp.state.version).toBe(STATE_VERSION);
  expect(camp.state.bonds).toEqual({});
  expect(camp.state.economy.accounts).toEqual({});
  expect(camp.state.homes).toEqual({});
  expect(Object.values(camp.state.npcs).map((n: any) => n.name)).toContain('Tobias Moreno');
  expect((Object.values(camp.state.npcs)[0] as any).goals).toEqual([]);
  // A rebuild from the op log gives the same state as the stored one.
  const rebuilt = (await req('POST', `/api/campaigns/${chat.campaignId}/rebuild`)).json.state;
  expect(rebuilt).toEqual(camp.state);
  // And the prompt builds with the new scene block and the migrated summary.
  const scene = (await req('GET', `/api/chats/${chat.id}/scene?fresh=1`)).json;
  expect(scene.text).toContain('Anala arrived at the Lantern and met Tobias.');
  expect(scene.text).toContain('Tobias Moreno');
  // Opening again does not migrate (or back up) twice.
  await built.app.close();
  built.ctx.db.close();
  built = await buildApp(loadConfig({ dataDir: dir, webDir: path.join(dir, 'no-web'), logLevel: 'error' }), { logger: false });
  expect(readdirSync(path.join(dir, 'backups'))).toHaveLength(1);
});
