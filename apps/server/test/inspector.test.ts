import { afterEach, beforeEach, expect, it } from 'vitest';
import { recordUnresolved } from '../src/services/health.js';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient;
beforeEach(async () => {
  c = await createClient();
});
afterEach(async () => c?.close());

it('health check finds problems and fixes them with undoable ops; unknown names can be resolved', async () => {
  await c.req('POST', '/api/personas', { name: 'Anala', isDefault: true });
  const ch = await c.req('POST', '/api/characters', { card: { name: 'Iris', first_mes: 'Hi.' } });
  const chat = (await c.req('POST', '/api/chats', { characterId: ch.json.id })).json;
  const ops = (ops: object[]) => c.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops });
  await ops([
    { type: 'location.upsert', name: 'Mill' },
    { type: 'location.upsert', name: 'Ruin' },
    { type: 'npc.upsert', name: 'Bram', location: 'Ruin' },
    { type: 'quest.add', title: 'Tea', objectives: ['Brew'] },
    { type: 'quest.update', title: 'Tea', objective: 'Brew', done: true },
  ]);
  // Deleting a place already cleans references to it; a stale id can still arrive from old data.
  const st0 = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
  const bram0 = Object.values(st0.npcs).find((n: any) => n.name === 'Bram') as any;
  await ops([{ type: 'npc.set', id: bram0.id, patch: { locationId: 'loc_gone' } }]);
  let h = (await c.req('GET', `/api/chats/${chat.id}/health`)).json;
  const ids = h.issues.map((i: any) => i.id);
  expect(ids.some((i: string) => i.startsWith('npc-nowhere-'))).toBe(true);
  expect(ids.some((i: string) => i.startsWith('quest-'))).toBe(true);
  const fix = h.issues.find((i: any) => i.id.startsWith('npc-nowhere-'));
  h = (await c.req('POST', `/api/chats/${chat.id}/health/fix`, { id: fix.id })).json;
  expect(h.issues.some((i: any) => i.id === fix.id)).toBe(false);
  // The fix is a logged change that can be reverted.
  const tx = (await c.req('GET', `/api/chats/${chat.id}/transactions`)).json;
  expect(tx[0].source).toBe('user');
  await c.req('POST', `/api/chats/${chat.id}/transactions/${tx[0].id}/revert`);
  h = (await c.req('GET', `/api/chats/${chat.id}/health`)).json;
  expect(h.issues.some((i: any) => i.id === fix.id)).toBe(true);

  // Unknown names from rejected model ops.
  const owner = (c.built.ctx.db.prepare('SELECT id FROM users').get() as { id: string }).id;
  recordUnresolved(c.built.ctx, owner, chat.campaignId, [{ op: { type: 'npc.move' } as any, error: 'Unknown NPC "Brammy"' }, { op: { type: 'location.move' } as any, error: 'Unknown location "Old Pier"' }]);
  h = (await c.req('GET', `/api/chats/${chat.id}/health`)).json;
  expect(h.unresolved.map((u: any) => [u.name, u.kind])).toEqual(expect.arrayContaining([['Brammy', 'person'], ['Old Pier', 'place']]));
  const st = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
  const bram = Object.values(st.npcs).find((n: any) => n.name === 'Bram') as any;
  h = (await c.req('POST', `/api/chats/${chat.id}/unresolved`, { name: 'Brammy', action: 'alias', targetId: bram.id })).json;
  h = (await c.req('POST', `/api/chats/${chat.id}/unresolved`, { name: 'Old Pier', action: 'create', kind: 'place' })).json;
  expect(h.unresolved).toEqual([]);
  const st2 = (await c.req('GET', `/api/campaigns/${chat.campaignId}`)).json.state;
  expect(st2.npcs[bram.id].aliases).toContain('Brammy');
  expect(Object.values(st2.locations).map((l: any) => l.name)).toContain('Old Pier');
});
