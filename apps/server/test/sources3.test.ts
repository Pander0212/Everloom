import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fixtureFetcher, resetRateLimits, setSourceFetcher } from '../src/services/sources.js';
import { createClient, FIXTURES, type TestClient } from './helpers.js';

const ROOT = path.join(FIXTURES, 'sources');
let calls: string[] = [];
let c: TestClient;

// A local "web" for import-from-link: a card PNG, a card JSON, an HTML page and a bot check.
let web: http.Server;
let base = '';
const CARD_JSON = JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Linked Lark', description: 'A lark from a link.', first_mes: 'Tweet.' } });
beforeAll(async () => {
  web = http.createServer((req, res) => {
    if (req.url === '/lark.json') return res.writeHead(200, { 'content-type': 'application/json' }).end(CARD_JSON);
    if (req.url === '/lark.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(readFileSync(path.join(FIXTURES, 'st', 'Seraphina.png')));
    if (req.url === '/page') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html><title>x</title></html>');
    if (req.url === '/guarded') return res.writeHead(403, { server: 'cloudflare', 'cf-ray': 'abc' }).end('Just a moment...');
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => web.close(() => r())));

beforeEach(async () => {
  calls = [];
  resetRateLimits();
  const fx = fixtureFetcher(ROOT);
  setSourceFetcher(async (url, headers, body) => {
    calls.push(url);
    return fx(url, headers, body);
  });
  c = await createClient();
  c.built.ctx.cfg.fetchPrivate = true; // the test web server is on localhost
});
afterEach(async () => {
  setSourceFetcher(null);
  await c?.close();
});

describe('more sources', () => {
  it('lists the capability matrix, with bridge-only and unsupported sites explained', async () => {
    const r = (await c.req('GET', '/api/sources')).json;
    expect(r.providers.map((p: any) => p.id)).toEqual(['chub', 'ctavern', 'risu', 'pygmalion', 'wyvern']);
    const cap = Object.fromEntries(r.capabilities.map((x: any) => [x.id, x.access]));
    expect(cap).toMatchObject({ chub: 'server', ctavern: 'server', risu: 'server', pygmalion: 'server', wyvern: 'server', botbooru: 'bridge', aicc: 'bridge', janitor: 'bridge', jannyai: 'bridge', datacat: 'bridge', saucepan: 'none', url: 'server' });
  });

  it.each([
    ['ctavern', 'librarian', 'quillwright/wren_of_the_lantern_archive', 'Wren'],
    ['risu', 'clock', '1f2e3d4c-0000-4000-8000-00000000a001', 'Sable'],
    ['pygmalion', 'map', '7a7a7a7a-1111-4222-8333-444455556666', 'Juniper'],
    ['wyvern', 'bees', '_fixtureWyvernOpen01', 'Bram the Beekeeper'],
  ])('%s: search hides adult cards, then imports with its picture and a link', async (provider, q, key, name) => {
    const s = (await c.req('GET', `/api/sources/${provider}/search?q=${q}`)).json;
    expect(s.items.some((i: any) => i.nsfw)).toBe(false);
    expect(s.items.map((i: any) => i.key)).toContain(key);
    const ch = await c.req('POST', `/api/sources/${provider}/import`, { key });
    expect(ch.status).toBe(200);
    expect(ch.json).toMatchObject({ name, linked: key });
    expect(ch.json.avatar).toMatch(/^\/media\//);
    expect((await c.req('POST', '/api/sources/updates', { ids: [ch.json.id] })).json[0].status).toBe('current');
  });

  it('a hidden RisuRealm card is never downloaded; its public profile comes in, labelled', async () => {
    const r = await c.req('POST', '/api/sources/risu/import', { key: '1f2e3d4c-0000-4000-8000-00000000a002' });
    expect(r.json.card.extensions.definition_hidden).toBe(true);
    expect(calls.some((u) => u.includes('/api/v1/download/'))).toBe(false);
  });

  it('Wyvern secret fields stay out', async () => {
    const r = await c.req('POST', '/api/sources/wyvern/import', { key: '_fixtureWyvernSecret2' });
    expect(r.json.card).toMatchObject({ description: '', personality: '', extensions: { definition_hidden: true } });
  });
});

describe('import from a link', () => {
  it('a provider page goes through that provider', async () => {
    const r = await c.req('POST', '/api/sources/import-url', { url: 'https://character-tavern.com/character/quillwright/wren_of_the_lantern_archive' });
    expect(r.json).toMatchObject({ via: 'Character Tavern', character: { name: 'Wren', linked: 'quillwright/wren_of_the_lantern_archive' } });
  });
  it('direct JSON and PNG card files import', async () => {
    expect((await c.req('POST', '/api/sources/import-url', { url: `${base}/lark.json` })).json.character.name).toBe('Linked Lark');
    const png = await c.req('POST', '/api/sources/import-url', { url: `${base}/lark.png` });
    expect(png.status).toBe(200);
    expect(png.json.character.avatar).toMatch(/^\/media\//);
  });
  it('bridge-only sites, bot checks and plain pages get a clear pointer, never a workaround', async () => {
    const j = await c.req('POST', '/api/sources/import-url', { url: 'https://janitorai.com/characters/1234-abcd' });
    expect(j.status).toBe(400);
    expect(j.json.error).toMatch(/Send to Everloom/);
    const g = await c.req('POST', '/api/sources/import-url', { url: `${base}/guarded` });
    expect(g.json.error).toMatch(/checks for a real browser/);
    expect((await c.req('POST', '/api/sources/import-url', { url: `${base}/page` })).json.error).toMatch(/isn't a card file/);
  });
});

describe('browser bridge', () => {
  const send = (token: string | null, body: object) =>
    c.built.app.inject({ method: 'POST', url: '/api/bridge/import', payload: JSON.stringify(body), headers: { 'content-type': 'application/json', origin: 'https://janitorai.com', ...(token ? { authorization: `Bearer ${token}` } : {}) } });

  it('a device token imports; a bad or revoked token is refused; only a hash is stored', async () => {
    const add = (await c.req('POST', '/api/bridge/devices', { label: 'Laptop' })).json;
    expect(add.token).toMatch(/^evb_/);
    const row = c.built.ctx.db.prepare('SELECT token_hash FROM bridge_devices').get() as { token_hash: string };
    expect(row.token_hash).not.toContain(add.token);
    const payload = { page: 'https://janitorai.com/characters/1234', site: 'janitor', card: { name: 'Bridged Bea', description: 'Public bio.', first_mes: 'Hi.' } };
    const ok = await send(add.token, payload);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('*');
    expect(JSON.parse(ok.body).name).toBe('Bridged Bea');
    expect((await send('evb_wrongwrongwrongwrongwrongwrong', payload)).statusCode).toBe(401);
    expect((await send(null, payload)).statusCode).toBe(401);
    const list = (await c.req('GET', '/api/bridge/devices')).json;
    expect(list.devices[0]).toMatchObject({ label: 'Laptop', lastUsedAt: expect.any(Number) });
    expect(list.bookmarklet).toMatch(/^javascript:/);
    await c.req('DELETE', `/api/bridge/devices/${add.device.id}`);
    expect((await send(add.token, payload)).statusCode).toBe(401);
  });

  it('CORS preflight is allowed without a session; the userscript is public and holds no secret', async () => {
    const pre = await c.built.app.inject({ method: 'OPTIONS', url: '/api/bridge/import', headers: { origin: 'https://janitorai.com', 'access-control-request-method': 'POST' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-headers']).toContain('authorization');
    const js = await c.built.app.inject({ method: 'GET', url: '/api/bridge/everloom-bridge.user.js', headers: { host: 'everloom.example:8443' } });
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain('// @match        https://janitorai.com/characters/*');
    expect(js.body).toContain('"http://everloom.example:8443"');
    expect(js.body).not.toMatch(/evb_[A-Za-z0-9_-]{20,}/);
  });

  it('a hidden card keeps only its public profile, whatever arrives; adult cards need the setting', async () => {
    const { token } = (await c.req('POST', '/api/bridge/devices', { label: 'Phone' })).json;
    const r = await send(token, { page: 'https://janitorai.com/characters/9', hidden: true, card: { name: 'Veiled', description: 'leaked?', personality: 'leaked?', first_mes: '', creator_notes: 'Public bio.' } });
    const ch = (await c.req('GET', `/api/characters/${JSON.parse(r.body).id}`)).json;
    expect(ch.card).toMatchObject({ description: '', personality: '', creator_notes: 'Public bio.', extensions: { definition_hidden: true, source_url: 'https://janitorai.com/characters/9' } });
    expect((await send(token, { page: 'https://janitorai.com/characters/10', nsfw: true, card: { name: 'Adult' } })).statusCode).toBe(403);
  });

  it('the bookmarklet hand-off imports with the signed-in session', async () => {
    const r = await c.req('POST', '/api/bridge/receive', { page: 'https://botbooru.com/post/1', file: { name: 'lark.json', data: Buffer.from(CARD_JSON).toString('base64') } });
    expect(r.json.name).toBe('Linked Lark');
  });
});
