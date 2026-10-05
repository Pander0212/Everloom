/**
 * The Vault: content encrypted on disk, unlocked only with the passphrase (or recovery key), locked
 * on demand, when idle, on logout and after a restart; backups stay encrypted; turning it off gives
 * the plain data back with the accounts intact.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createClient, type TestClient } from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SECRET = 'Velvetwhisper the lighthouse keeper';
const PASS = 'correct horse battery staple';

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) out.push(...filesUnder(f));
    else out.push(f);
  }
  return out;
}
const containsPlain = (dir: string, text: string) => filesUnder(dir).filter((f) => !f.includes(`${path.sep}backups${path.sep}`) && readFileSync(f).includes(text));

let c: TestClient;
afterEach(async () => c?.close());

async function setup() {
  c = await createClient();
  const ch = (await c.req('POST', '/api/characters', { card: { name: 'Keeper', description: SECRET, first_mes: 'The lamp turns.' } })).json;
  const m = (await c.req('POST', `/api/media?kind=gallery&characterId=${ch.id}`, PNG, { 'content-type': 'image/png' })).json;
  return { ...ch, mediaUrl: m.url as string };
}

describe('vault', () => {
  it('turning it on encrypts the database and media; plain text is nowhere on disk but the old backups', async () => {
    const ch = await setup();
    expect(containsPlain(c.dataDir, SECRET).length).toBeGreaterThan(0);
    const r = await c.req('POST', '/api/vault/enable', { passphrase: PASS });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ enabled: true, locked: false, state: 'on' });
    expect(r.json.recoveryKey).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4})+/);
    // Still usable while unlocked.
    expect((await c.req('GET', `/api/characters/${ch.id}`)).json.card.description).toBe(SECRET);
    expect(containsPlain(c.dataDir, SECRET)).toEqual([]);
    expect(readFileSync(path.join(c.dataDir, 'everloom.db')).subarray(0, 15).toString()).not.toBe('SQLite format 3');
    const media = filesUnder(path.join(c.dataDir, 'media'));
    expect(media.length).toBeGreaterThan(0);
    for (const f of media) expect(readFileSync(f).subarray(0, 8).toString()).toBe('EVLTENC1');
    // The gallery picture still comes back as an image, and isn't cached anywhere.
    const pic = await c.req('GET', ch.mediaUrl);
    expect(pic.raw.subarray(1, 4).toString()).toBe('PNG');
    expect(pic.headers['cache-control']).toBe('no-store');
    // The backup taken before turning it on is the only plain copy, and it's reported.
    expect((await c.req('GET', '/api/vault')).json.plaintextBackups).toBeGreaterThan(0);
    const del = (await c.req('POST', '/api/vault/delete-plaintext-backups', {})).json;
    expect(del.plaintextBackups).toBe(0);
    expect(filesUnder(c.dataDir).filter((f) => readFileSync(f).includes(SECRET))).toEqual([]);
  }, 60_000);

  it('locked: content routes answer 423; the wrong passphrase is refused; the recovery key works', async () => {
    const ch = await setup();
    const { recoveryKey } = (await c.req('POST', '/api/vault/enable', { passphrase: PASS })).json;
    await c.req('POST', '/api/vault/lock', {});
    const status = (await c.req('GET', '/api/auth/status')).json;
    expect(status.vault).toMatchObject({ enabled: true, locked: true });
    for (const u of ['/api/characters', `/api/characters/${ch.id}`, '/api/settings', '/api/chats']) expect((await c.req('GET', u)).status, u).toBe(423);
    expect((await c.req('POST', '/api/vault/unlock', { passphrase: 'wrong wrong wrong' })).status).toBe(401);
    expect((await c.req('POST', '/api/vault/unlock', { recoveryKey: recoveryKey.toLowerCase() })).json.locked).toBe(false);
    expect((await c.req('GET', `/api/characters/${ch.id}`)).json.card.description).toBe(SECRET);
  }, 60_000);

  it('a restart comes back locked; backups stay encrypted and carry their key file', async () => {
    const ch = await setup();
    await c.req('POST', '/api/vault/enable', { passphrase: PASS });
    const b = (await c.req('POST', '/api/backups', {})).json;
    const zip = unzipSync(new Uint8Array(readFileSync(path.join(c.dataDir, 'backups', b.name))));
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(['everloom.db', 'vault.json', 'system.db', 'manifest.json']));
    expect(Buffer.from(zip['everloom.db']!).includes(SECRET)).toBe(false);
    expect(Buffer.from(zip['everloom.db']!).subarray(0, 15).toString()).not.toBe('SQLite format 3');
    // A fresh server on the same data: locked until the passphrase is given; the session still works.
    const cookie = c.cookie;
    const csrf = c.csrf;
    c.built.ctx.db.close();
    const again = await buildApp(loadConfig({ dataDir: c.dataDir, webDir: path.join(c.dataDir, 'no-web'), logLevel: 'error' }), { logger: false });
    const req = (method: string, url: string, body?: unknown) => again.app.inject({ method: method as 'GET', url, payload: body as object, headers: { cookie, 'x-csrf-token': csrf } });
    expect(JSON.parse((await req('GET', '/api/auth/status')).body)).toMatchObject({ authenticated: true, vault: { locked: true } });
    expect((await req('GET', `/api/characters/${ch.id}`)).statusCode).toBe(423);
    expect((await req('POST', '/api/vault/unlock', { passphrase: PASS })).statusCode).toBe(200);
    expect(JSON.parse((await req('GET', `/api/characters/${ch.id}`)).body).card.description).toBe(SECRET);
    await again.app.close();
    again.ctx.db.close();
    again.ctx.sys.close();
  }, 60_000);

  it('the login password can be the passphrase: signing in unlocks, and a password change rewraps the key', async () => {
    await setup();
    await c.req('POST', '/api/vault/enable', { useLoginPassword: 'correct horse battery' });
    await c.req('POST', '/api/auth/logout', {});
    expect(c.built.ctx.vault.locked).toBe(true);
    await c.req('POST', '/api/auth/login', { username: 'owner', password: 'correct horse battery' });
    expect(c.built.ctx.vault.locked).toBe(false);
    await c.req('POST', '/api/auth/password', { current: 'correct horse battery', next: 'a brand new long password' });
    await c.req('POST', '/api/vault/lock', {});
    expect((await c.req('POST', '/api/vault/unlock', { passphrase: 'correct horse battery' })).status).toBe(401);
    expect((await c.req('POST', '/api/vault/unlock', { passphrase: 'a brand new long password' })).status).toBe(200);
  }, 60_000);

  it('locks after the idle time', async () => {
    await setup();
    await c.req('POST', '/api/vault/enable', { passphrase: PASS, idleMinutes: 1 });
    const { startVaultTimer } = await import('../src/services/vault.js');
    c.built.ctx.vault.lastActivity = Date.now() - 2 * 60_000;
    const stop = startVaultTimer(c.built.ctx);
    await new Promise((r) => setTimeout(r, 15_500));
    stop();
    expect(c.built.ctx.vault.locked).toBe(true);
  }, 30_000);

  it('turning it off gives the plain data back, accounts and media intact', async () => {
    const ch = await setup();
    await c.req('POST', '/api/vault/enable', { passphrase: PASS });
    await c.req('POST', '/api/vault/lock', {});
    const r = await c.req('POST', '/api/vault/disable', { passphrase: PASS });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ enabled: false, state: 'off' });
    expect(readFileSync(path.join(c.dataDir, 'everloom.db')).subarray(0, 15).toString()).toBe('SQLite format 3');
    expect((await c.req('GET', `/api/characters/${ch.id}`)).json.card.description).toBe(SECRET);
    for (const f of filesUnder(path.join(c.dataDir, 'media'))) expect(readFileSync(f).subarray(0, 8).toString()).not.toBe('EVLTENC1');
    // The account came back with it: signing in still works.
    await c.req('POST', '/api/auth/logout', {});
    expect((await c.req('POST', '/api/auth/login', { username: 'owner', password: 'correct horse battery' })).status).toBe(200);
  }, 60_000);

  it('exports can be sealed with a password, and only that password opens them on import', async () => {
    const ch = await setup();
    const ex = await c.req('GET', `/api/characters/${ch.id}/export?format=json`, undefined, { 'x-export-password': 'export pass 123' });
    expect(ex.status).toBe(200);
    expect(ex.headers['content-disposition']).toMatch(/\.json\.evlt"/);
    expect(ex.raw.subarray(0, 8).toString()).toBe('EVLTEXP1');
    expect(ex.raw.includes(SECRET)).toBe(false);
    expect((await c.req('POST', '/api/characters/import', ex.raw)).json.code).toBe('password_required');
    expect((await c.req('POST', '/api/characters/import', ex.raw, { 'x-import-password': 'nope nope' })).json.code).toBe('wrong_password');
    const im = await c.req('POST', '/api/characters/import', ex.raw, { 'x-import-password': 'export pass 123' });
    expect(im.status).toBe(200);
    expect((await c.req('GET', `/api/characters/${im.json.id ?? im.json.character?.id}`)).json.card.description).toBe(SECRET);
  }, 60_000);
});
