import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { FIXTURES } from './helpers.js';
import { STATE_VERSION } from '@everloom/engine';
import { MIGRATIONS } from '../src/db/migrations.js';

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
  expect((db.prepare(`SELECT MAX(version) AS v FROM schema_migrations`).get() as { v: number }).v).toBe(MIGRATIONS.at(-1)!.version);
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

// tests/fixtures/phase2.db was written by the Phase-2 release (commit 824c1f4) through its own API:
// a fantasy campaign with a party member, a quest, an equipped sword, a finished battle, three
// turns with memory, and a phone thread with Tobias.
it('upgrades a Phase-2 database: Phase 3 systems start empty, nothing is lost, and they work at once', async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'everloom-mig2-'));
  copyFileSync(path.join(FIXTURES, 'phase2.db'), path.join(dir, 'everloom.db'));
  const before = new Database(path.join(dir, 'everloom.db'), { readonly: true });
  const tables = ['characters', 'chats', 'messages', 'op_log', 'campaigns', 'phone_messages', 'mem_items', 'llm_calls'];
  const counts = (db: Database.Database) => Object.fromEntries(tables.map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]));
  const was = counts(before);
  const oldState = JSON.parse((before.prepare('SELECT state FROM campaigns').get() as { state: string }).state);
  before.close();
  expect(oldState.version).toBe(2);

  built = await buildApp(loadConfig({ dataDir: dir, webDir: path.join(dir, 'no-web'), logLevel: 'error' }), { logger: false });
  const db = built.ctx.db;
  expect((db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v).toBe(MIGRATIONS.at(-1)!.version);
  const backups = readdirSync(path.join(dir, 'backups')).filter((f) => f.startsWith('pre-migration-v3-'));
  expect(backups).toHaveLength(1);
  // Nothing is lost; the only addition is one entry pinning results that today's rules would
  // replay differently (the old battle), on the latest message, so a swipe can't change them.
  expect(counts(db)).toEqual({ ...was, op_log: was.op_log + 1 });
  const pin = db.prepare("SELECT * FROM op_log WHERE source = 'upgrade'").all() as Array<{ message_id: string | null; ops: string }>;
  expect(pin).toHaveLength(1);
  const lastMsg = db.prepare('SELECT id FROM messages ORDER BY created_at DESC, seq DESC LIMIT 1').get() as { id: string };
  expect(pin[0]!.message_id).toBe(lastMsg.id);
  expect(JSON.parse(pin[0]!.ops)[0].type).toBe('patch');

  const req = await login(built.app);
  const chats = (await req('GET', '/api/chats')).json;
  expect(chats).toHaveLength(1);
  const chat = chats[0];
  const camp = (await req('GET', `/api/campaigns/${chat.campaignId}`)).json;
  const s = camp.state;
  expect(s.version).toBe(STATE_VERSION);
  // Everything from Phase 2 is still there.
  expect(Object.values(s.npcs).map((n: any) => n.name)).toContain('Tobias Moreno');
  expect(Object.values(s.quests).map((q: any) => q.title)).toContain('Find a singer');
  expect((Object.values(s.inventory) as any[]).find((i) => i.name === 'Iron Sword')?.equipped).toBe(true);
  expect(Object.values(s.party).map((p: any) => p.name)).toEqual(['Tobias Moreno']);
  expect(s.player.currency).toBe(oldState.player.currency);
  expect(s.player.bars.hp).toEqual(oldState.player.bars.hp);
  expect((Object.values(s.party)[0] as any).hp).toBe((Object.values(oldState.party)[0] as any).hp);
  expect(s.time.minutes).toBe(oldState.time.minutes);
  // Phase 3 systems start empty.
  expect(s.economy.accounts).toEqual({});
  expect(s.homes).toEqual({});
  expect(s.mail).toEqual({});
  expect(s.feed).toEqual([]);
  expect(s.transit).toEqual({});
  expect(s.partyMeta.leader).toBe('player');
  // Rebuilding from the op log gives the stored state.
  expect((await req('POST', `/api/campaigns/${chat.campaignId}/rebuild`)).json.state).toEqual(s);
  // Old phone texts and memories carry over.
  const phone = (await req('GET', `/api/campaigns/${chat.campaignId}/phone`)).json;
  expect(phone.threads.find((t: any) => t.name === 'Tobias Moreno')?.last?.text).toBeTruthy();
  const mem = (await req('GET', `/api/chats/${chat.id}/memory`)).json;
  expect(mem.items.map((m: any) => m.text)).toContain('Anala promised Tobias a song at the gig.');
  // A swipe-style rebuild after the upgrade keeps the recorded results.
  await req('POST', `/api/campaigns/${chat.campaignId}/rebuild`);
  expect((await req('GET', `/api/campaigns/${chat.campaignId}`)).json.state).toEqual(s);
  // New systems work on the old campaign right away.
  const r = await req('POST', `/api/campaigns/${chat.campaignId}/ops`, {
    chatId: chat.id,
    ops: [
      { type: 'shop.upsert', name: 'Lantern Bar', kind: 'general', npc: 'Tobias Moreno', location: 'The Lantern', open: 0, close: 0 },
      { type: 'location.move', to: 'The Lantern' },
      { type: 'shop.buy', shop: 'Lantern Bar', item: 'Torch' },
      { type: 'home.add', name: 'Back Room', kind: 'room', location: 'The Lantern' },
      { type: 'party.leader', name: 'Tobias Moreno' },
      { type: 'mail.receive', from: 'Tobias Moreno', subject: 'Setlist', body: 'Three songs, then the ballad.' },
      { type: 'cutscene.add', name: 'Gig night', steps: [{ text: 'The lamps dim.' }] },
    ],
  });
  expect(r.json.errors).toEqual([]);
  expect((await req('GET', `/api/chats/${chat.id}/slots`)).json).toEqual([]);
  // Opening again does not migrate (or back up) twice.
  await built.app.close();
  built.ctx.db.close();
  built = await buildApp(loadConfig({ dataDir: dir, webDir: path.join(dir, 'no-web'), logLevel: 'error' }), { logger: false });
  expect(readdirSync(path.join(dir, 'backups'))).toHaveLength(1);
});
