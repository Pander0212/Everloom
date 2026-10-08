import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import yazl from 'yazl';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { applyPendingRestore } from '../src/services/backup.js';
import { createClient, FIXTURES, parseSse, waitFor, type TestClient } from './helpers.js';

/** Build a small SillyTavern data folder like data/default-user/. */
async function makeStFolder(): Promise<string> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'st-fixture-'));
  for (const d of ['characters', 'chats/Seraphina', 'worlds', 'User Avatars', 'backgrounds', 'OpenAI Settings', 'groups', 'group chats']) mkdirSync(path.join(root, d), { recursive: true });
  copyFileSync(path.join(FIXTURES, 'st/Seraphina.png'), path.join(root, 'characters/Seraphina.png'));
  writeFileSync(path.join(root, 'characters/Guide.json'), JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Guide', first_mes: 'Welcome.', description: 'A helpful guide.' } }));
  const chat = [
    { user_name: 'Wanderer', character_name: 'Seraphina', create_date: '2024-05-01 @10h 00m 00s 000ms', chat_metadata: { note_prompt: '[Be gentle.]', note_depth: 3 } },
    { name: 'Seraphina', is_user: false, is_system: false, send_date: 'May 1, 2024 10:00am', mes: 'You wake in the glade.', swipe_id: 0, swipes: ['You wake in the glade.', 'Alt greeting'] },
    { name: 'Wanderer', is_user: true, is_system: false, send_date: 'May 1, 2024 10:01am', mes: 'Where am I?' },
    { name: 'Seraphina', is_user: false, is_system: false, send_date: 'May 1, 2024 10:02am', mes: 'Take two.', swipe_id: 1, swipes: ['Take one.', 'Take two.'], extra: { reasoning: 'thinking' } },
  ];
  writeFileSync(path.join(root, 'chats/Seraphina/Seraphina - 2024-05-01.jsonl'), chat.map((l) => JSON.stringify(l)).join('\n'));
  copyFileSync(path.join(FIXTURES, 'st/Eldoria.json'), path.join(root, 'worlds/Eldoria.json'));
  const avatar = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#445566' } }).png().toBuffer();
  writeFileSync(path.join(root, 'User Avatars/me.png'), avatar);
  writeFileSync(path.join(root, 'backgrounds/forest.png'), avatar);
  writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ power_user: { personas: { 'me.png': 'Wanderer' }, persona_descriptions: { 'me.png': { description: 'A lost traveler.' } }, default_persona: 'me.png' } }));
  writeFileSync(path.join(root, 'OpenAI Settings/Cozy.json'), JSON.stringify({ temperature: 0.8, prompts: [{ identifier: 'main', content: 'Be cozy.' }, { identifier: 'chatHistory', marker: true }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'chatHistory', enabled: true }] }] }));
  writeFileSync(path.join(root, 'groups/1.json'), JSON.stringify({ name: 'Forest friends', members: ['Seraphina.png', 'Guide.json'], chats: ['g1'] }));
  writeFileSync(path.join(root, 'group chats/g1.jsonl'), [JSON.stringify({ user_name: 'Wanderer', character_name: 'unused', chat_metadata: {} }), JSON.stringify({ name: 'Guide', is_user: false, mes: 'Hello group', send_date: 'May 2, 2024 9:00am' })].join('\n'));
  return root;
}

function snapshot(dir: string) {
  const out: Record<string, number> = {};
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = path.join(d, n);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = st.mtimeMs + st.size;
    }
  };
  walk(dir);
  return out;
}

let c: TestClient;
afterEach(async () => c?.close());

describe('SillyTavern migration', () => {
  it('scans and imports everything without touching the source', async () => {
    c = await createClient();
    const root = await makeStFolder();
    const before = snapshot(root);
    const scan = await c.req('POST', '/api/import/sillytavern/scan', { path: root });
    expect(scan.status).toBe(200);
    expect(scan.json.counts).toMatchObject({ characters: 2, chats: 1, groups: 1, personas: 1, worlds: 1, backgrounds: 1, presets: 1 });
    const run = await c.req('POST', '/api/import/sillytavern/run', { path: root, include: {} });
    expect(run.status).toBe(200);
    expect(run.json.errors).toEqual([]);
    expect(run.json.imported).toMatchObject({ characters: 2, chats: 2, groups: 1, personas: 1, worlds: 1, backgrounds: 1, presets: 1 });
    const chars = (await c.req('GET', '/api/characters')).json;
    expect(chars.map((x: any) => x.name).sort()).toEqual(['Guide', 'Seraphina']);
    const chats = (await c.req('GET', '/api/chats')).json;
    const single = chats.find((x: any) => x.characterId);
    const msgs = (await c.req('GET', `/api/chats/${single.id}/messages`)).json;
    expect(msgs).toHaveLength(3);
    expect(msgs[0].swipes).toHaveLength(2);
    expect(msgs[2].swipeId).toBe(1);
    expect(msgs[2].swipes[1].text).toBe('Take two.');
    const chat = (await c.req('GET', `/api/chats/${single.id}`)).json;
    expect(chat.metadata.authorsNote.content).toBe('[Be gentle.]');
    const personas = (await c.req('GET', '/api/personas')).json;
    expect(personas[0]).toMatchObject({ name: 'Wanderer', description: 'A lost traveler.', isDefault: true });
    expect(personas[0].avatar).toMatch(/^\/media\//);
    expect((await c.req('GET', '/api/lorebooks')).json.some((b: any) => b.name === 'Eldoria')).toBe(true);
    expect((await c.req('GET', '/api/presets')).json[0].name).toBe('Cozy');
    expect(snapshot(root)).toEqual(before);
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects paths outside the allowed roots and missing folders', async () => {
    c = await createClient();
    c.built.ctx.cfg.importRoots = [os.tmpdir()];
    expect((await c.req('POST', '/api/import/sillytavern/scan', { path: path.resolve(import.meta.dirname, '..') })).status).toBe(403);
    expect((await c.req('POST', '/api/import/sillytavern/scan', { path: '/definitely/not/here' })).status).toBe(404);
  });

  it('accepts an uploaded zip of the folder and rejects traversal entries', async () => {
    c = await createClient();
    const root = await makeStFolder();
    const build = (extra?: string) =>
      new Promise<Buffer>((resolve) => {
        const z = new yazl.ZipFile();
        for (const [rel] of Object.entries(snapshot(root))) z.addFile(path.join(root, rel), `default-user/${rel}`);
        if (extra) z.addBuffer(Buffer.from('evil'), extra);
        z.end();
        const chunks: Buffer[] = [];
        z.outputStream.on('data', (d) => chunks.push(d));
        z.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
      });
    const good = await c.req('POST', '/api/import/sillytavern/upload', await build(), { 'content-type': 'application/zip' });
    expect(good.status).toBe(200);
    const scan = await c.req('POST', '/api/import/sillytavern/scan', { path: good.json.path });
    expect(scan.status).toBe(200);
    expect(scan.json.counts.characters).toBeGreaterThan(0);
    // yazl refuses "..", so write a same-length placeholder and patch the name bytes afterwards.
    const raw = await build('XX/escape.txt');
    let patched = raw.toString('latin1');
    patched = patched.split('XX/escape.txt').join('../escape.txt');
    const bad = await c.req('POST', '/api/import/sillytavern/upload', Buffer.from(patched, 'latin1'), { 'content-type': 'application/zip' });
    expect(bad.status).toBe(400);
    expect(existsSync(path.join(c.dataDir, 'escape.txt'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('backups', () => {
  it('creates, lists, downloads and restores (staged)', async () => {
    c = await createClient();
    await c.req('POST', '/api/personas', { name: 'Before' });
    const b = await c.req('POST', '/api/backups', {});
    expect(b.status).toBe(200);
    const list = (await c.req('GET', '/api/backups')).json;
    expect(list[0].name).toBe(b.json.name);
    const dl = await c.req('GET', `/api/backups/${b.json.name}`);
    expect(dl.headers['content-type']).toBe('application/zip');
    await c.req('POST', '/api/personas', { name: 'After' });
    // Stage the restore directly (the route exits the process afterwards).
    const { stageRestore } = await import('../src/services/backup.js');
    const file = path.join(c.dataDir, 'backups', b.json.name);
    await stageRestore(c.built.ctx, file);
    expect(existsSync(path.join(c.dataDir, 'restore-pending', 'everloom.db'))).toBe(true);
    c.built.ctx.db.close();
    expect(applyPendingRestore(c.dataDir)).toBe(true);
    const Database = (await import('better-sqlite3-multiple-ciphers')).default;
    const db = new Database(path.join(c.dataDir, 'everloom.db'));
    const names = (db.prepare('SELECT name FROM personas').all() as any[]).map((r) => r.name);
    db.close();
    expect(names).toEqual(['Before']);
    // Reopen so cleanup can close it.
    c.built.ctx.db = new Database(path.join(c.dataDir, 'everloom.db'));
  });
});

describe('world tools against the mock model', () => {
  let mock: Awaited<ReturnType<typeof startMockLlm>>;
  beforeAll(async () => {
    mock = await startMockLlm();
  });
  afterAll(async () => mock.close());
  beforeEach(async () => {
    await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ reset: true }) });
  });

  it('expands the map and runs the New Game wizard with an opening scene', async () => {
    c = await createClient();
    const conn = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story' });
    await c.req('PATCH', '/api/settings', { roles: { main: conn.json.id } });
    const ch = await c.req('POST', '/api/characters', { card: { name: 'Iris' } });
    const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id, greeting: false })).json;
    const fill = await c.req('POST', '/api/newgame/fill', { config: { ...(await import('@everloom/engine')).defaultNewGame(3), title: 'Rain' }, premise: 'A rainy town' });
    expect(fill.status).toBe(200);
    expect(fill.json.config.location.local || fill.json.config.location.world).toBeTruthy();
    const cfg = fill.json.config;
    cfg.character.name = 'Anala';
    const ng = await c.req('POST', `/api/chats/${chat.id}/newgame`, { config: cfg, opening: true });
    const ev = parseSse(ng.body);
    expect(ev[0].type).toBe('state');
    expect(ev.some((e) => e.type === 'done')).toBe(true);
    const msgs = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
    expect(msgs.length).toBe(1);
    const state = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
    expect(state.player.name).toBe('Anala');
    const exp = await c.req('POST', `/api/campaigns/${chat.campaignId}/map/expand`, { chatId: chat.id, parentId: state.currentLocationId });
    expect(exp.status).toBe(200);
    expect(exp.json.added).toBe(2);
    const after = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
    const added = Object.values(after.locations).filter((l: any) => l.parentId === state.currentLocationId) as any[];
    expect(added.map((l) => l.name).sort()).toEqual(['Lantern Row', 'Old Pier']);
    expect(added.every((l) => l.discovered === false)).toBe(true);
    void waitFor;
  });
});
