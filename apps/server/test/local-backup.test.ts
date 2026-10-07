/** backup.sh's way in: a loopback route with the token from the data folder, which makes the same backup the app does. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { localTokenPath } from '../src/routes/local.js';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient;
afterEach(async () => c?.close());

describe('host backups (backup.sh)', () => {
  it('needs the token from the data folder, and makes the usual backup zip', async () => {
    c = await createClient();
    await c.req('POST', '/api/characters', { card: { name: 'Keeper' } });
    const file = localTokenPath(c.dataDir);
    expect(existsSync(file)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o077).toBe(0);
    const token = readFileSync(file, 'utf8');
    const anon = await c.built.app.inject({ method: 'POST', url: '/api/local/backup' });
    expect(anon.statusCode).toBe(403);
    const wrong = await c.built.app.inject({ method: 'POST', url: '/api/local/backup', headers: { 'x-control-token': token.replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a')) } });
    expect(wrong.statusCode).toBe(403);
    const r = await c.built.app.inject({ method: 'POST', url: '/api/local/backup', headers: { 'x-control-token': token } });
    expect(r.statusCode).toBe(200);
    const { name } = r.json();
    expect(name).toMatch(/^everloom-\d{8}-\d{6}-host\.zip$/);
    const zip = unzipSync(readFileSync(path.join(c.dataDir, 'backups', name)));
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(['everloom.db', 'manifest.json']));
  });

  it('works with the vault locked: the encrypted database is copied as it is, with its key file', async () => {
    c = await createClient();
    await c.req('POST', '/api/vault/enable', { passphrase: 'correct horse battery staple' });
    await c.req('POST', '/api/vault/lock', {});
    const token = readFileSync(localTokenPath(c.dataDir), 'utf8');
    const r = await c.built.app.inject({ method: 'POST', url: '/api/local/backup', headers: { 'x-control-token': token } });
    expect(r.statusCode).toBe(200);
    const zip = unzipSync(readFileSync(path.join(c.dataDir, 'backups', r.json().name)));
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(['everloom.db', 'vault.json', 'system.db']));
    // Encrypted: not a plain SQLite file.
    expect(Buffer.from(zip['everloom.db']!).subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3');
    expect(JSON.parse(new TextDecoder().decode(zip['manifest.json']!))).toMatchObject({ encrypted: true });
  });
});
