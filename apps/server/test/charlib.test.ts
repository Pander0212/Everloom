import { strToU8, unzipSync, zipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClient, FIXTURES, type TestClient } from './helpers.js';

let c: TestClient;
beforeEach(async () => {
  c = await createClient();
});
afterEach(async () => c?.close());

const make = async (card: object) => (await c.req('POST', '/api/characters', { card })).json;
const list = async () => (await c.req('GET', '/api/characters')).json as any[];
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('library metadata', () => {
  it('keeps creator, token count, content hash and flags in the summary', async () => {
    const a = await make({ name: 'Iris', description: 'A quiet bartender who keeps a ledger of favors.', creator: 'John', alternate_greetings: ['Hi.'], tags: ['modern'] });
    const s = (await list()).find((x) => x.id === a.id);
    expect(s).toMatchObject({ creator: 'John', hasGreetings: true, hasLorebook: false, hasGallery: false, linked: null, displayName: null, collections: [] });
    expect(s.tokens).toBeGreaterThan(5);
    expect(s.hash).toBeTruthy();
    await c.req('PATCH', `/api/characters/${a.id}`, { displayName: 'Boss' });
    expect((await list())[0].displayName).toBe('Boss');
    expect((await c.req('GET', `/api/characters/${a.id}`)).json.card.name).toBe('Iris'); // the card is untouched
  });
});

describe('versions', () => {
  it('snapshots before every save, diffs by field, restores (itself undoable), and prunes to the retention', async () => {
    const a = await make({ name: 'Iris', description: 'A quiet bartender.' });
    await c.req('PATCH', `/api/characters/${a.id}`, { card: { description: 'A loud bartender.' } });
    await c.req('PATCH', `/api/characters/${a.id}`, { card: { description: 'A loud bartender and singer.', personality: 'Bold.' } });
    let v = (await c.req('GET', `/api/characters/${a.id}/versions`)).json;
    expect(v.map((x: any) => x.kind)).toEqual(['auto', 'auto']);
    const first = v[1];
    const diff = (await c.req('GET', `/api/characters/${a.id}/versions/${first.id}/diff`)).json;
    expect(diff.map((d: any) => d.key)).toEqual(['description', 'personality']);
    expect(diff[0].words.filter((w: any) => w.op === 'del').map((w: any) => w.text.trim())).toContain('quiet');
    expect(diff[0].words.filter((w: any) => w.op === 'add').map((w: any) => w.text.trim())).toContain('loud');
    const r = (await c.req('POST', `/api/characters/${a.id}/versions/${first.id}/restore`)).json;
    expect(r.card.description).toBe('A quiet bartender.');
    v = (await c.req('GET', `/api/characters/${a.id}/versions`)).json;
    expect(v[0].kind).toBe('restore');
    // Manual snapshots survive pruning.
    await c.req('POST', `/api/characters/${a.id}/versions`, { label: 'Before the rewrite' });
    await c.req('PATCH', '/api/settings', { library: { versionRetention: 2 } });
    for (let i = 0; i < 5; i++) await c.req('PATCH', `/api/characters/${a.id}`, { card: { description: `Take ${i}` } });
    v = (await c.req('GET', `/api/characters/${a.id}/versions`)).json;
    expect(v.filter((x: any) => x.kind !== 'manual')).toHaveLength(2);
    expect(v.find((x: any) => x.kind === 'manual').label).toBe('Before the rewrite');
  });
});

describe('batch actions, collections, duplicates, related', () => {
  it('tags, favorites and deletes many at once; a delete can be undone exactly', async () => {
    const a = await make({ name: 'A', tags: ['x'] });
    const b = await make({ name: 'B', tags: ['X', 'y'] });
    await c.req('POST', '/api/library/batch', { ids: [a.id, b.id], action: { action: 'tag', tags: ['fantasy', 'x'] } });
    let l = await list();
    expect(l.find((x) => x.id === a.id).tags).toEqual(['x', 'fantasy']);
    expect(l.find((x) => x.id === b.id).tags).toEqual(['X', 'y', 'fantasy']);
    await c.req('POST', '/api/library/batch', { ids: [a.id, b.id], action: { action: 'untag', tags: ['X'] } });
    await c.req('POST', '/api/library/batch', { ids: [a.id], action: { action: 'fav', value: true } });
    l = await list();
    expect(l.find((x) => x.id === b.id).tags).toEqual(['y', 'fantasy']);
    expect(l.find((x) => x.id === a.id).fav).toBe(true);
    const col = (await c.req('POST', '/api/library/collections', { name: 'Backlog', icon: 'star', color: 'violet' })).json;
    await c.req('POST', '/api/library/batch', { ids: [b.id, a.id], action: { action: 'collect', collectionId: col.id } });
    expect((await c.req('GET', '/api/library/collections')).json[0].characterIds).toEqual([b.id, a.id]);
    await c.req('POST', `/api/library/collections/${col.id}/items`, { order: [a.id, b.id] });
    expect((await c.req('GET', '/api/library/collections')).json[0].characterIds).toEqual([a.id, b.id]);
    const before = JSON.stringify(await list());
    const del = (await c.req('POST', '/api/library/batch', { ids: [a.id, b.id], action: { action: 'delete' } })).json;
    expect(await list()).toEqual([]);
    await c.req('POST', `/api/library/undo/${del.undoId}`);
    expect(JSON.stringify(await list())).toBe(before);
    // A single delete is undoable too.
    const one = (await c.req('DELETE', `/api/characters/${a.id}`)).json;
    expect(one.undoId).toBeTruthy();
  });

  it('finds duplicates and merges them, moving chats to the one kept', async () => {
    const a = await make({ name: 'Seraphina', description: 'Guardian of the forest glade, a gentle healer.' });
    const b = await make({ name: 'Seraphina', description: 'Guardian of the forest glade, a gentle healer.' });
    await make({ name: 'Kael', description: 'A rogue.' });
    await c.req('POST', '/api/chats', { characterId: b.id });
    const d = (await c.req('GET', '/api/library/duplicates')).json;
    expect(d).toHaveLength(1);
    expect(d[0].reason).toBe('identical');
    const m = (await c.req('POST', '/api/library/duplicates/merge', { keep: a.id, remove: [b.id] })).json;
    expect(m.moved).toBe(1);
    expect((await list()).map((x) => x.id).sort()).toEqual([a.id, (await list()).find((x) => x.name === 'Kael').id].sort());
    expect((await list()).find((x) => x.id === a.id).chatCount).toBe(1);
  });

  it('related characters by tags, creator and description', async () => {
    const t = await make({ name: 'T', tags: ['fantasy', 'elf'], creator: 'ann', description: 'An elf ranger of the northern woods.' });
    const b = await make({ name: 'B', tags: ['elf'], creator: 'ann', description: 'An elf druid of the northern woods.' });
    await make({ name: 'C', tags: ['modern'], description: 'An accountant.' });
    const r = (await c.req('GET', `/api/characters/${t.id}/related`)).json;
    expect(r.map((x: any) => x.id)).toEqual([b.id]);
  });
});

describe('bundles', () => {
  it('round-trips characters with chats, gallery, lorebooks, nickname and collections between instances', async () => {
    const a = await make({ name: 'Iris Thorne', description: 'A quiet bartender.', tags: ['modern'], extensions: { world: 'Northcrest' }, character_book: { name: 'Iris lore', entries: [{ keys: ['ledger'], content: 'Iris keeps a ledger.', enabled: true, insertion_order: 0 }] } });
    await c.req('PATCH', `/api/characters/${a.id}`, { displayName: 'Boss', fav: true });
    await c.req('POST', '/api/lorebooks', { name: 'Northcrest', book: { entries: { 0: { uid: 0, key: ['Lantern'], content: 'A bar.', comment: 'Lantern' } } } });
    const col = (await c.req('POST', '/api/library/collections', { name: 'Backlog' })).json;
    await c.req('POST', `/api/library/collections/${col.id}/items`, { add: [a.id] });
    const chat = (await c.req('POST', '/api/chats', { characterId: a.id, campaign: 'none' })).json;
    await c.req('POST', `/api/chats/${chat.id}/messages`, { role: 'user', text: 'Hello there' });
    await c.req('POST', `/api/media?kind=gallery&characterId=${a.id}`, PNG_1x1);
    const zip = (await c.req('POST', '/api/library/bundle', { ids: [a.id] })).raw;
    const files = unzipSync(new Uint8Array(zip));
    expect(Object.keys(files).sort()).toEqual(expect.arrayContaining(['manifest.json', 'characters/Iris-Thorne.png', 'everloom/Iris-Thorne.json', 'chats/Iris-Thorne/001.jsonl', 'worlds/Northcrest.json']));
    expect(Object.keys(files).some((f) => f.startsWith('gallery/Iris-Thorne/'))).toBe(true);

    const other = await createClient();
    try {
      const pv = (await other.req('POST', '/api/library/bundle/preview', zip, { 'content-type': 'application/zip' })).json;
      expect(pv.items).toEqual([{ index: 0, name: 'Iris Thorne', creator: '', chats: 1, gallery: 1, worlds: 1, avatar3d: false, conflict: null }]);
      const r = (await other.req('POST', '/api/library/bundle/import', { token: pv.token })).json;
      expect(r.created).toHaveLength(1);
      const got = (await other.req('GET', `/api/characters/${r.created[0]}`)).json;
      expect(got).toMatchObject({ name: 'Iris Thorne', displayName: 'Boss', fav: true, tags: ['modern'], hasLorebook: true, hasGallery: true, chatCount: 1 });
      expect(got.card.description).toBe('A quiet bartender.');
      expect((await other.req('GET', '/api/library/collections')).json[0]).toMatchObject({ name: 'Backlog', characterIds: [r.created[0]] });
      expect((await other.req('GET', '/api/lorebooks')).json.map((b: any) => b.name)).toEqual(expect.arrayContaining(['Northcrest']));
      // Importing again: a conflict; "replace" keeps one character and snapshots it first.
      const pv2 = (await other.req('POST', '/api/library/bundle/preview', zip, { 'content-type': 'application/zip' })).json;
      expect(pv2.items[0].conflict).toMatchObject({ id: r.created[0], reason: 'identical' });
      const r2 = (await other.req('POST', '/api/library/bundle/import', { token: pv2.token, choices: { 0: 'replace' } })).json;
      expect(r2.replaced).toEqual([r.created[0]]);
      expect((await other.req('GET', '/api/characters')).json).toHaveLength(1);
      expect((await other.req('GET', `/api/characters/${r.created[0]}/versions`)).json[0].label).toBe('Before bundle import');
      // An expired or foreign token is refused.
      expect((await other.req('POST', '/api/library/bundle/import', { token: pv2.token })).status).toBe(410);
    } finally {
      await other.close();
    }
  });

  it('carries 3D avatars in bundles: the model, its garments and code-made recipes, remapped', async () => {
    const oct = { 'content-type': 'application/octet-stream' };
    const glb = readFileSync(path.join(FIXTURES, 'avatars/models/mannequin-m.glb'));
    const av = (await c.req('POST', '/api/avatars?filename=m.glb&name=Body', glb, oct)).json;
    const { avatarSettled } = await import('../src/services/avatars/service.js');
    await avatarSettled(av.id);
    const g = (await c.req('POST', `/api/avatars/${av.id}/outfit-model?filename=coat.glb`, glb, oct)).json;
    const detail = (await c.req('GET', `/api/avatars/${av.id}`)).json;
    const garment = { id: 'coat', name: 'Coat', model: g.model, modelLow: g.modelLow, slot: 'outer', family: 'm' };
    expect((await c.req('PATCH', `/api/avatars/${av.id}`, { config: { ...detail.config, family: 'm', garments: [garment] } })).status).toBe(200);
    const code = (await c.req('POST', '/api/avatars/code', { name: 'Kit', recipe: { body: { height: 1.9 } } })).json;
    const a = await make({ name: 'Ada' });
    const b = await make({ name: 'Kit' });
    await c.req('PATCH', `/api/characters/${a.id}`, { game: { avatar3d: av.id, display: '3d' } });
    await c.req('PATCH', `/api/characters/${b.id}`, { game: { avatar3d: code.id, display: '3d' } });
    const zip = (await c.req('POST', '/api/library/bundle', { ids: [a.id, b.id] })).raw;
    const files = Object.keys(unzipSync(new Uint8Array(zip)));
    expect(files).toEqual(expect.arrayContaining(['avatars/Ada/avatar.json', 'avatars/Kit/avatar.json']));
    expect(files.some((f) => f.startsWith('avatars/Ada/source-'))).toBe(true);
    // Without 3D, none of it.
    const lean = Object.keys(unzipSync(new Uint8Array((await c.req('POST', '/api/library/bundle', { ids: [a.id], avatars3d: false })).raw)));
    expect(lean.some((f) => f.startsWith('avatars/'))).toBe(false);

    const other = await createClient();
    try {
      const pv = (await other.req('POST', '/api/library/bundle/preview', zip, { 'content-type': 'application/zip' })).json;
      expect(pv.items.map((i: any) => i.avatar3d)).toEqual([true, true]);
      const r = (await other.req('POST', '/api/library/bundle/import', { token: pv.token })).json;
      const ada = (await other.req('GET', `/api/characters/${r.created[0]}`)).json;
      const kit = (await other.req('GET', `/api/characters/${r.created[1]}`)).json;
      expect(ada.game.avatar3d).toMatch(/^av_/);
      expect(ada.game.avatar3d).not.toBe(av.id);
      await avatarSettled(ada.game.avatar3d);
      const got = (await other.req('GET', `/api/avatars/${ada.game.avatar3d}`)).json;
      expect(got.status).toBe('ready');
      expect(got.config.garments).toHaveLength(1);
      expect(got.config.garments[0].model).not.toBe(g.model);
      expect((await other.req('GET', `/media/${got.config.garments[0].model}`)).status).toBe(200);
      const kitAv = (await other.req('GET', `/api/avatars/${kit.game.avatar3d}`)).json;
      expect(kitAv).toMatchObject({ kind: 'code' });
      expect(kitAv.config.recipe.body.height).toBe(1.9);
    } finally {
      await other.close();
    }
  }, 120_000);

  it('imports a plain zip of SillyTavern files: a card, its chats in a folder, a linked world', async () => {
    const png = readFileSync(path.join(FIXTURES, 'st/Seraphina.png'));
    const jsonl = [JSON.stringify({ user_name: 'You', character_name: 'Seraphina', create_date: '2024-01-01' }), JSON.stringify({ name: 'You', is_user: true, mes: 'Where am I?', send_date: '2024-01-01' })].join('\n');
    const zip = Buffer.from(zipSync({ 'Seraphina.png': new Uint8Array(png), 'chats/Seraphina/one.jsonl': strToU8(jsonl), 'notes.txt': strToU8('hi') }));
    const pv = (await c.req('POST', '/api/library/bundle/preview', zip, { 'content-type': 'application/zip' })).json;
    expect(pv.items[0]).toMatchObject({ name: 'Seraphina', chats: 1 });
    const r = (await c.req('POST', '/api/library/bundle/import', { token: pv.token })).json;
    const got = (await c.req('GET', `/api/characters/${r.created[0]}`)).json;
    expect(got.chatCount).toBe(1);
    expect(got.avatar).toBeTruthy();
    // Not a zip at all.
    expect((await c.req('POST', '/api/library/bundle/preview', Buffer.from('nope'), { 'content-type': 'application/zip' })).status).toBe(400);
  });
});

describe('chat history', () => {
  it('searches inside the showing messages of every chat', async () => {
    const a = await make({ name: 'Iris' });
    const b = await make({ name: 'Kael' });
    const c1 = (await c.req('POST', '/api/chats', { characterId: a.id, campaign: 'none' })).json;
    const c2 = (await c.req('POST', '/api/chats', { characterId: b.id, campaign: 'none' })).json;
    await c.req('POST', `/api/chats/${c1.id}/messages`, { role: 'user', text: 'Have you seen the Brass Key?' });
    await c.req('POST', `/api/chats/${c1.id}/messages`, { role: 'user', text: 'The brass key again.' });
    await c.req('POST', `/api/chats/${c2.id}/messages`, { role: 'user', text: 'Nothing here.' });
    const r = (await c.req('GET', '/api/chat-search?q=brass%20key')).json;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ chatId: c1.id, count: 2 });
    expect(r[0].snippet).toContain('Brass Key');
    expect((await c.req('GET', '/api/chat-search?q=x')).json).toEqual([]);
  });
});

describe('recommender', () => {
  it('picks from the library (never an invented one), honors the mood, a collection and exclusions, and logs the call', async () => {
    const { startMockLlm } = await import('../../../tests/mock-llm/server.js');
    const mock = await startMockLlm();
    try {
      expect((await c.req('POST', '/api/library/recommend', {})).status).toBe(400); // no connection
      await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 300, context_size: 8192 } });
      expect((await c.req('POST', '/api/library/recommend', {})).status).toBe(400); // empty library
      for (let i = 0; i < 50; i++) await make({ name: `Filler ${i}`, description: 'An ordinary shopkeeper.' });
      const ghost = await make({ name: 'Wren', tags: ['horror'], description: 'A ghost haunting the lighthouse.' });
      const r = (await c.req('POST', '/api/library/recommend', { mood: 'something with a ghost', seed: 3 })).json;
      expect(r.picks[0]).toMatchObject({ id: ghost.id, name: 'Wren' });
      expect(r.picks.length).toBeLessThanOrEqual(3);
      expect(r.considered).toBeLessThanOrEqual(30);
      expect(r.total).toBe(51);
      const again = (await c.req('POST', '/api/library/recommend', { mood: 'something with a ghost', seed: 3, exclude: [ghost.id] })).json;
      expect(again.picks.map((p: any) => p.id)).not.toContain(ghost.id);
      const col = (await c.req('POST', '/api/library/collections', { name: 'Spooky' })).json;
      await c.req('POST', '/api/library/batch', { ids: [ghost.id], action: { action: 'collect', collectionId: col.id } });
      const inCol = (await c.req('POST', '/api/library/recommend', { collectionId: col.id })).json;
      expect(inCol.picks.map((p: any) => p.id)).toEqual([ghost.id]);
      const calls = (await c.req('GET', '/api/calls?limit=10')).json;
      expect((calls.items ?? calls).some((x: any) => x.purpose === 'recommender')).toBe(true);
    } finally {
      await mock.close();
    }
  });
});
