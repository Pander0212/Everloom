import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { sanitizeCss } from '../src/util/css.js';
import { createClient, type TestClient } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockLlm>>;
let c: TestClient;

beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());
beforeEach(async () => {
  c = await createClient();
});
afterEach(async () => c?.close());

describe('sanitizeCss', () => {
  it('removes imports and remote resources, keeps data: URLs and ordinary rules', () => {
    const out = sanitizeCss(`@import url("https://x.test/a.css");
@import 'b.css';
:root { --accent: #3b82f6; }
.a { background: url(https://x.test/t.png) no-repeat; }
.b { background-image: url( "//x.test/t.png" ); }
.c { background: url(data:image/png;base64,AAAA); }
.d { background-image: image-set("https://x.test/a.png" 1x); }
.e { behavior: url(x.htc); -moz-binding: url(x.xml#b); width: expression(alert(1)); }
@font-face { font-family: X; src: url(https://x.test/f.woff2); }`);
    expect(out).not.toMatch(/@import|x\.test|behavior|-moz-binding|expression/);
    expect(out).toContain('--accent: #3b82f6');
    expect(out).toContain('url(data:image/png;base64,AAAA)');
    expect(out).toContain('no-repeat');
  });
});

describe('custom CSS', () => {
  it('is sanitized when saved in settings, whoever wrote it', async () => {
    const r = await c.req('PATCH', '/api/settings', { css: { snippets: [{ id: 'a', name: 'Mine', css: '@import "https://x.test/a.css"; .ev-card { border-radius: 2px; background: url(https://x.test/p.png); }', enabled: true }] } });
    const s = r.json.css.snippets[0];
    expect(s).toMatchObject({ id: 'a', name: 'Mine', enabled: true });
    expect(s.css).not.toMatch(/import|x\.test/);
    expect(s.css).toContain('border-radius: 2px');
    // Order is kept, and the list is replaced as a whole (a removed snippet stays removed).
    await c.req('PATCH', '/api/settings', { css: { snippets: [{ id: 'b', name: 'Two', css: 'a{}', enabled: false }, { id: 'a', name: 'Mine', css: 'b{}', enabled: true }] } });
    await c.req('PATCH', '/api/settings', { css: { snippets: [{ id: 'a', name: 'Mine', css: 'b{}', enabled: true }] } });
    expect((await c.req('GET', '/api/settings')).json.css.snippets.map((x: any) => x.id)).toEqual(['a']);
  });

  it('the assistant writes and revises snippets through the utility model, and its output is sanitized and logged', async () => {
    expect((await c.req('POST', '/api/css/assist', { request: 'Bigger story text' })).status).toBe(400); // no connection yet
    const conn = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 300, context_size: 8192 } });
    await c.req('PATCH', '/api/settings', { roles: { main: conn.json.id } });
    const first = (await c.req('POST', '/api/css/assist', { request: 'Bigger, roomier story text' })).json;
    expect(first.name).toBe('Roomier story text');
    expect(first.css).toContain('--story-size: 19px');
    expect(first.css).not.toMatch(/@import|evil\.example/);
    const second = (await c.req('POST', '/api/css/assist', { request: 'Now make my bubbles green', current: first.css, history: [{ role: 'user', content: 'Bigger, roomier story text' }, { role: 'assistant', content: first.notes }] })).json;
    expect(second.css).toContain('--story-size: 19px'); // kept what was there
    expect(second.css).toContain('rgb(22, 128, 61)');
    const calls = (await c.req('GET', '/api/calls?limit=10')).json;
    expect((calls.items ?? calls).some((x: any) => x.purpose === 'css assistant')).toBe(true);
  });
});
