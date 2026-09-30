import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { createClient, type TestClient } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockLlm>>;
let c: TestClient;
let connId: string;
beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());
beforeEach(async () => {
  c = await createClient();
  connId = (await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 300, context_size: 8192 } })).json.id;
});
afterEach(async () => c?.close());

const run = (request: object, extra: object = {}) => c.req('POST', '/api/studio/run', { request, ...extra });

describe('character studio', () => {
  it('brainstorms, writes a card, refines it, writes a field and revises a passage', async () => {
    const ideas = (await run({ mode: 'brainstorm', brief: 'a coastal mystery' })).json;
    expect(ideas.ideas).toHaveLength(5);
    const made = (await run({ mode: 'create', brief: ideas.ideas[0].pitch })).json;
    expect(made.card).toMatchObject({ name: 'Maren Holt', tags: ['mystery', 'coastal'] });
    const refined = (await run({ mode: 'refine', instruction: 'Make her warmer' }, { draft: made.card })).json;
    expect(refined.card).toEqual({ personality: 'Dry, patient, openly warm with strangers.' });
    expect((await run({ mode: 'field', field: 'tags' }, { draft: made.card })).json.value).toEqual(['lighthouse', 'mystery', 'slow burn']);
    expect((await run({ mode: 'field', field: 'scenario', instruction: 'at night' }, { draft: made.card })).json.value).toBe('Rewritten field text (at night).');
    expect((await run({ mode: 'revise', field: 'description', selection: 'She logs every ship that never arrives.', instruction: 'more ominous' }, { draft: made.card })).json.text).toBe('She records every vessel the sea keeps.');
    const calls = (await c.req('GET', '/api/calls?limit=20')).json;
    expect((calls.items ?? calls).filter((x: any) => /character studio/.test(x.purpose)).length).toBe(6);
  });

  it('uses the chosen connection and preset, and saved custom presets', async () => {
    // The mock answers as the studio only when the system prompt says so: a preset without those words proves it was used.
    await c.req('PATCH', '/api/settings', { studio: { presets: [{ id: 'mine', name: 'Mine', system: 'You are a character writer helping someone build a roleplay character card. HOUSE STYLE.' }, { id: 'off', name: 'Off-topic', system: 'Just chat.' }] } });
    expect((await run({ mode: 'brainstorm', brief: '' }, { preset: 'mine', connectionId: connId })).status).toBe(200);
    expect((await run({ mode: 'brainstorm', brief: '' }, { preset: 'off' })).status).toBe(502);
    await c.req('PATCH', '/api/settings', { studio: { preset: 'off' } });
    expect((await run({ mode: 'brainstorm', brief: '' })).status).toBe(502); // the saved default preset
    expect((await run({ mode: 'brainstorm', brief: '' }, { preset: 'balanced' })).status).toBe(200);
    // A deleted connection falls back to the main one instead of failing.
    expect((await run({ mode: 'brainstorm', brief: '' }, { preset: 'balanced', connectionId: 'gone' })).status).toBe(200);
    expect((await run({ mode: 'create', brief: 'x' })).status).toBe(400); // too short a brief
    expect((await run({ mode: 'revise', field: 'nope', selection: 'a', instruction: 'bb' })).status).toBe(400);
  });

  it('turns an unusable reply into a clear error', async () => {
    const r = await run({ mode: 'refine', instruction: 'Change nothing please' }, { draft: {}, system: 'Plain system prompt with no marker.' });
    expect(r.status).toBe(502);
  });
});
