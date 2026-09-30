import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetRateLimits, setSourceFetcher } from '../src/services/sources.js';
import { createClient, type TestClient } from './helpers.js';

const FX = path.resolve(__dirname, '../../../tests/fixtures/sources/chub');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let calls: Array<{ url: string; headers: Record<string, string> }> = [];
let version = 1;
const file = (f: string) => ({ status: 200, body: readFileSync(path.join(FX, f)) });

let c: TestClient;
beforeEach(async () => {
  calls = [];
  version = 1;
  resetRateLimits();
  // Recorded-style responses instead of the network: no test ever reaches chub.ai.
  setSourceFetcher(async (url, headers) => {
    calls.push({ url, headers });
    const u = new URL(url);
    if (u.hostname === 'avatars.charhub.io') return { status: 200, body: PNG };
    if (u.pathname === '/search') return file('search.json');
    const m = /^\/api\/characters\/([^/]+)\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const slug = decodeURIComponent(m[2]!);
      if (slug === 'maren-holt') return file(version === 1 ? 'maren-holt.json' : 'maren-holt.v2.json');
      if (slug === 'secret-sister') return file('secret-sister.json');
      if (slug === 'velvet-room') return file('velvet-room.json');
      return { status: 404, body: Buffer.from('{}') };
    }
    return { status: 404, body: Buffer.alloc(0) };
  });
  c = await createClient();
});
afterEach(async () => {
  setSourceFetcher(null);
  await c?.close();
});

const search = async (qs = '') => (await c.req('GET', `/api/sources/chub/search?q=lighthouse${qs}`)).json;

describe('online sources', () => {
  it('lists Chub; adult content is off by default and the server enforces it', async () => {
    expect((await c.req('GET', '/api/sources')).json).toMatchObject({ nsfwAllowed: false, providers: expect.arrayContaining([expect.objectContaining({ id: 'chub', name: 'Chub', hasToken: false })]) });
    const r = await search('&nsfw=1'); // asking isn't enough
    expect(r.nsfw).toBe(false);
    expect(r.items.map((i: any) => i.key)).not.toContain('nightowl/velvet-room');
    expect(new URL(calls[0]!.url).searchParams.get('nsfw')).toBe('false');
    expect((await c.req('GET', '/api/sources/chub/item?key=nightowl/velvet-room')).status).toBe(403);
    expect((await c.req('POST', '/api/sources/chub/import', { key: 'nightowl/velvet-room' })).status).toBe(403);
    await c.req('PATCH', '/api/settings', { library: { nsfw: true } });
    expect((await search('&nsfw=1')).items.map((i: any) => i.key)).toContain('nightowl/velvet-room');
  });

  it('caches responses and paces requests', async () => {
    await search();
    await search();
    expect(calls.filter((x) => x.url.includes('/search'))).toHaveLength(1);
    // Six uncached detail requests in a burst: the sixth waits for the bucket to refill.
    const t0 = Date.now();
    for (let i = 0; i < 6; i++) await c.req('GET', `/api/sources/chub/item?key=someone/nobody-${i}`);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(350);
  });

  it('imports with avatar and lorebook, links it, and shows "In library" afterwards', async () => {
    const ch = (await c.req('POST', '/api/sources/chub/import', { key: 'tidewriter/maren-holt' })).json;
    expect(ch).toMatchObject({ name: 'Maren Holt', linked: 'tidewriter/maren-holt' });
    expect(ch.avatar).toMatch(/^\/media\/m_/);
    expect(ch.hasLorebook).toBe(true);
    const r = await search();
    expect(r.items.find((i: any) => i.key === 'tidewriter/maren-holt').ownedId).toBe(ch.id);
    expect((await search('&hideOwned=1')).items.map((i: any) => i.key)).not.toContain('tidewriter/maren-holt');
    expect((await c.req('GET', '/api/sources/chub/item?key=tidewriter/maren-holt')).json.ownedId).toBe(ch.id);
  });

  it('imports only the public profile of a card whose creator hid the definition, labelled', async () => {
    const r = await c.req('POST', '/api/sources/chub/import', { key: 'quietmaker/secret-sister' });
    expect(r.status).toBe(200);
    expect(r.json.card).toMatchObject({ description: '', personality: '', scenario: '', first_mes: '', extensions: { definition_hidden: true } });
    // Nothing else was tried: the one public endpoint, and the public picture.
    expect(calls.map((x) => new URL(x.url).hostname + new URL(x.url).pathname).filter((u) => !u.startsWith('avatars.'))).toEqual(['api.chub.ai/api/characters/quietmaker/secret-sister']);
  });

  it('checks for updates with field-level diffs and applies chosen fields (keeping a version)', async () => {
    const ch = (await c.req('POST', '/api/sources/chub/import', { key: 'tidewriter/maren-holt' })).json;
    expect((await c.req('POST', '/api/sources/updates', {})).json).toEqual([expect.objectContaining({ characterId: ch.id, status: 'current', diffs: [] })]);
    version = 2;
    const [u] = (await c.req('POST', '/api/sources/updates', { ids: [ch.id] })).json;
    expect(u.status).toBe('update');
    expect(u.diffs.map((d: any) => d.key).sort()).toEqual(['alternate_greetings', 'personality']);
    const applied = (await c.req('POST', '/api/sources/updates/apply', { characterId: ch.id, fields: ['personality'] })).json;
    expect(applied.applied).toEqual(['personality']);
    const card = (await c.req('GET', `/api/characters/${ch.id}`)).json.card;
    expect(card.personality).toBe('Dry, patient, and warmer than she lets on.');
    expect(card.alternate_greetings).toHaveLength(1); // not chosen, not changed
    expect((await c.req('GET', `/api/characters/${ch.id}/versions`)).json.length).toBeGreaterThanOrEqual(1);
    const [again] = (await c.req('POST', '/api/sources/updates', { ids: [ch.id] })).json;
    expect(again.diffs.map((d: any) => d.key)).toEqual(['alternate_greetings']);
  });

  it('finds source links in unlinked cards, links and unlinks', async () => {
    const a = (await c.req('POST', '/api/characters', { card: { name: 'Maren', creator_notes: 'Original: https://chub.ai/characters/tidewriter/maren-holt' } })).json;
    await c.req('POST', '/api/characters', { card: { name: 'Plain' } });
    expect((await c.req('GET', '/api/sources/scan-links')).json).toEqual([{ characterId: a.id, name: 'Maren', provider: 'chub', key: 'tidewriter/maren-holt', url: 'https://chub.ai/characters/tidewriter/maren-holt' }]);
    await c.req('POST', '/api/sources/link', { characterId: a.id, provider: 'chub', key: 'tidewriter/maren-holt' });
    expect((await c.req('GET', '/api/sources/scan-links')).json).toEqual([]);
    const [u] = (await c.req('POST', '/api/sources/updates', {})).json;
    expect(u.status).toBe('update'); // the local card differs from the source
    await c.req('POST', '/api/sources/link', { characterId: a.id, provider: 'chub', key: null });
    expect((await c.req('POST', '/api/sources/updates', {})).json).toEqual([]);
  });

  it('stores the token encrypted, never returns it, and sends it only to the provider', async () => {
    await c.req('PUT', '/api/sources/chub/token', { token: 'secret-token-123' });
    expect((await c.req('GET', '/api/sources')).json.providers[0].hasToken).toBe(true);
    const row = c.built.ctx.db.prepare('SELECT token_enc FROM provider_accounts').get() as { token_enc: string };
    expect(row.token_enc).not.toContain('secret-token-123');
    await search();
    expect(calls[0]!.headers['CH-API-KEY']).toBe('secret-token-123');
    expect(JSON.stringify((await c.req('GET', '/api/sources')).json)).not.toContain('secret-token-123');
    await c.req('PUT', '/api/sources/chub/token', { token: null });
    expect((await c.req('GET', '/api/sources')).json.providers[0].hasToken).toBe(false);
  });
});

describe('source images', () => {
  it('proxies pictures only from the source\'s own hosts', async () => {
    const ok = await c.req('GET', `/api/sources/chub/image?url=${encodeURIComponent('https://avatars.charhub.io/avatars/tidewriter/maren-holt/avatar.webp')}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    for (const bad of ['https://evil.example/x.png', 'http://avatars.charhub.io/x.png', 'http://127.0.0.1/x.png', 'not a url']) expect((await c.req('GET', `/api/sources/chub/image?url=${encodeURIComponent(bad)}`)).status, bad).toBe(400);
  });
});
