/**
 * Phase 4 sources: the shared filter language, the new sites (Character Tavern's page data,
 * Botbooru, Saucepan, AI Character Cards), RisuRealm's CHARX fallback, accounts, site notices,
 * back-off, cross-source search, saved searches, tag suggestions, thumbnails and the self-test.
 * Everything runs against the synthetic fixtures; nothing touches the network.
 */
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureFetcher, resetRateLimits, setSourceFetcher } from '../src/services/sources.js';
import { createClient, FIXTURES, type TestClient } from './helpers.js';

const ROOT = path.join(FIXTURES, 'sources');
let calls: Array<{ url: string; headers: Record<string, string>; body?: string }> = [];
let c: TestClient;
let override: ((url: string) => { status: number; body: Buffer; headers?: Record<string, string> } | null) | null = null;

beforeEach(async () => {
  calls = [];
  override = null;
  resetRateLimits();
  const fx = fixtureFetcher(ROOT);
  setSourceFetcher(async (url, headers, body) => {
    calls.push({ url, headers, body });
    return override?.(url) ?? fx(url, headers, body);
  });
  c = await createClient();
});
afterEach(async () => {
  setSourceFetcher(null);
  await c?.close();
});

const accept = (p: string) => c.req('POST', `/api/sources/${p}/notice`, {});

describe('the shared query', () => {
  it('filter syntax and filter-bar fields reach the site and the final check', async () => {
    const r = await c.req('GET', `/api/sources/ctavern/search?q=${encodeURIComponent('archive tag:fantasy -tag:pirate tokens<1000 sort:new has:lorebook')}`);
    expect(r.status).toBe(200);
    const u = new URL(calls.find((x) => x.url.includes('/search/cards/'))!.url);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ query: 'archive', sort: 'newest', tags: 'fantasy', exclude_tags: 'pirate', maximum_tokens: '999', hasLorebook: 'true' });
    // Adult cards are dropped whatever the site returned.
    expect(r.json.items.map((i: any) => i.key)).not.toContain('nightowl/velvet_lounge_host');
    expect(r.json.errors).toEqual([]);
  });

  it('reports filters the site cannot do as page-only, and unknown keys as errors', async () => {
    const r = (await c.req('GET', `/api/sources/ctavern/search?q=${encodeURIComponent('creator:quillwright bogus:1')}`)).json;
    expect(r.local).toContain('creator');
    expect(r.items.map((i: any) => i.creator)).toEqual(['quillwright']);
    expect(r.errors.join(' ')).toMatch(/bogus/);
  });
});

describe('Character Tavern (page data)', () => {
  it('searches, suggests tags, and imports with greetings and lorebook', async () => {
    expect((await c.req('GET', '/api/sources/ctavern/search')).json.items.map((i: any) => i.name)).toEqual(['Wren of the Lantern Archive', 'Captain Orla Vey']);
    expect((await c.req('GET', '/api/sources/ctavern/tags?q=li')).json).toEqual([{ tag: 'librarian', count: 12 }]);
    const ch = (await c.req('POST', '/api/sources/ctavern/import', { key: 'quillwright/wren_of_the_lantern_archive' })).json;
    expect(ch).toMatchObject({ name: 'Wren', linked: 'quillwright/wren_of_the_lantern_archive' });
    expect(ch.card.alternate_greetings).toHaveLength(2);
    expect(ch.card.description).toContain('Wren of the Lantern Archive');
  });
  it('a card that is not public keeps only its public profile', async () => {
    const ch = (await c.req('POST', '/api/sources/ctavern/import', { key: 'saltmarsh/captain_orla_vey' })).json;
    expect(ch.card).toMatchObject({ description: '', first_mes: '', extensions: { definition_hidden: true } });
  });
});

describe('Botbooru', () => {
  it('asks for the site notice once before fetching anything', async () => {
    const r = await c.req('GET', '/api/sources/botbooru/search');
    expect(r.status).toBe(428);
    expect(r.json.error).toMatch(/robots\.txt/);
    expect(calls).toHaveLength(0);
    const list = (await accept('botbooru')).json;
    expect(list.providers.find((p: any) => p.id === 'botbooru').noticeAccepted).toBe(true);
    const s = (await c.req('GET', '/api/sources/botbooru/search?tags=fantasy')).json;
    expect(s.items.map((i: any) => i.name)).toEqual(['Mossheart the Gardener']);
    expect(new URL(calls[0]!.url).searchParams.get('q')).toBe('fantasy');
    expect(new URL(calls[0]!.url).searchParams.get('sfw_only')).toBe('true');
  });
  it('imports with the lorebook converted, plain notes and the writer as creator', async () => {
    await accept('botbooru');
    const ch = (await c.req('POST', '/api/sources/botbooru/import', { key: '90001' })).json;
    expect(ch.card).toMatchObject({ creator: 'fernwright', creator_notes: 'Use **gently**.', alternate_greetings: ['"The roses are early this year."'] });
    const exported = (await c.req('GET', `/api/characters/${ch.id}/export?format=json`)).body;
    expect(exported).toContain('The greenhouse is older than the town.');
  });
  it('signs in with a password; the credential is never sent back; a wrong one is refused', async () => {
    await accept('botbooru');
    const bad = await c.req('POST', '/api/sources/botbooru/account', { username: 'tester', password: 'wrong' });
    expect(bad.status).toBe(401);
    const ok = await c.req('POST', '/api/sources/botbooru/account', { username: 'tester', password: 'right' });
    expect(ok.status).toBe(200);
    const text = JSON.stringify((await c.req('GET', '/api/sources')).json);
    expect(text).not.toContain('right');
    expect(text).not.toContain('fixture-session-token');
    expect(ok.json.providers.find((p: any) => p.id === 'botbooru').account).toMatchObject({ connected: true, username: 'tester', status: 'ok', remembersPassword: true });
    const row = c.built.ctx.db.prepare("SELECT token_enc, password_enc FROM provider_accounts WHERE provider = 'botbooru'").get() as { token_enc: string; password_enc: string };
    expect(row.token_enc).not.toContain('fixture-session-token');
    expect(row.password_enc).not.toContain('right');
    await c.req('GET', '/api/sources/botbooru/search?q=x');
    expect(calls.at(-1)!.headers.authorization).toBe('Bearer fixture-session-token');
    await c.req('DELETE', '/api/sources/botbooru/account');
    expect((await c.req('GET', '/api/sources')).json.providers.find((p: any) => p.id === 'botbooru').account.connected).toBe(false);
  });
});

describe('Saucepan', () => {
  it('browses signed out (text filtered on the page only); previews say an account is needed', async () => {
    await accept('saucepan');
    const s = (await c.req('GET', '/api/sources/saucepan/search?q=pip')).json;
    expect(s.local).toContain('text');
    expect(s.items.map((i: any) => i.name)).toEqual(['Pip the Cartographer']);
    expect(JSON.parse(calls[0]!.body!)).not.toHaveProperty('text_search');
    const d = (await c.req('GET', `/api/sources/saucepan/item?key=5a5a5a5a-0000-4000-8000-000000000001`)).json;
    expect(d).toMatchObject({ needsAccount: true, name: 'Pip the Cartographer' });
    const imp = await c.req('POST', '/api/sources/saucepan/import', { key: '5a5a5a5a-0000-4000-8000-000000000001' });
    expect(imp.status).toBe(401);
    expect(imp.json.error).toMatch(/Sign in/);
  });
  it('signed in: imports what the creator shares, and a hidden definition stays hidden', async () => {
    await accept('saucepan');
    await c.req('POST', '/api/sources/saucepan/account', { username: 'tester', password: 'right' });
    await c.req('GET', '/api/sources/saucepan/search?q=pip');
    expect(JSON.parse(calls.at(-1)!.body!).text_search).toBe('pip');
    const open = (await c.req('POST', '/api/sources/saucepan/import', { key: '5a5a5a5a-0000-4000-8000-000000000001' })).json;
    expect(open.card).toMatchObject({ first_mes: '"Need a map?"', alternate_greetings: ['"The coast moved again."'] });
    expect(open.card.description).toContain('maps of places');
    const hidden = (await c.req('POST', '/api/sources/saucepan/import', { key: '5a5a5a5a-0000-4000-8000-000000000002' })).json;
    expect(hidden.card).toMatchObject({ description: '', extensions: { definition_hidden: true } });
  });
});

describe('AI Character Cards', () => {
  it('sends tag ids and language; the final check makes tags "all of"', async () => {
    const res = await c.req('GET', `/api/sources/aicc/search?tags=${encodeURIComponent('Adventure/RPG,Slice of Life')}&lang=en`);
    const r = res.json;
    const u = new URL(calls.find((x) => x.url.includes('/api/cards?'))!.url);
    expect(u.searchParams.get('tags')).toBe('361,363');
    expect(u.searchParams.get('language')).toBe('en');
    expect(r.items.map((i: any) => i.name)).toEqual(['Juno the Ferrywoman']);
  });
  it('imports the current version of the card file', async () => {
    const ch = (await c.req('POST', '/api/sources/aicc/import', { key: '4001' })).json;
    expect(ch.card).toMatchObject({ name: 'Juno the Ferrywoman', first_mes: '"Two coins, and mind the oar."' });
    expect(calls.some((x) => x.url.endsWith('/old.png'))).toBe(false);
  });
});

describe('RisuRealm CHARX', () => {
  it('falls back to the CHARX download when the JSON one is refused, picture prefix and all', async () => {
    const ch = await c.req('POST', '/api/sources/risu/import', { key: '1f2e3d4c-0000-4000-8000-00000000a003' });
    expect(ch.status).toBe(200);
    expect(ch.json.card.description).toBe('{{char}} only travels zipped.');
    expect(calls.some((x) => x.url.includes('/download/charx-v3/'))).toBe(true);
  });
});

describe('pacing', () => {
  it('a 429 makes Everloom wait as long as the site asks before asking again', async () => {
    override = (url) => (url.includes('/search/cards/') ? { status: 429, body: Buffer.from(''), headers: { 'retry-after': '120' } } : null);
    const first = await c.req('GET', '/api/sources/ctavern/search');
    expect(first.status).toBe(429);
    expect(first.json.error).toMatch(/120 s/);
    const n = calls.length;
    override = null;
    const again = await c.req('GET', '/api/sources/ctavern/search?q=other');
    expect(again.status).toBe(429);
    expect(calls.length).toBe(n); // nothing was sent
  });
});

describe('searching everywhere, tags, saved searches, thumbnails', () => {
  it('one query across sites, with sites that failed reported', async () => {
    await accept('botbooru');
    const r = (await c.req('GET', '/api/sources/all/search?tags=fantasy')).json;
    const names = r.items.map((i: any) => i.name);
    expect(names).toEqual(expect.arrayContaining(['Wren of the Lantern Archive', 'Mossheart the Gardener']));
    expect(r.sites.find((s: any) => s.provider === 'saucepan')).toBeUndefined(); // notice not accepted: not asked
    expect(r.sites.every((s: any) => typeof s.ok === 'boolean')).toBe(true);
  });
  it('saved searches keep the query as text', async () => {
    const saved = (await c.req('POST', '/api/sources/saved', { provider: 'ctavern', name: 'Libraries', q: 'tag:librarian sort:new' })).json;
    expect(saved[0]).toMatchObject({ name: 'Libraries', provider: 'ctavern', query: 'tag:librarian sort:new' });
    expect((await c.req('DELETE', `/api/sources/saved/${saved[0].id}`)).json).toEqual([]);
  });
  it('thumbnails are resized on the server; other hosts are refused', async () => {
    const big = await (await import('sharp')).default({ create: { width: 900, height: 1200, channels: 3, background: '#335' } }).png().toBuffer();
    override = (url) => (url.startsWith('https://ct-cards.') ? { status: 200, body: big } : null);
    const r = await c.built.app.inject({ method: 'GET', url: `/api/sources/ctavern/image?w=256&url=${encodeURIComponent('https://ct-cards.storage.character-tavern.com/quillwright/wren_of_the_lantern_archive.png')}`, headers: { cookie: c.cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/webp');
    const meta = await (await import('sharp')).default(r.rawPayload).metadata();
    expect(meta.width).toBe(256);
    expect((await c.req('GET', `/api/sources/ctavern/image?url=${encodeURIComponent('https://evil.example/x.png')}`)).status).toBe(400);
  });
});

describe('diagnostics', () => {
  it('the self-test runs each step and says what it found', async () => {
    const r = (await c.req('POST', '/api/sources/ctavern/self-test', {})).json;
    expect(r.steps.map((s: any) => [s.step, s.ok])).toEqual([
      ['search', true],
      ['tags', true],
      ['filter', true],
      ['detail', true],
    ]);
  });
  it('a site answering in a new shape is reported as "site changed"', async () => {
    override = (url) => (url.includes('/search/cards/') ? { status: 200, body: Buffer.from('{"type":"data","nodes":[{"type":"data","data":[{"searchResults":1},{"hits":2},"oops"]}]}') } : null);
    const r = await c.req('GET', '/api/sources/ctavern/search');
    expect(r.status).toBe(502);
    expect(r.json.error).toMatch(/doesn't recognise.*record fixtures/s);
  });
  it('recorded fixtures replay through the fixture reader, signed out', async () => {
    await accept('botbooru');
    await c.req('POST', '/api/sources/botbooru/account', { username: 'tester', password: 'right' });
    const r = await c.req('POST', '/api/sources/botbooru/record-fixtures', {});
    expect(r.status).toBe(200);
    const files = unzipSync(new Uint8Array(r.raw));
    const routes = JSON.parse(strFromU8(files['botbooru/routes.json']!)).routes;
    expect(routes.length).toBeGreaterThanOrEqual(3);
    expect(strFromU8(files['README.txt']!)).toMatch(/don't publish/);
    // Recorded signed out: no credential in any request or file.
    expect(calls.filter((x) => x.url.includes('/posts/')).at(-1)!.headers.authorization).toBeUndefined();
    for (const f of Object.values(files)) expect(strFromU8(f)).not.toContain('fixture-session-token');
  });
});
