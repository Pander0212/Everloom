/**
 * Name shield: real names never reach the provider, come back restored, and no code path can reach
 * an outside service without passing the choke point.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { settleBackground } from '../src/services/chronicle.js';
import { createClient, parseSse, type TestClient } from './helpers.js';

const SRC = path.resolve(__dirname, '../src');

describe('the choke point', () => {
  it('no server code talks to the network except through util/fetch.ts (shielded) or util/public-fetch.ts (no AI content)', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const full = path.join(dir, f);
        if (statSync(full).isDirectory()) walk(full);
        else if (f.endsWith('.ts')) {
          const rel = path.relative(SRC, full).replace(/\\/g, '/');
          if (['util/fetch.ts', 'util/public-fetch.ts', 'services/bridge-script.ts', 'services/bridge-extractors.ts'].includes(rel)) continue;
          const code = readFileSync(full, 'utf8');
          if (/(^|[^\w.])fetch\(|\bhttps?\.(request|get)\(|from 'undici'|new WebSocket\(/m.test(code)) offenders.push(rel);
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
  it('every provider request goes through safeFetch, which shields string bodies', () => {
    for (const f of ['llm/providers.ts', 'media/tts.ts', 'media/imagegen.ts']) {
      const code = readFileSync(path.join(SRC, f), 'utf8');
      expect(code, f).toMatch(/safeFetch\(/);
    }
    const fetchTs = readFileSync(path.join(SRC, 'util/fetch.ts'), 'utf8');
    expect(fetchTs).toMatch(/shieldOutbound\(opts\.body/);
    expect(readFileSync(path.join(SRC, 'llm/providers.ts'), 'utf8')).toMatch(/return shieldStream\(dispatchStream/);
  });
});

let mock: Awaited<ReturnType<typeof startMockLlm>>;
beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());
let c: TestClient;
beforeEach(async () => {
  c = await createClient();
  await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ reset: true }) });
  const conn = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 200, context_size: 8192 } });
  const emb = await c.req('POST', '/api/connections', { name: 'Embed', provider: 'openai', baseUrl: mock.url, model: 'mock-embed', kind: 'embeddings' });
  await c.req('PATCH', '/api/settings', { roles: { main: conn.json.id, embeddings: emb.json.id }, world: { profile: 'max' } });
});
afterEach(async () => c?.close());

const bodies = async () => ((await (await fetch(mock.url.replace('/v1', '/__control'))).json()) as { calls: Array<{ body: unknown }> }).calls.map((x) => JSON.stringify(x.body));

describe('name shield', () => {
  it('real names never reach the provider; replies come back with the real names, streamed and stored', async () => {
    await c.req('PATCH', '/api/settings', {
      privacy: {
        shield: {
          enabled: true,
          terms: [
            { real: 'Lena Brook', standin: 'Mira Hollis', kind: 'full', forms: ['Lenny'], scope: { type: 'all' } },
            { real: 'Brookfield', standin: 'Larkmoor', kind: 'place', forms: [], scope: { type: 'all' } },
          ],
        },
      },
    });
    await c.req('POST', '/api/personas', { name: 'Lena Brook', description: 'Lena grew up in Brookfield. Friends call her Lenny.', isDefault: true });
    const ch = (await c.req('POST', '/api/characters', { card: { name: 'Iris Thorne', description: "Iris is Lena's oldest friend from BROOKFIELD.", first_mes: 'Iris waves.' } })).json;
    const chat = (await c.req('POST', '/api/chats', { characterId: ch.id })).json;
    // The model answers using the stand-in, split across stream chunks.
    await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ story: 'Iris hugs Mira. "Mira Hollis! Back from Larkmoor at last, Mira?"' }) });
    for (let i = 0; i < 3; i++) {
      const r = await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: `Hi, it's Lena from Brookfield (${i}).` });
      const ev = parseSse(r.body);
      const streamed = ev.filter((e) => e.type === 'delta').map((e) => e.text).join('');
      expect(streamed).not.toMatch(/Mira|Hollis|Larkmoor/);
      expect(streamed).toContain('Lena Brook! Back from Brookfield at last, Lena?');
      await settleBackground(chat.id);
    }
    const sent = await bodies();
    expect(sent.length).toBeGreaterThan(6); // replies, tracker, pre-read, embeddings, background
    for (const b of sent) {
      expect(b).not.toMatch(/Lena|Brookfield|BROOKFIELD|Lenny/);
    }
    expect(sent.some((b) => b.includes('Mira Hollis'))).toBe(true);
    const msgs = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
    expect(msgs.at(-1).swipes[0].text).toContain('Lena Brook! Back from Brookfield');
    // The inspector shows both: as stored and as sent.
    const insp = (await c.req('GET', `/api/chats/${chat.id}/prompt`)).json;
    expect(JSON.stringify(insp.parts)).toContain('Brookfield');
    expect(JSON.stringify(insp.sentParts)).toContain('Larkmoor');
    expect(JSON.stringify(insp.sentParts)).not.toContain('Brookfield');
  }, 60_000);

  it('a stand-in that clashes with a name in the chat is replaced there, with a notice', async () => {
    await c.req('PATCH', '/api/settings', { privacy: { shield: { enabled: true, terms: [{ real: 'Lena Brook', standin: 'Iris Thorne', kind: 'full', forms: [], scope: { type: 'all' } }] } } });
    const ch = (await c.req('POST', '/api/characters', { card: { name: 'Iris Thorne', first_mes: 'Hello.' } })).json;
    const chat = (await c.req('POST', '/api/chats', { characterId: ch.id })).json;
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'I am Lena Brook.' });
    const meta = (await c.req('GET', `/api/chats/${chat.id}`)).json.metadata;
    const swap = Object.values(meta.shieldSwaps ?? {})[0] as string;
    expect(swap).toBeTruthy();
    expect(swap).not.toMatch(/Iris|Thorne/);
    const sent = await bodies();
    expect(sent.some((b) => b.includes(swap))).toBe(true);
    expect(sent.every((b) => !b.includes('Lena'))).toBe(true);
  }, 30_000);

  it('stand-ins: suggested by kind, never shared, previewable', async () => {
    const s = (await c.req('POST', '/api/privacy/standin', { kind: 'place', seed: 'Brookfield' })).json.standin;
    expect(s).toMatch(/^[A-Z]/);
    const saved = (await c.req('PATCH', '/api/settings', { privacy: { shield: { enabled: true, terms: [{ real: 'Ann', standin: 'Mira', kind: 'first' }, { real: 'Bea', standin: 'Mira', kind: 'first' }] } } })).json;
    const [a, b] = saved.privacy.shield.terms;
    expect(a.standin).toBe('Mira');
    expect(b.standin).not.toBe('Mira');
    const p = (await c.req('POST', '/api/privacy/preview', { text: "ANN's note to bea" })).json;
    expect(p.sent).toBe(`MIRA's note to ${b.standin.toLowerCase()}`);
    expect(p.restored).toBe("ANN's note to bea");
  });
});
