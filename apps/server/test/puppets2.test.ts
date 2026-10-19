import { testFigure, validateModel, type FigureShape, type TestFigure } from '@everloom/engine/puppet2';
import { emptyCardData } from '@everloom/engine';
import { strToU8, zipSync } from 'fflate';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { assertPuppet2LinkAllowed, REFUSED } from '../src/services/minor-guard.js';
import { createClient, type TestClient } from './helpers.js';

const ownerOf = (t: TestClient) => (t.built.ctx.sys.prepare('SELECT id FROM users WHERE username = ?').get('owner') as { id: string }).id;

let c: TestClient | null = null;
afterEach(async () => { await c?.close(); c = null; });

/** The procedural test figure as a character pack: each layer's shapes drawn into its own PNG. */
async function pack(views: Record<string, TestFigure>, extra: { rating?: string; adultLayer?: boolean } = {}) {
  const files: Record<string, Uint8Array> = {};
  const index: { name: string; rating: string; views: Record<string, unknown> } = { name: 'Figure', rating: extra.rating ?? 'all-ages', views: {} };
  for (const [view, fig] of Object.entries(views)) {
    const layers = [];
    for (const l of fig.input.layers) {
      const [x, y, w, h] = l.rect;
      const svg = (s: FigureShape) => s.type === 'ellipse'
        ? `<ellipse cx="${s.cx - x}" cy="${s.cy - y}" rx="${s.rx}" ry="${s.ry}" fill="${s.color}"/>`
        : `<polyline points="${s.pts.map((p) => `${p[0] - x},${p[1] - y}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="${Math.max(...[s.w].flat())}" stroke-linecap="round" stroke-linejoin="round"/>`;
      const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${(fig.paint[l.id] ?? []).map(svg).join('')}</svg>`)).png().toBuffer();
      files[`fig/${view}/${l.id}.png`] = new Uint8Array(png);
      const { texture: _t, ...rest } = l;
      layers.push({ ...rest, ...(extra.adultLayer && l.id === 'torso' ? { adult: true } : {}) });
    }
    index.views[view] = { keypoints: fig.input.keypoints, layers };
  }
  files['fig/character.json'] = strToU8(JSON.stringify(index));
  return Buffer.from(zipSync(files));
}

it('imports a character pack, rigs every view and serves the models and pictures', async () => {
  c = await createClient();
  const zip = await pack({ front: testFigure(), side: testFigure({ view: 'side' }) });
  const r = await c.req('POST', '/api/puppets2/import', zip);
  expect(r.status, r.body).toBe(200);
  expect(r.json).toMatchObject({ name: 'Figure', rating: 'all-ages', views: ['front', 'side'], outfits: ['casual'], adult: false });
  const list = (await c.req('GET', '/api/puppets2')).json as Array<{ id: string; base: string }>;
  expect(list).toHaveLength(1);
  const model = JSON.parse((await c.req('GET', `${list[0]!.base}front.r2d.json`)).body);
  expect(validateModel(model).model).not.toBeNull();
  expect(model.animations.map((a: { id: string }) => a.id)).toEqual(expect.arrayContaining(['idle', 'wave_L', 'walk']));
  const side = JSON.parse((await c.req('GET', `${list[0]!.base}side.r2d.json`)).body);
  expect(side.animations.find((a: { id: string }) => a.id === 'walk').events[0].name).toBe('locomotion');
  const png = await c.req('GET', `${list[0]!.base}${model.textures[0].path}`);
  expect(png.raw.subarray(0, 4).toString('hex')).toBe('89504e47');
  // Only model and picture names are served.
  expect((await c.req('GET', `${list[0]!.base}meta.json`)).status).toBe(404);
  expect((await c.req('DELETE', `/api/puppets2/${list[0]!.id}`)).status).toBe(200);
  expect((await c.req('GET', '/api/puppets2')).json).toHaveLength(0);
}, 60000);

it('refuses broken packs and adult layers outside an 18+ pack', async () => {
  c = await createClient();
  expect((await c.req('POST', '/api/puppets2/import', Buffer.from('not a zip'))).status).toBe(400);
  expect((await c.req('POST', '/api/puppets2/import', Buffer.from(zipSync({ 'character.json': strToU8('{"name":"x","views":{}}') })))).status).toBe(400);
  const r = await c.req('POST', '/api/puppets2/import', await pack({ front: testFigure() }, { adultLayer: true }));
  expect(r.status).toBe(400);
  expect(r.body).toMatch(/18\+ pack/);
  expect((await c.req('GET', '/api/puppets2')).json).toHaveLength(0);
}, 60000);

it('never puts a puppet with adult layers on a minor', async () => {
  c = await createClient();
  const adult = (await c.req('POST', '/api/puppets2/import', await pack({ front: testFigure() }, { rating: '18+', adultLayer: true }))).json;
  expect(adult).toMatchObject({ rating: '18+', adult: true });
  const plain = (await c.req('POST', '/api/puppets2/import', await pack({ front: testFigure() }))).json;
  const owner = ownerOf(c);
  expect(() => assertPuppet2LinkAllowed(c!.built.ctx, owner, adult.id, { ...emptyCardData('Child'), description: 'a child' }, { age: 10 })).toThrow(REFUSED);
  expect(() => assertPuppet2LinkAllowed(c!.built.ctx, owner, adult.id, emptyCardData('Adult'), { age: 25 })).not.toThrow();
  const young = await c.req('POST', '/api/characters', { card: { name: 'Young', first_mes: 'Hi', description: 'A 14-year-old.' } });
  expect((await c.req('PATCH', `/api/characters/${young.json.id}`, { game: { puppet2: adult.id } })).status).toBe(400);
  expect((await c.req('PATCH', `/api/characters/${young.json.id}`, { game: { puppet2: plain.id } })).status).toBe(200);
  const grown = await c.req('POST', '/api/characters', { card: { name: 'Grown', first_mes: 'Hi', description: 'A 30-year-old sailor.' } });
  expect((await c.req('PATCH', `/api/characters/${grown.json.id}`, { game: { puppet2: adult.id } })).status).toBe(200);
}, 60000);
