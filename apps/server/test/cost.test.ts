import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { settleBackground } from '../src/services/chronicle.js';
import { createClient, parseSse, waitFor } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockLlm>>;
beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());

const TURNS = 30;

/** Plays the same 30 turns under each cost preset and counts every model call by purpose. */
async function measure(profile: 'cheap' | 'balanced' | 'max') {
  const c = await createClient();
  try {
    await fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify({ reset: true }) });
    const conn = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 200, context_size: 8192 } });
    await c.req('PATCH', '/api/settings', { roles: { main: conn.json.id } });
    await c.req('PATCH', '/api/settings', { world: { profile } });
    await c.req('POST', '/api/personas', { name: 'Anala', isDefault: true });
    const ch = await c.req('POST', '/api/characters', { card: { name: 'Iris Thorne', first_mes: 'Iris wipes the counter.' } });
    const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id })).json;
    await c.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'location.upsert', name: 'The Lantern', kind: 'building' }, { type: 'location.move', to: 'The Lantern' }, { type: 'npc.upsert', name: 'Bram', location: 'The Lantern' }, { type: 'npc.upsert', name: 'Tobias Moreno', location: 'The Lantern' }, { type: 'location.upsert', name: 'Market Square', kind: 'district' }, { type: 'npc.upsert', name: 'Mira Vance', location: 'Market Square' }, { type: 'npc.upsert', name: 'Old Pell', location: 'Market Square' }] });
    const lines = ['I order a drink.', 'I ask Bram about the rain.', 'Who is Tobias?', 'I try to dance on the table.', 'I sit and listen.'];
    for (let turn = 1; turn <= TURNS; turn++) {
      const r = await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: `${lines[turn % lines.length]} (${turn})` });
      const done = parseSse(r.body).find((e) => e.type === 'done');
      await waitFor(async () => ((await c.req('GET', `/api/chats/${chat.id}/messages`)).json.find((m: any) => m.id === done.messageId)?.swipes[0]?.changes !== undefined ? true : null), 10000);
      await settleBackground(chat.id);
    }
    const rows = c.built.ctx.db.prepare("SELECT purpose, role, COUNT(*) AS n FROM llm_calls WHERE chat_id = ? OR chat_id IS NULL GROUP BY purpose, role").all(chat.id) as Array<{ purpose: string; role: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.purpose, r.n]));
  } finally {
    await c.close();
  }
}

it('model calls per turn, by preset', async () => {
  const out: Record<string, Record<string, number>> = {};
  for (const p of ['cheap', 'balanced', 'max'] as const) out[p] = await measure(p);
  const llm = (m: Record<string, number>) => Object.entries(m).filter(([k]) => !/embedding/.test(k)).reduce((n, [, v]) => n + v, 0);
  const emb = (m: Record<string, number>) => Object.entries(m).filter(([k]) => /embedding/.test(k)).reduce((n, [, v]) => n + v, 0);
  for (const p of ['cheap', 'balanced', 'max']) expect(out[p]!.reply, p).toBe(TURNS);
  expect(out.cheap!['pre-read'] ?? 0).toBe(0);
  expect(out.cheap!['off-screen life'] ?? 0).toBe(0);
  expect(emb(out.cheap!)).toBe(0);
  expect(out.max!['pre-read']).toBe(TURNS);
  expect(llm(out.cheap!)).toBeLessThan(llm(out.balanced!));
  expect(llm(out.balanced!)).toBeLessThan(llm(out.max!));
  // Written for docs/PHASE2_DECISIONS.md.
  const purposes = [...new Set(Object.values(out).flatMap((m) => Object.keys(m)))].sort();
  const table = [`| Call | ${Object.keys(out).join(' | ')} |`, `|---|${Object.keys(out).map(() => '---:').join('|')}|`, ...purposes.map((k) => `| ${k} | ${Object.values(out).map((m) => ((m[k] ?? 0) / TURNS).toFixed(2)).join(' | ')} |`), `| **LLM calls / turn** | ${Object.values(out).map((m) => `**${(llm(m) / TURNS).toFixed(2)}**`).join(' | ')} |`, `| embedding calls / turn | ${Object.values(out).map((m) => (emb(m) / TURNS).toFixed(2)).join(' | ')} |`].join('\n');
  writeFileSync(path.resolve(__dirname, '../../../tests/memory-bench/calls-per-preset.md'), `Measured over ${TURNS} turns with the mock model (apps/server/test/cost.test.ts).\n\n${table}\n`);
}, 240_000);
