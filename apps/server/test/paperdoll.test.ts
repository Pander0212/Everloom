import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';
import * as utility from '../src/services/utility.js';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
afterEach(async () => { await c?.close(); c = null; vi.restoreAllMocks(); });

const png = (w: number, h: number, color: string) => sharp({ create: { width: w, height: h, channels: 4, background: color } }).png().toBuffer();

/** A synthetic template (simple shapes, no art): body, two hairstyles, a top. */
async function templatePack(o: { id?: string; rating?: string; adultLayer?: boolean } = {}) {
  const id = o.id ?? 'stand-neutral';
  const L = (lid: string, part: string, z: number, extra: object = {}) => ({ id: lid, part, file: `${lid}.png`, rect: [0, 0, 64, 128], z, ...extra });
  const t = {
    format: 'everloom-studio-template', version: 1, id, name: 'Standing', category: 'standing', rating: o.rating ?? 'all-ages', width: 64, height: 128,
    supports: { hairBack: ['long_straight', 'bob'], wardrobe: { top: ['tee'] } },
    slots: [{ id: 'a', sex: ['female'], layers: [
      L('body', 'body', 10, { recolor: [{ kind: 'skin', base: '#f3cfb6' }] }),
      L('hair-long', 'hairBack', 5, { when: { 'hair.back': 'long_straight' }, recolor: [{ kind: 'hair', base: '#3b2a22' }] }),
      L('hair-bob', 'hairBack', 5, { when: { 'hair.back': 'bob' } }),
      L('tee', 'clothing', 20, { when: { 'wardrobe.top': 'tee' } }),
      ...(o.adultLayer ? [L('detail', 'bodyDetail', 11, { adult: true })] : []),
    ] }],
  };
  const files: Record<string, Uint8Array> = { [`${id}/template.json`]: strToU8(JSON.stringify(t)) };
  for (const [f, col] of [['body', '#f3cfb6'], ['hair-long', '#3b2a22'], ['hair-bob', '#3b2a22'], ['tee', '#ffffff'], ['detail', '#e0a0a0']] as const) files[`${id}/${f}.png`] = new Uint8Array(await png(64, 128, col));
  return Buffer.from(zipSync(files));
}

it('installs, lists and serves template packs, and refuses broken ones', async () => {
  c = await createClient();
  const r = await c.req('POST', '/api/paperdoll/templates/import', await templatePack());
  expect(r.status, r.body).toBe(200);
  expect(r.json[0]).toMatchObject({ id: 'stand-neutral', category: 'standing', base: '/api/paperdoll/templates/stand-neutral/' });
  expect((await c.req('GET', '/api/paperdoll/templates')).json).toHaveLength(1);
  const pic = await c.req('GET', '/api/paperdoll/templates/stand-neutral/body.png');
  expect(pic.raw.subarray(0, 4).toString('hex')).toBe('89504e47');
  expect((await c.req('GET', '/api/paperdoll/templates/stand-neutral/../../x.png')).status).toBe(404);
  // An adult layer in an all-ages template is refused; in an 18+ template it's fine.
  const bad = await c.req('POST', '/api/paperdoll/templates/import', await templatePack({ id: 'bad', adultLayer: true }));
  expect(bad.status).toBe(400);
  expect(bad.body).toMatch(/adult in an all-ages/);
  expect((await c.req('POST', '/api/paperdoll/templates/import', await templatePack({ id: 'scene-a', rating: '18+', adultLayer: true }))).status).toBe(200);
  expect((await c.req('POST', '/api/paperdoll/templates/import', Buffer.from('nope'))).status).toBe(400);
  expect((await c.req('DELETE', '/api/paperdoll/templates/scene-a')).status).toBe(200);
}, 60000);

it('keeps adult trait sheets for story characters and NPCs, rolls coherent NPCs, locks designs', async () => {
  c = await createClient();
  await c.req('POST', '/api/paperdoll/templates/import', await templatePack());
  expect((await c.req('POST', '/api/paperdoll/characters', { sheet: { name: 'Kid', sex: 'female', age: 15 } })).status).toBe(400);
  const roll = (await c.req('POST', '/api/paperdoll/roll', { seed: 3, sex: 'female' })).json;
  expect(roll.age).toBeGreaterThanOrEqual(20);
  expect(['tee', null]).toContain(roll.wardrobe.top);
  const npc = (await c.req('POST', '/api/paperdoll/characters', { sheet: { ...roll, locked: true } })).json;
  expect(npc.kind).toBe('npc');
  // A locked design ignores trait changes (renaming is fine).
  const changed = (await c.req('PUT', `/api/paperdoll/characters/${npc.id}`, { sheet: { ...npc.sheet, name: 'Renamed', hair: { ...npc.sheet.hair, color: '#ffffff' } } })).json;
  expect(changed.sheet.name).toBe('Renamed');
  expect(changed.sheet.hair.color).toBe(npc.sheet.hair.color);
  const re = (await c.req('POST', '/api/paperdoll/roll', { seed: 9, base: npc.sheet, locks: ['hair'] })).json;
  expect(re.hair).toEqual(npc.sheet.hair);
  const list = (await c.req('GET', '/api/paperdoll/characters?page=0&perPage=13')).json;
  expect(list).toMatchObject({ total: 1, pages: 1 });
}, 60000);

it('fills a sheet from a card with the utility model, never for a minor', async () => {
  c = await createClient();
  vi.spyOn(utility, 'utilityJson').mockResolvedValue({ sex: 'female', age: 28, hair: { back: 'bob', color: 'silver' }, face: { eyeColor: 'amber' } } as never);
  const adult = (await c.req('POST', '/api/characters', { card: { name: 'Sena', first_mes: 'Hi', description: 'A 28-year-old engineer with a silver bob.' } })).json;
  const filled = await c.req('POST', `/api/paperdoll/fill/${adult.id}`);
  expect(filled.status, filled.body).toBe(200);
  expect(filled.json).toMatchObject({ ageStated: true, sheet: { name: 'Sena', age: 28, hair: { back: 'bob', color: '#c9c9cf' } } });
  const linked = await c.req('POST', '/api/paperdoll/characters', { characterId: adult.id, sheet: filled.json.sheet });
  expect(linked.json.kind).toBe('story');
  expect((await c.req('GET', `/api/paperdoll/for/${adult.id}`)).json.id).toBe(linked.json.id);
  // No age stated anywhere: the fill says so (the owner must enter it), and never invents an adult.
  vi.mocked(utility.utilityJson).mockResolvedValueOnce({ sex: 'female', hair: { back: 'bob' } } as never);
  const vague = (await c.req('POST', '/api/characters', { card: { name: 'Ash', first_mes: 'Hi', description: 'A traveller.' } })).json;
  expect((await c.req('POST', `/api/paperdoll/fill/${vague.id}`)).json.ageStated).toBe(false);
  // A card describing a minor gets neither a fill nor a linked sheet.
  const young = (await c.req('POST', '/api/characters', { card: { name: 'Pip', first_mes: 'Hi', description: 'A 14-year-old.' } })).json;
  expect((await c.req('POST', `/api/paperdoll/fill/${young.id}`)).status).toBe(400);
  expect((await c.req('POST', '/api/paperdoll/characters', { characterId: young.id, sheet: { name: 'Pip', sex: 'female', age: 25 } })).status).toBe(400);
}, 60000);
