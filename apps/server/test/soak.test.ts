import { afterAll, beforeAll, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { settleBackground } from '../src/services/chronicle.js';
import { createClient, parseSse, waitFor } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockLlm>>;
beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());

/**
 * 60 turns of play with moves, checks, gossip and memory, and every 5 turns a swipe cycle (swipe,
 * swipe again, go back) that must fold back to exactly the same world and memory.
 */
it('soak: swipe cycles fold back to identical state and memory over 60 turns', async () => {
  const c = await createClient();
  const control = (b: object) => fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify(b) });
  try {
    await control({ reset: true });
    const conn = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 200, context_size: 8192 } });
    await c.req('PATCH', '/api/settings', { roles: { main: conn.json.id }, world: { chronicleEvery: 7, consolidateEvery: 4 } });
    await c.req('POST', '/api/personas', { name: 'Anala', isDefault: true });
    const ch = await c.req('POST', '/api/characters', { card: { name: 'Iris Thorne', first_mes: 'Iris wipes the counter.' } });
    const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id })).json;
    await c.req('POST', `/api/campaigns/${chat.campaignId}/ops`, {
      chatId: chat.id,
      ops: [
        { type: 'location.upsert', name: 'The Lantern', kind: 'building' },
        { type: 'location.upsert', name: 'Market Square', kind: 'district' },
        { type: 'route.add', from: 'The Lantern', to: 'Market Square' },
        { type: 'location.move', to: 'The Lantern' },
        { type: 'npc.upsert', name: 'Bram', location: 'The Lantern' },
        { type: 'thread.add', text: 'The missing ferryman', pace: 0.3 },
      ],
    });
    const snapshot = async () => {
      const st = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
      const mem = (await c.req('GET', `/api/chats/${chat.id}/memory`)).json;
      return JSON.stringify({ st, items: mem.items.map((m: any) => [m.id, m.text, m.witnesses.map((w: any) => w.id), m.heardBy.map((h: any) => h.id)]), facts: mem.facts.map((f: any) => [f.id, f.status]) });
    };
    const tracked = async (messageId: string, swipeId: number) =>
      waitFor(async () => {
        const msgs = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
        const m = msgs.find((x: any) => x.id === messageId);
        return m && m.swipeId === swipeId && m.swipes[swipeId]?.changes !== undefined ? m : null;
      }, 10000);
    const lines = ['I head to Market Square.', 'I try to sneak past the guard.', 'I go to The Lantern.', 'Who is Tobias?', 'I try to persuade Bram to help.', 'I sit and listen to the rain.'];
    const stories = ['Tobias Moreno waves from the door. "The Ravens need a singer by Friday," he says.', 'Iris slides over an iced lemon tea.', 'Bram grumbles about the weather.', 'Rain taps on the glass while Iris hums.'];
    let cycles = 0;
    for (let turn = 1; turn <= 60; turn++) {
      await control({ story: stories[turn % stories.length] });
      const r = await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: `${lines[turn % lines.length]} (${turn})` });
      const done = parseSse(r.body).find((e) => e.type === 'done');
      expect(done, `turn ${turn}`).toBeTruthy();
      await tracked(done.messageId, 0);
      await new Promise((res) => setTimeout(res, 20));
        await settleBackground(chat.id);
      if (turn % 5 !== 0) continue;
      const before = await snapshot();
      const sceneBefore = (await c.req('GET', `/api/chats/${chat.id}/scene`)).json.text as string;
      for (const [i, story] of ['A wolf howls somewhere far off.', 'Tobias Moreno bursts in, soaked.'].entries()) {
        // Each take writes its own memory and fact, which must vanish when the take is swiped away.
        await control({ story, trackerMemories: [{ text: `A stranger left a sealed note numbered ${turn}-${i}.`, about: [], importance: 2 }], trackerFacts: [{ about: 'Bram', key: 'mood', value: `mood ${turn}-${i}`, text: `Bram grumbles in mood ${turn}-${i}`, changed: true }] });
        const sw = parseSse((await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'swipe' })).body).find((e) => e.type === 'done');
        await tracked(done.messageId, sw.swipeId);
        await new Promise((res) => setTimeout(res, 20));
        await settleBackground(chat.id);
        // The dice and the random event are replayed, not re-rolled.
        const sceneAfter = (await c.req('GET', `/api/chats/${chat.id}/scene`)).json.text as string;
        expect(sceneAfter.split('## THE DICE')[1]?.split('\n## ')[0]).toBe(sceneBefore.split('## THE DICE')[1]?.split('\n## ')[0]);
        expect(sceneAfter.split('## SOMETHING HAPPENS')[1]?.split('\n## ')[0]).toBe(sceneBefore.split('## SOMETHING HAPPENS')[1]?.split('\n## ')[0]);
      }
      await control({ trackerMemories: null, trackerFacts: null });
      await c.req('POST', `/api/messages/${done.messageId}/swipe`, { swipeId: 0 });
      const after = await snapshot();
      if (after !== before && process.env.SOAK_DUMP) {
        const fs = await import('node:fs');
        fs.writeFileSync(`${process.env.SOAK_DUMP}/before.json`, JSON.stringify(JSON.parse(before), null, 1));
        fs.writeFileSync(`${process.env.SOAK_DUMP}/after.json`, JSON.stringify(JSON.parse(after), null, 1));
      }
      expect(after, `swipe cycle at turn ${turn}`).toBe(before);
      cycles++;
    }
    expect(cycles).toBe(12);
    const st = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
    expect(Object.values(st.locations).length).toBeGreaterThanOrEqual(2);
    const mem = (await c.req('GET', `/api/chats/${chat.id}/memory`)).json;
    expect(mem.items.length).toBeGreaterThan(0);
  } finally {
    await c.close();
  }
}, 300_000);
