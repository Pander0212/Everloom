import { afterEach, expect, it } from 'vitest';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

it('a card’s questions fill the new chat’s greeting and prompt, never the card', async () => {
  c = await createClient();
  const ch = (await c.req('POST', '/api/characters', { card: { name: 'Sela', description: 'Captain of ${Your ship? | options: Gull, Wren}.', first_mes: 'Welcome aboard the ${Your ship?}, ${What is your name?}.' } })).json;
  const answers = { 'your ship?': 'Gull', 'what is your name?': 'Ana' };
  const chat = (await c.req('POST', '/api/chats', { characterId: ch.id, features: 'classic', answers })).json;
  const msgs = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
  expect(msgs[0].swipes[0].text).toBe('Welcome aboard the Gull, Ana.');
  const card = (await c.req('GET', `/api/characters/${ch.id}`)).json.card;
  expect(card.first_mes).toContain('${Your ship?}');
  const prompt = (await c.req('POST', `/api/chats/${chat.id}/prompt/preview`, {})).body;
  expect(prompt).toContain('Captain of Gull.');
}, 30000);

it('a scenario starts a story with its own copy, and editing it later changes nothing there', async () => {
  c = await createClient();
  const ch = (await c.req('POST', '/api/characters', { card: { name: 'Iris', first_mes: 'Hello.' } })).json;
  const s = (await c.req('POST', '/api/scenarios', { title: 'Opera heist', opening: 'Rain hammers the opera steps, ${Your alias?}.', instructions: 'A fair mystery.', plot: 'The diva is the thief.', note: 'Keep it tense.', characterId: ch.id, mode: 'story', cards: [{ type: 'place', title: 'The Opera', keys: ['opera'], content: 'Gilded and leaking.' }], game: { currency: { name: 'Lira', symbol: 'L', amount: 7 } } })).json;
  expect(s.id).toMatch(/^sc_/);
  expect((await c.req('POST', '/api/scenarios', { opening: 'no title' })).status).toBe(400);
  const chat = (await c.req('POST', `/api/scenarios/${s.id}/start`, { answers: { 'your alias?': 'Magpie' } })).json;
  const msgs = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json;
  expect(msgs.map((m: any) => m.swipes[0].text)).toEqual(['Rain hammers the opera steps, Magpie.']);
  expect(chat.metadata.authorsNote.content).toBe('Keep it tense.');
  expect(chat.metadata.scenario.plot).toBe('The diva is the thief.');
  const books = (await c.req('GET', '/api/lorebooks')).json.filter((b: any) => b.scope === 'chat' && b.scopeId === chat.id);
  expect(Object.values(books[0].book.entries).map((e: any) => e.comment)).toEqual(['The Opera']);
  const camp = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json;
  expect(camp.state.player.currency).toBe(7);
  // Edit the scenario: the story keeps its copy.
  await c.req('PUT', `/api/scenarios/${s.id}`, { ...s, note: 'Make it a comedy.', cards: [] });
  const again = (await c.req('GET', `/api/chats/${chat.id}`)).json;
  expect(again.metadata.authorsNote.content).toBe('Keep it tense.');
  expect((await c.req('GET', '/api/lorebooks')).json.some((b: any) => b.scopeId === chat.id)).toBe(true);
}, 30000);
