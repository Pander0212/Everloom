/**
 * The browser bridge's page readers, run against recorded page fixtures (tests/fixtures/bridge), and
 * the pairing flow. The readers are the exact code the userscript and bookmarklet carry.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXTRACTORS_JS } from '../src/services/bridge-extractors.js';
import { bookmarklet, userscript } from '../src/services/bridge-script.js';
import { createClient, FIXTURES, type TestClient } from './helpers.js';

interface PageFixture {
  url: string;
  meta: Record<string, string>;
  links?: string[];
  title?: string;
  h1?: string;
  responses: Record<string, { text?: string; bytes?: string }>;
  expect: Record<string, any>;
}

const DIR = path.join(FIXTURES, 'bridge');
const api = new Function(`${EXTRACTORS_JS}; return { everloomExtract, everloomCharacterLinks };`)() as {
  everloomExtract: (v: unknown) => Promise<any>;
  everloomCharacterLinks: (v: unknown) => string[];
};

function viewOf(f: PageFixture, requested: string[]) {
  return {
    url: f.url,
    meta: (p: string) => f.meta[p] ?? '',
    title: () => f.title ?? '',
    h1: () => f.h1 ?? '',
    links: () => f.links ?? [],
    json: () => null,
    getText: async (u: string) => {
      const abs = new URL(u, f.url).href;
      requested.push(abs);
      return f.responses[abs]?.text ?? null;
    },
    getBytes: async (u: string) => {
      const abs = new URL(u, f.url).href;
      requested.push(abs);
      return f.responses[abs]?.bytes ?? null;
    },
  };
}

describe('bridge page readers', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'listing.json');
  it.each(files)('%s', async (file) => {
    const f = JSON.parse(readFileSync(path.join(DIR, file), 'utf8')) as PageFixture;
    const requested: string[] = [];
    const p = await api.everloomExtract(viewOf(f, requested));
    const e = f.expect;
    expect(p.page).toBe(f.url);
    expect(p.site).toBe(e.site);
    if (e.file) {
      expect(p.file.data.length).toBeGreaterThan(100);
      if (e.fileName) expect(p.file.name).toBe(e.fileName);
    }
    if ('hidden' in e) expect(!!p.hidden).toBe(e.hidden);
    if (e.card) expect(p.card).toMatchObject(e.card);
    if (e.hasAvatar) expect(p.avatar).toBeTruthy();
    if (e.avatarUrl) expect(p.avatarUrl).toBe(e.avatarUrl);
    if (e.notContains) expect(JSON.stringify(p)).not.toContain(e.notContains);
    // Readers only ask for what the page itself would load: never a different site's API.
    for (const u of requested) expect(['janitorai.com', 'ella.janitorai.com', 'botbooru.com', 'api.aicharactercards.com', 'avatars.charhub.io', 'realm.risuai.net', 'cards.example', 'cdn.example']).toContain(new URL(u).hostname);
  });

  it('"Send all" finds each character on a listing once, on that site only', () => {
    const f = JSON.parse(readFileSync(path.join(DIR, 'listing.json'), 'utf8')) as PageFixture;
    expect(api.everloomCharacterLinks(viewOf(f, []))).toEqual(f.expect.links);
  });

  it('the scripts carry the readers and no secret', () => {
    const us = userscript('https://everloom.example');
    expect(us).toContain('function everloomExtract');
    expect(us).toContain('// @match        https://botbooru.com/*');
    expect(us).toContain('history[k] = function'); // follows single-page navigation
    expect(us).not.toMatch(/evb_[A-Za-z0-9_-]{20,}/);
    const bm = decodeURIComponent(bookmarklet('https://everloom.example').slice('javascript:'.length));
    // The window opens straight from the click, before anything is awaited.
    expect(bm.indexOf('window.open(')).toBeLessThan(bm.indexOf('everloomExtract(everloomView'));
    expect(bm).toContain('navigator.clipboard');
    // Both parse as JavaScript.
    expect(() => new Function(us)).not.toThrow();
    expect(() => new Function(bm)).not.toThrow();
  });
});

describe('install and pair', () => {
  let c: TestClient;
  beforeEach(async () => {
    c = await createClient();
  });
  afterEach(async () => c?.close());

  it('a pairing link carries a one-time code the script trades for its own device token', async () => {
    const p = (await c.req('POST', '/api/bridge/pairing', { label: 'Laptop' })).json;
    expect(p.userscriptUrl).toContain('/api/bridge/everloom-bridge.user.js?pair=evp_');
    const js = await c.built.app.inject({ method: 'GET', url: new URL(p.userscriptUrl).pathname + new URL(p.userscriptUrl).search });
    expect(js.body).toContain(JSON.stringify(p.code));
    const pair = (code: string) => c.built.app.inject({ method: 'POST', url: '/api/bridge/pair', payload: { code }, headers: { origin: 'https://janitorai.com' } });
    const first = await pair(p.code);
    expect(first.statusCode).toBe(200);
    const token = JSON.parse(first.body).token as string;
    expect(token).toMatch(/^evb_/);
    expect((await pair(p.code)).statusCode).toBe(401); // used once
    const ping = await c.built.app.inject({ method: 'POST', url: '/api/bridge/ping', payload: {}, headers: { authorization: `Bearer ${token}` } });
    expect(JSON.parse(ping.body)).toMatchObject({ ok: true });
    expect((await c.req('GET', '/api/bridge/devices')).json.devices.map((d: any) => d.label)).toEqual(['Laptop']);
  });
});
