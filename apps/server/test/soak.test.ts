import { afterAll, beforeAll, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { settleBackground } from '../src/services/chronicle.js';
import { zipSync } from 'fflate';
import { createClient, parseSse, waitFor } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockLlm>>;
beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());

/**
 * 60 turns of play with moves, checks, gossip and memory, and every 5 turns a swipe cycle (swipe,
 * swipe again, go back) that must fold back to exactly the same world and memory. Between cycles
 * the player shops, crafts, stores things at home, fights and rides the coach (user ops, which
 * survive swipes); the swiped-away takes carry Phase 3 ops (travel, battles, homes, shops, mail,
 * stage) that must vanish without a trace.
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
        { type: 'currency.delta', amount: 1000 },
        { type: 'shop.upsert', name: 'Lantern Bar', kind: 'general', npc: 'Bram', location: 'The Lantern', open: 0, close: 0 },
        { type: 'home.add', name: 'Back Room', kind: 'room', location: 'The Lantern' },
        { type: 'storage.add', home: 'Back Room', name: 'Chest', capacity: 50 },
        { type: 'room.add', home: 'Back Room', name: 'Kitchen', amenities: ['kitchen'] },
        { type: 'recipe.add', name: 'Flatbread', discipline: 'cooking', ingredients: [{ name: 'Flour', qty: 1 }], minutes: 20, result: { name: 'Flatbread', category: 'food' } },
        { type: 'transit.add', name: 'Square Coach', mode: 'caravan', stops: ['The Lantern', 'Market Square'], first: '00:00', last: '23:59', every: 30, hop: 10, fare: 1 },
      ],
    });
    // An extension with a custom op (the AI may use it) and a script allowed to propose changes.
    const manifest = { id: 'town-rep', name: 'Town rep', version: '1.0.0', permissions: ['state.ops'], entries: { ops: [{ name: 'change', label: 'Rep', params: { town: { type: 'string' }, amount: { type: 'integer', min: -20, max: 20 } }, steps: [{ do: 'add', path: '/towns/{town}', value: '{amount}' }], ai: true }] } };
    const prev = (await c.req('POST', '/api/extensions/preview', Buffer.from(zipSync({ 'everloom-extension.json': new TextEncoder().encode(JSON.stringify(manifest)) })))).json;
    expect((await c.req('POST', '/api/extensions/install', { token: prev.token })).status).toBe(200);
    const script = (await c.req('POST', '/api/scripts/library', { kind: 'script', data: { id: 'soak', name: 'Soak', code: '1', permissions: ['state.ops', 'variables'] } })).json;
    const scriptKey = `global::${script.id}`;
    const homeChest = async () => {
      const st = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
      return (Object.values(st.homes) as any[]).find((h) => h.name === 'Back Room').storage[0].id as string;
    };
    // The player's own actions between cycles: these stay through every swipe.
    const userActions: Array<() => Promise<unknown[]>> = [
      async () => [{ type: 'location.move', to: 'The Lantern' }, { type: 'shop.buy', shop: 'Lantern Bar', item: 'Torch', qty: 2 }, { type: 'shop.sell', shop: 'Lantern Bar', item: 'Torch', qty: 1 }],
      async () => [{ type: 'location.move', to: 'The Lantern' }, { type: 'item.add', name: 'Flour', qty: 1 }, { type: 'craft', recipe: 'Flatbread' }],
      async () => [{ type: 'location.move', to: 'The Lantern' }, { type: 'item.add', name: 'Old Map', qty: 1 }, { type: 'item.move', name: 'Old Map', to: await homeChest() }],
      async () => [{ type: 'battle.start', enemies: [{ name: 'Rat', level: 1, count: 1 }] }, { type: 'battle.action', action: 'defend' }, { type: 'battle.end' }],
      async () => [{ type: 'location.move', to: 'The Lantern' }, { type: 'transit.ticket', line: 'Square Coach', qty: 1 }, { type: 'transit.ride', line: 'Square Coach', to: 'Market Square' }],
    ];
    let userOk = 0;
    const snapshot = async () => {
      const st = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
      const mem = (await c.req('GET', `/api/chats/${chat.id}/memory`)).json;
      const msgVars = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json.map((m: any) => m.swipes[m.swipeId]?.vars ?? null);
      return JSON.stringify({ msgVars, st, items: mem.items.map((m: any) => [m.id, m.text, m.witnesses.map((w: any) => w.id), m.heardBy.map((h: any) => h.id)]), facts: mem.facts.map((f: any) => [f.id, f.status]) });
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
      if (turn % 5 === 2) {
        const ops = await userActions[Math.floor(turn / 5) % userActions.length]!();
        const r2 = await c.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops });
        expect(r2.json.errors, `user actions at turn ${turn}`).toEqual([]);
        userOk++;
      }
      if (turn % 5 !== 0) continue;
      const before = await snapshot();
      const sceneBefore = (await c.req('GET', `/api/chats/${chat.id}/scene`)).json.text as string;
      for (const [i, story] of ['A wolf howls somewhere far off.', 'Tobias Moreno bursts in, soaked.'].entries()) {
        // Each take writes its own memory and fact, which must vanish when the take is swiped away.
        await control({
          story,
          trackerOps: i === 0
            ? [{ type: 'ext.op', ext: 'town-rep', name: 'change', args: { town: `Town ${turn}`, amount: 3 } }, { type: 'travel', to: 'Market Square', mode: 'walk' }, { type: 'shop.upsert', name: `Stall ${turn}`, kind: 'general', location: 'Market Square' }, { type: 'mail.receive', from: 'Bram', subject: `Note ${turn}`, body: 'Come by later.' }, { type: 'fx.play', effect: 'shake' }]
            : [{ type: 'battle.start', enemies: [{ name: 'Wolf', level: 1, count: 1 }] }, { type: 'home.add', name: `Hideout ${turn}`, kind: 'cave' }, { type: 'stage.layer', character: 'Iris Thorne', position: 'right' }, { type: 'music.set', mood: 'tense' }],
          trackerMemories: [{ text: `A stranger left a sealed note numbered ${turn}-${i}.`, about: [], importance: 2 }], trackerFacts: [{ about: 'Bram', key: 'mood', value: `mood ${turn}-${i}`, text: `Bram grumbles in mood ${turn}-${i}`, changed: true }] });
        const sw = parseSse((await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'swipe' })).body).find((e) => e.type === 'done');
        await tracked(done.messageId, sw.swipeId);
        // A script reacts to this take: a game change and a message variable, both tied to the take.
        const sr = await c.req('POST', '/api/scripts/run/ops', { key: scriptKey, chatId: chat.id, ops: [{ type: 'ext.op', ext: 'town-rep', name: 'change', args: { town: 'Scripted', amount: 1 } }, { type: 'item.add', name: `Token ${turn}-${i}`, qty: 1 }] });
        expect(sr.json.errors, `script ops at turn ${turn}`).toEqual([]);
        await c.req('PATCH', `/api/messages/${done.messageId}/vars`, { set: { take: `${turn}-${i}`, hp: turn } });
        await new Promise((res) => setTimeout(res, 20));
        await settleBackground(chat.id);
        // The dice and the random event are replayed, not re-rolled.
        const sceneAfter = (await c.req('GET', `/api/chats/${chat.id}/scene`)).json.text as string;
        expect(sceneAfter.split('## THE DICE')[1]?.split('\n## ')[0]).toBe(sceneBefore.split('## THE DICE')[1]?.split('\n## ')[0]);
        expect(sceneAfter.split('## SOMETHING HAPPENS')[1]?.split('\n## ')[0]).toBe(sceneBefore.split('## SOMETHING HAPPENS')[1]?.split('\n## ')[0]);
      }
      await control({ trackerOps: null, trackerMemories: null, trackerFacts: null });
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
    expect(userOk).toBe(12);
    const st = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
    expect(Object.values(st.locations).length).toBeGreaterThanOrEqual(2);
    const mem = (await c.req('GET', `/api/chats/${chat.id}/memory`)).json;
    expect(mem.items.length).toBeGreaterThan(0);
  } finally {
    await c.close();
  }
}, 300_000);
