import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGlb, replaceViews, writeGlb } from '../src/services/avatars/glb.js';
import { inspectModel } from '../src/services/avatars/inspect.js';
import { optimizeModel } from '../src/services/avatars/optimize.js';
import { avatarSettled, sniffModel } from '../src/services/avatars/service.js';
import { mergeRecipe } from '../src/services/avatars/recipes.js';
import { recipeFromText } from '@everloom/engine';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { createClient, FIXTURES, waitFor, type TestClient } from './helpers.js';

const MANNEQUIN = readFileSync(path.join(FIXTURES, 'avatars/models/mannequin-m.glb'));
const oct = { 'content-type': 'application/octet-stream' };

/** A VRM 1.0 made from the mannequin: humanoid bones, a few expressions and a 1024px texture. */
async function makeVrm(): Promise<Buffer> {
  const g = parseGlb(MANNEQUIN);
  const json = structuredClone(g.json);
  const png = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 180, g: 120, b: 90, alpha: 1 } } }).png().toBuffer();
  const views = json.bufferViews!;
  views.push({ buffer: 0, byteOffset: 0, byteLength: png.length });
  json.images = [{ bufferView: views.length - 1, mimeType: 'image/png' }];
  json.textures = [{ source: 0 }];
  json.materials![0] = { ...json.materials![0], pbrMetallicRoughness: { baseColorTexture: { index: 0 } } } as never;
  const info = await inspectModel(MANNEQUIN);
  const nodeIndex = (name: string) => json.nodes!.findIndex((n) => n.name === name);
  json.extensionsUsed = [...(json.extensionsUsed ?? []), 'VRMC_vrm'];
  json.extensions = {
    ...(json.extensions ?? {}),
    VRMC_vrm: {
      specVersion: '1.0',
      meta: { name: 'Test', authors: ['Everloom tests'], licenseUrl: 'https://vrm.dev/licenses/1.0/' },
      humanoid: { humanBones: Object.fromEntries(Object.entries(info.boneMap).map(([k, v]) => [k, { node: nodeIndex(v!) }])) },
      expressions: { preset: { happy: { morphTargetBinds: [] }, aa: { morphTargetBinds: [] }, blink: { morphTargetBinds: [] } } },
    },
  };
  // The new view gets its bytes through the same repacking the optimizer uses.
  return writeGlb(replaceViews({ json, bin: g.bin }, new Map([[views.length - 1, png]])));
}

let c: TestClient | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

describe('3D model files', () => {
  it('recognises formats by their bytes', () => {
    expect(sniffModel(MANNEQUIN)).toBe('glb');
    expect(sniffModel(Buffer.from('Kaydara FBX Binary  \u0000\u001a\u0000'))).toBe('fbx');
    expect(sniffModel(Buffer.from('; FBX 7.4.0 project file\n'))).toBe('fbx');
    expect(sniffModel(Buffer.from('PMX \u0000\u0000\u0000@'))).toBe('pmx');
    expect(sniffModel(Buffer.from('# Blender\nv 0 0 0\nf 1 2 3\n'), 'x.obj')).toBe('obj');
    expect(sniffModel(Buffer.from('# Blender\nv 0 0 0\n'), 'x.txt')).toBeNull();
    expect(sniffModel(Buffer.from('<?xml version="1.0"?><COLLADA xmlns="x">'))).toBe('dae');
    expect(sniffModel(Buffer.from('just some text'))).toBeNull();
  });

  it('inspects a GLB: skeleton, mapping, cost, units', async () => {
    const info = await inspectModel(MANNEQUIN);
    expect(info.format).toBe('glb');
    expect(info.missingBones).toEqual([]);
    expect(info.boneMap.hips).toBeTruthy();
    expect(info.triangles).toBeGreaterThan(1000);
    expect(info.height).toBeGreaterThan(1.5);
    expect(info.height).toBeLessThan(2.1);
    expect(info.unitScale).toBe(1);
    expect(info.warnings.map((w) => w.code)).toContain('no_face');
  });

  it('rejects broken files with a readable reason', async () => {
    const cut = MANNEQUIN.subarray(0, 4000);
    await expect(inspectModel(cut)).rejects.toThrow(/cut short/);
    const bad = Buffer.from(MANNEQUIN);
    bad.writeUInt32LE(3, 4);
    await expect(inspectModel(bad)).rejects.toThrow(/glTF 2.0/);
  });

  it('optimizes a GLB smaller, with a simpler low-detail copy, keeping the skeleton', async () => {
    const r = await optimizeModel(MANNEQUIN, { format: 'glb', ktx2: false });
    expect(r.main.length).toBeLessThan(MANNEQUIN.length);
    expect(r.low.length).toBeLessThan(r.main.length);
    const a = await inspectModel(r.main);
    const b = await inspectModel(r.low);
    expect(a.missingBones).toEqual([]);
    expect(b.missingBones).toEqual([]);
    expect(b.triangles).toBeLessThan(a.triangles * 0.75);
    expect(parseGlb(r.main).json.extensionsUsed).toContain('EXT_meshopt_compression');
  });

  it('keeps a VRM as written except its textures (KTX2), so its extensions survive', async () => {
    const vrm = await makeVrm();
    const info = await inspectModel(vrm);
    expect(info.format).toBe('vrm1');
    expect(info.convention).toBe('vrm');
    expect(info.vrmExpressions).toEqual(['happy', 'aa', 'blink']);
    expect(info.expressionMap.joy).toEqual([{ morph: 'vrm:happy', weight: 1 }]);
    expect(info.textures[0]).toMatchObject({ width: 1024, height: 1024 });
    const r = await optimizeModel(vrm, { format: 'vrm1', ktx2: true, maxTexture: 512 });
    const out = parseGlb(r.main);
    expect(out.json.extensions?.VRMC_vrm).toEqual(parseGlb(vrm).json.extensions?.VRMC_vrm);
    expect(out.json.images?.[0]?.mimeType).toBe('image/ktx2');
    expect(out.json.textures?.[0]?.extensions?.KHR_texture_basisu).toEqual({ source: 0 });
    expect(out.json.extensionsRequired).toContain('KHR_texture_basisu');
    const again = await inspectModel(r.main);
    expect(again.textures[0]).toMatchObject({ width: 512, height: 512, mime: 'image/ktx2' });
    expect(again.boneMap).toEqual(info.boneMap);
    // Mesh data is byte-for-byte the same.
    expect(again.triangles).toBe(info.triangles);
  }, 60_000);
});

describe('code-made avatars', () => {
  it('keeps only the valid parts of a model-made recipe', () => {
    const base = recipeFromText('Mira', 'A tall woman with long red hair and green eyes, in a blue dress.');
    expect(base.hair).toMatchObject({ style: 'long', color: '#a8371f' });
    expect(base.bottom.kind).toBe('long_skirt');
    const r = mergeRecipe(base, { hair: { style: 'mohawk', color: '#123456' }, top: { kind: 'armor', color: 'blue' }, body: 'nope', extras: [{ kind: 'cape', color: '#202020' }] });
    expect(r.hair).toMatchObject({ style: 'long', color: '#123456' });
    expect(r.top.kind).toBe('armor');
    expect(r.top.color).toBe(base.top.color);
    expect(r.body).toEqual(base.body);
    expect(r.extras).toEqual([{ kind: 'cape', color: '#202020' }]);
  });

  it('children from the text get a child body', () => {
    expect(recipeFromText('Pip', 'A little girl of seven with pigtails.').body.age).toBe('child');
    expect(recipeFromText('Pip', 'anything', { age: 15 }).body.age).toBe('teen');
  });

  it('stores a recipe without a model file and fills one in without a model', async () => {
    c = await createClient();
    const bad = await c.req('POST', '/api/avatars/code', { name: 'X', recipe: { body: { age: 'baby' } } });
    expect(bad.status).toBe(400);
    const fill = await c.req('POST', '/api/avatars/recipe', { name: 'Old Tom', text: 'An elderly fisherman with a white beard and a grey beanie.' });
    expect(fill.status).toBe(200);
    expect(fill.json.source).toBe('text');
    expect(fill.json.recipe.body.age).toBe('elder');
    expect(fill.json.recipe.hat.kind).toBe('beanie');
    const made = await c.req('POST', '/api/avatars/code', { name: 'Old Tom', recipe: fill.json.recipe });
    expect(made.json).toMatchObject({ kind: 'code', status: 'ready', model: null });
    const d = (await c.req('GET', `/api/avatars/${made.json.id}`)).json;
    expect(d.config.recipe.hat.kind).toBe('beanie');
    expect((await c.req('POST', `/api/avatars/${made.json.id}/reprocess`, {})).status).toBe(400);
    const patched = await c.req('PATCH', `/api/avatars/${made.json.id}`, { config: { ...d.config, recipe: { ...d.config.recipe, hair: { style: 'bun', color: '#ffffff', length: 0.5 } } } });
    expect(patched.json.config.recipe.hair.style).toBe('bun');
    expect((await c.req('DELETE', `/api/avatars/${made.json.id}`)).status).toBe(200);
  });
});

describe('garments for items on code-made characters', () => {
  it('rules first, then the model once per item; answers that fail the schema are rejected', async () => {
    const mock = await startMockLlm();
    try {
      c = await createClient();
      const items = [{ name: 'Iron Helmet', category: 'armor', slot: 'head' }, { name: 'Moonweave Garb', category: 'clothing', slot: 'body' }, { name: 'Cursed Raiment', category: 'clothing', slot: 'body' }, { name: 'Sword', category: 'weapon', slot: 'weapon' }];
      // Without a model: rules, or the slot's plain garment.
      let r = (await c.req('POST', '/api/avatars/garments', { items })).json;
      expect(r.map((x: any) => x.source)).toEqual(['rules', 'slot', 'slot', 'rules']);
      expect(r[0].garment).toMatchObject({ slot: 'hat', kind: 'helmet' });
      expect(r[3].garment).toBeNull();
      await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 300, context_size: 8192 } });
      r = (await c.req('POST', '/api/avatars/garments', { items })).json;
      expect(r[1]).toMatchObject({ source: 'model', garment: { slot: 'top', kind: 'robe', pattern: 'dots' } });
      // "kimono" isn't a kind: rejected, and the slot's plain garment is used instead.
      expect(r[2]).toMatchObject({ source: 'slot', garment: { slot: 'top', kind: 'shirt' } });
      // Saved: asked once.
      const calls = (await c.req('GET', '/api/calls')).json;
      const before = (Array.isArray(calls) ? calls : calls.calls ?? []).length;
      await c.req('POST', '/api/avatars/garments', { items: [items[1]] });
      const after = ((await c.req('GET', '/api/calls')).json);
      expect((Array.isArray(after) ? after : after.calls ?? []).length).toBe(before);

      // The look: the model's valid fields are kept, the rest come from the text.
      const look = (await c.req('POST', '/api/avatars/recipe', { name: 'Gran', text: 'A kind old woman.' })).json;
      expect(look.source).toBe('model');
      expect(look.recipe.hair).toMatchObject({ style: 'bun', color: '#ffffff' });
      expect(look.recipe.top.kind).toBe('robe');
      expect(look.recipe.top.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(look.recipe.body.age).toBe('elder');
    } finally {
      await mock.close();
    }
  });
});

describe('AI-made props (image-to-3D connection)', () => {
  it('runs a Meshy job from text (preview, then texturing) and keeps the cleaned-up model until discarded', async () => {
    const http = await import('node:http');
    const seen: string[] = [];
    let polls = 0;
    const srv = http.createServer((req, res) => {
      seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
      const send = (o: unknown) => (res.setHeader('content-type', 'application/json'), res.end(JSON.stringify(o)));
      if (req.url === '/m.glb') return res.end(MANNEQUIN);
      if (req.method === 'POST' && req.url === '/openapi/v2/text-to-3d') {
        let b = '';
        req.on('data', (d) => (b += d));
        return req.on('end', () => send({ result: JSON.parse(b).mode === 'refine' ? 'task-refine' : 'task-preview' }));
      }
      if (req.url?.startsWith('/openapi/v2/text-to-3d/')) {
        polls++;
        return send(polls % 2 ? { status: 'IN_PROGRESS', progress: 50 } : { status: 'SUCCEEDED', progress: 100, model_urls: { glb: `http://127.0.0.1:${(srv.address() as any).port}/m.glb` } });
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      c = await createClient();
      expect((await c.req('POST', '/api/avatars/generate', { prompt: 'a brass lantern' })).json.error).toMatch(/3D model connection/);
      const conn = (await c.req('POST', '/api/connections', { name: 'Meshy', provider: '3d-meshy', baseUrl: `http://127.0.0.1:${(srv.address() as any).port}`, apiKey: 'msy-test' })).json;
      await c.req('PATCH', '/api/settings', { roles: { model3d: conn.id } });
      const job = (await c.req('POST', '/api/avatars/generate', { prompt: 'a brass lantern', kind: 'prop' })).json;
      expect(job.state).toBe('running');
      let j = job;
      await waitFor(async () => {
        j = (await c!.req('GET', `/api/avatars/generate/${job.id}`)).json;
        return j.state !== 'running';
      }, 60_000);
      expect(j).toMatchObject({ state: 'done', progress: 100 });
      expect(j.model).toMatch(/^m_/);
      expect(seen.filter((x) => x.startsWith('POST'))).toEqual([expect.stringContaining('Bearer msy-test'), expect.stringContaining('Bearer msy-test')]);
      expect((await c.req('GET', `/media/${j.model}`)).status).toBe(200);
      await c.req('DELETE', `/api/avatars/generate/${job.id}`);
      expect((await c.req('GET', `/media/${j.model}`)).status).toBe(404);
    } finally {
      srv.close();
    }
  }, 90_000);
});

describe('Blender add-on uploads', () => {
  it('needs a device token; sends avatars, garments for an avatar, and animations to the inbox', async () => {
    c = await createClient();
    const inject = (url: string, body?: Buffer, token?: string) => c!.built.app.inject({ method: 'POST', url, payload: body, headers: { 'content-type': 'application/octet-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    expect((await inject('/api/addon/ping')).statusCode).toBe(401);
    expect((await inject('/api/addon/ping', undefined, 'evb_not_a_real_token_at_all_x')).statusCode).toBe(401);
    const { token } = (await c.req('POST', '/api/bridge/devices', { label: 'Blender' })).json;
    expect(JSON.parse((await inject('/api/addon/ping', undefined, token)).body)).toEqual({ ok: true, name: 'Everloom' });
    const a = JSON.parse((await inject('/api/addon/upload?kind=avatar&name=Hero', MANNEQUIN, token)).body);
    expect(a).toMatchObject({ kind: 'avatar', open: expect.stringMatching(/^\/characters\/avatars\/av_/) });
    await avatarSettled(a.id);
    expect(JSON.parse((await inject('/api/addon/avatars', undefined, token)).body)).toEqual([{ id: a.id, name: 'Hero' }]);
    expect((await inject('/api/addon/upload?kind=garment&name=Coat', MANNEQUIN, token)).statusCode).toBe(400);
    const g = JSON.parse((await inject(`/api/addon/upload?kind=garment&name=Coat&avatar=${a.id}&slot=outer`, MANNEQUIN, token)).body);
    expect(g.kind).toBe('garment');
    const d = (await c.req('GET', `/api/avatars/${a.id}`)).json;
    expect(d.config.garments).toEqual([expect.objectContaining({ id: g.id, name: 'Coat', slot: 'outer' })]);
    const m = JSON.parse((await inject('/api/addon/upload?kind=animation&name=Bow', MANNEQUIN, token)).body);
    expect(m.kind).toBe('animation');
    expect((await c.req('GET', '/api/avatar-motions/inbox')).json).toEqual([expect.objectContaining({ id: m.id, name: 'Bow' })]);
  }, 60_000);
});

describe('part packs and parts-made avatars', () => {
  const BASICS = path.resolve(__dirname, '../../web/public/avatar/packs/basics');
  /** A small pack zip in the CharacterStudio layout, from two of the built-in parts. */
  async function packZip(mut?: (m: any) => void): Promise<Buffer> {
    const { zipSync } = await import('fflate');
    const m = { traitsDirectory: 'traits', initialTraits: { BODY: 'soft' }, traits: [{ trait: 'BODY', name: 'Body', collection: [{ id: 'soft', name: 'Soft', directory: 'body/soft.glb', thumbnail: 'body/soft.png' }] }, { trait: 'HAIR', name: 'Hair', collection: [{ id: 'bob', name: 'Bob', directory: 'hair/bob.glb' }] }], everloom: { name: 'Test pack', license: 'CC0 1.0' } };
    mut?.(m);
    return Buffer.from(
      zipSync({
        'mypack/manifest.json': new TextEncoder().encode(JSON.stringify(m)),
        'mypack/traits/body/soft.glb': readFileSync(path.join(BASICS, 'traits/body/soft.glb')),
        'mypack/traits/body/soft.png': readFileSync(path.join(BASICS, 'thumbnails/body/soft.png')),
        'mypack/traits/hair/bob.glb': readFileSync(path.join(BASICS, 'traits/hair/bob.glb')),
      }),
    );
  }
  const zipType = { 'content-type': 'application/zip' };

  it('imports a pack (files into media), rejects broken ones with reasons, and keeps characters working', async () => {
    c = await createClient();
    let list = (await c.req('GET', '/api/avatar-packs')).json;
    expect(list).toEqual([expect.objectContaining({ id: 'basics', builtin: true, enabled: true, license: 'CC0 1.0' })]);

    expect((await c.req('POST', '/api/avatar-packs', Buffer.from('not a zip'), zipType)).json.error).toMatch(/not a zip/);
    const missing = await c.req('POST', '/api/avatar-packs', await packZip((m) => m.traits[1].collection.push({ id: 'gone', directory: 'hair/gone.glb' })), zipType);
    expect(missing.status).toBe(400);
    expect(missing.json.error).toMatch(/HAIR\/gone: "traits\/hair\/gone.glb" is missing/);
    const noBody = await c.req('POST', '/api/avatar-packs', await packZip((m) => (m.traits[0].trait = 'SKINNY')), zipType);
    expect(noBody.json.error).toMatch(/No body group/);

    const ok = await c.req('POST', '/api/avatar-packs', await packZip(), zipType);
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ name: 'Test pack', license: 'CC0 1.0', parts: 2, enabled: true });
    const bodyUrl = ok.json.files['traits/body/soft.glb'];
    expect(bodyUrl).toMatch(/^\/media\//);
    expect(ok.json.files['traits/body/soft.png']).toMatch(/^\/media\//);
    // Pack files stay out of the picture gallery.
    expect((await c.req('GET', '/api/media')).json).toEqual([]);

    // A character made from it.
    const body = bodyUrl.replace('/media/', '');
    const hair = ok.json.files['traits/hair/bob.glb'].replace('/media/', '');
    const made = await c.req('POST', '/api/avatars/parts', { name: 'Pip', config: { maker: { pack: ok.json.id, body, parts: { BODY: 'soft', HAIR: 'bob' } }, garments: [{ id: 'hair-bob', name: 'Bob', model: hair, slot: 'hair' }], tints: { Body: '#a8704f' } } });
    expect(made.json).toMatchObject({ kind: 'parts', status: 'ready', model: bodyUrl });
    const builtin = await c.req('POST', '/api/avatars/parts', { name: 'Sam', config: { maker: { pack: 'basics', body: '/avatar/packs/basics/traits/body/straight.glb', parts: { BODY: 'straight' } } } });
    expect(builtin.json.model).toBe('/avatar/packs/basics/traits/body/straight.glb');
    expect((await c.req('POST', '/api/avatars/parts', { config: { maker: { pack: 'x', body: '/etc/passwd', parts: {} } } })).status).toBe(400);
    expect((await c.req('POST', '/api/avatars/parts', { config: { garments: [{ id: 'g', name: 'G', model: 'https://evil.example/x.glb', slot: 'top' }], maker: { pack: 'basics', body: '/avatar/packs/basics/traits/body/soft.glb', parts: {} } } })).status).toBe(400);

    // Turning the built-in pack off; deleting the imported one keeps the files Pip uses.
    expect((await c.req('PATCH', '/api/avatar-packs/basics', { enabled: false })).json.enabled).toBe(false);
    list = (await c.req('GET', '/api/avatar-packs')).json;
    expect(list.find((p: any) => p.id === 'basics').enabled).toBe(false);
    expect((await c.req('DELETE', '/api/avatar-packs/basics')).status).toBe(400);
    expect((await c.req('DELETE', `/api/avatar-packs/${ok.json.id}`)).status).toBe(200);
    expect((await c.req('GET', bodyUrl)).status).toBe(200);
    expect((await c.req('GET', `/media/${hair}`)).status).toBe(200);
    // Deleting the character never deletes pack files it borrowed.
    await c.req('DELETE', `/api/avatars/${made.json.id}`);
    expect((await c.req('GET', '/api/avatar-packs')).json).toHaveLength(1);
  });
});

describe('avatars API', () => {
  it('imports, processes, saves settings, lists and deletes', async () => {
    c = await createClient();
    const up = await c.req('POST', '/api/avatars?filename=Mannequin.glb', MANNEQUIN, oct);
    expect(up.status).toBe(200);
    expect(up.json).toMatchObject({ name: 'Mannequin', status: 'processing', kind: 'imported' });
    await avatarSettled(up.json.id);
    const d = (await c.req('GET', `/api/avatars/${up.json.id}`)).json;
    expect(d.status).toBe('ready');
    expect(d.model).toMatch(/^\/media\/m_/);
    expect(d.low).toMatch(/^\/media\/m_/);
    expect(d.config.boneMap.hips).toBeTruthy();
    expect(d.info.report.after).toBeLessThan(MANNEQUIN.length);
    const file = await c.req('GET', d.model);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('model/gltf-binary');
    expect(file.raw.subarray(0, 4).toString()).toBe('glTF');

    // Model files stay out of the picture gallery.
    expect((await c.req('GET', '/api/media')).json).toEqual([]);

    // Settings are validated.
    expect((await c.req('PATCH', `/api/avatars/${d.id}`, { config: { ...d.config, facing: 45 } })).status).toBe(400);
    expect((await c.req('PATCH', `/api/avatars/${d.id}`, { config: { ...d.config, boneMap: { tail: 'x' } } })).status).toBe(400);
    const p = await c.req('PATCH', `/api/avatars/${d.id}`, { name: 'Test body', config: { ...d.config, facing: 180, look: 'toon', floor: 0.02 } });
    expect(p.status).toBe(200);
    expect(p.json).toMatchObject({ name: 'Test body', config: { facing: 180, look: 'toon', floor: 0.02 } });

    // Thumbnail.
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#88a' } }).png().toBuffer();
    const t = await c.req('POST', `/api/avatars/${d.id}/thumbnail`, png, { 'content-type': 'image/png' });
    expect(t.json.thumb).toMatch(/^\/media\//);

    // Link to a character, then delete: files go, the link is cleared.
    const ch = (await c.req('POST', '/api/characters', { card: { name: 'Ava', description: 'x' } })).json;
    await c.req('PATCH', `/api/characters/${ch.id}`, { game: { ...(ch.game ?? {}), avatar3d: d.id } });
    expect((await c.req('GET', `/api/characters/${ch.id}`)).json.game.avatar3d).toBe(d.id);
    const del = await c.req('DELETE', `/api/avatars/${d.id}`);
    expect(del.json).toEqual({ ok: true, unlinked: 1 });
    expect((await c.req('GET', `/api/characters/${ch.id}`)).json.game.avatar3d).toBeUndefined();
    expect((await c.req('GET', d.model)).status).toBe(404);
    expect((await c.req('GET', '/api/avatars')).json).toEqual([]);
    const left = c.built.ctx.db.prepare("SELECT COUNT(*) AS n FROM media WHERE kind LIKE 'model%'").get() as { n: number };
    expect(left.n).toBe(0);
  });

  it('refuses non-models and reports a failed conversion when Blender is missing', async () => {
    c = await createClient();
    expect((await c.req('POST', '/api/avatars?filename=x.png', Buffer.from('not a model at all, just bytes, padded to be long enough to look at'), oct)).status).toBe(415);
    const prev = process.env.EVERLOOM_BLENDER;
    process.env.EVERLOOM_BLENDER = '/nonexistent/blender';
    const old = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
      // With no Blender anywhere, an FBX import fails with an explanation (when Blender is truly absent).
      const info = (await c.req('GET', '/api/blender?refresh=1')).json;
      const fbx = Buffer.concat([Buffer.from('Kaydara FBX Binary  \u0000\u001a\u0000'), Buffer.alloc(200)]);
      const up = await c.req('POST', '/api/avatars?filename=a.fbx', fbx, oct);
      expect(up.status).toBe(200);
      await avatarSettled(up.json.id);
      const d = (await c.req('GET', `/api/avatars/${up.json.id}`)).json;
      expect(d.status).toBe('failed');
      if (!info.found) expect(d.error).toMatch(/needs Blender/);
    } finally {
      process.env.PATH = old;
      if (prev === undefined) delete process.env.EVERLOOM_BLENDER;
      else process.env.EVERLOOM_BLENDER = prev;
      await c.req('GET', '/api/blender?refresh=1');
    }
  });

  it('stores motion clips by emote name, validated', async () => {
    c = await createClient();
    const clip = { v: 1, id: 'x', fps: 30, frames: 2, loop: true, tracks: { head: [0, 0, 0, 1, 0, 0.1, 0, 0.995] } };
    expect((await c.req('PUT', '/api/avatar-clips/Bad-Name', { label: 'Bad', category: 'social', clip })).status).toBe(400);
    expect((await c.req('PUT', '/api/avatar-clips/nod_twice', { label: 'Nod', category: 'social', clip: { ...clip, frames: 3 } })).status).toBe(400);
    expect((await c.req('PUT', '/api/avatar-clips/nod_twice', { label: 'Nod twice', category: 'social', clip, source: 'Made in the lab' })).status).toBe(200);
    expect((await c.req('GET', '/api/avatar-clips')).json).toEqual([{ id: 'nod_twice', label: 'Nod twice', category: 'social', source: 'Made in the lab', createdAt: expect.any(Number) }]);
    expect((await c.req('GET', '/api/avatar-clips/nod_twice')).json).toMatchObject({ id: 'nod_twice', frames: 2 });
    await c.req('DELETE', '/api/avatar-clips/nod_twice');
    expect((await c.req('GET', '/api/avatar-clips')).json).toEqual([]);
  });
});

const BLENDER = process.env.EVERLOOM_BLENDER;
describe.skipIf(!BLENDER || !existsSync(BLENDER))('Blender worker', () => {
  it('converts an FBX to an optimized avatar with the same skeleton', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'everloom-fbx-'));
    try {
      const glb = path.join(tmp, 'm.glb');
      const fbx = path.join(tmp, 'm.fbx');
      writeFileSync(glb, MANNEQUIN);
      execFileSync(BLENDER!, ['--background', '--factory-startup', '--python-expr', `import bpy\nbpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.import_scene.gltf(filepath=${JSON.stringify(glb)})\nbpy.ops.export_scene.fbx(filepath=${JSON.stringify(fbx)}, add_leaf_bones=False)`], { stdio: 'ignore', timeout: 120_000 });
      c = await createClient();
      const up = await c.req('POST', '/api/avatars?filename=m.fbx', readFileSync(fbx), oct);
      expect(up.status).toBe(200);
      await waitFor(async () => {
        await avatarSettled(up.json.id);
        return true;
      }, 180_000);
      const d = (await c.req('GET', `/api/avatars/${up.json.id}`)).json;
      expect(d.error).toBeNull();
      expect(d.status).toBe('ready');
      expect(d.info.missingBones).toEqual([]);
      expect(d.info.conversion.bones).toBeGreaterThan(20);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 240_000);
  it('fits a garment mesh to the body: weights, covered regions, a garment model', async () => {
    // A plain tube (a rough sleeveless top) as an OBJ, the kind of mesh an image-to-3D service gives.
    const v: string[] = [];
    const f: string[] = [];
    const R = 24;
    const H = 12;
    for (let j = 0; j <= H; j++) for (let i = 0; i < R; i++) v.push(`v ${(0.3 * Math.cos((i / R) * Math.PI * 2)).toFixed(4)} ${(j / H - 0.5).toFixed(4)} ${(0.3 * Math.sin((i / R) * Math.PI * 2)).toFixed(4)}`);
    for (let j = 0; j < H; j++) for (let i = 0; i < R; i++) {
      const a = j * R + i + 1;
      const b = j * R + ((i + 1) % R) + 1;
      f.push(`f ${a} ${b} ${b + R} ${a + R}`);
    }
    c = await createClient();
    const up = await c.req('POST', '/api/avatars?filename=Mannequin.glb', MANNEQUIN, oct);
    await avatarSettled(up.json.id);
    const r = await c.req('POST', `/api/avatars/${up.json.id}/fit-garment?filename=tube.obj&slot=top&offset=0.008`, Buffer.from([...v, ...f].join('\n')), oct);
    expect(r.status).toBe(200);
    expect(r.json.model).toMatch(/^m_/);
    expect(r.json.hides).toEqual(expect.arrayContaining(['belly', 'chest']));
    expect(r.json.hides).not.toContain('feet');
    const g = parseGlb((await c.req('GET', `/media/${r.json.model}`)).raw);
    expect(g.json.skins?.length).toBeGreaterThan(0);
  }, 240_000);

  it('imports .blend files: alone, zipped with their textures, and as motions; never runs their scripts', async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'everloom-blend-'));
    const marker = path.join(tmp, 'script-ran');
    try {
      const glb = path.join(tmp, 'm.glb');
      writeFileSync(glb, MANNEQUIN);
      mkdirSync(path.join(tmp, 'textures'));
      // A .blend the way people save them: an outside texture in a folder, a camera, a light, an object
      // hidden from render, subdivision, a keyframed action, and a script set to run when it opens.
      const py = [
        'import bpy',
        'bpy.ops.wm.read_factory_settings(use_empty=True)',
        `bpy.ops.import_scene.gltf(filepath=${JSON.stringify(glb)})`,
        'mesh = max((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: len(o.data.vertices))',
        'if not mesh.data.uv_layers: mesh.data.uv_layers.new(name="UVMap")',
        'arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")',
        'img = bpy.data.images.new("SkinTex", 32, 32)',
        `img.filepath_raw = ${JSON.stringify(path.join(tmp, 'textures', 'skin.png'))}`,
        'img.file_format = "PNG"',
        'img.save()',
        'mat = bpy.data.materials.new("Skin"); mat.use_nodes = True',
        'tex = mat.node_tree.nodes.new("ShaderNodeTexImage"); tex.image = img',
        'mat.node_tree.links.new(tex.outputs[0], mat.node_tree.nodes["Principled BSDF"].inputs[0])',
        'mesh.data.materials.clear(); mesh.data.materials.append(mat)',
        'bpy.ops.object.camera_add(); bpy.ops.object.light_add(type="SUN")',
        'bpy.ops.mesh.primitive_cube_add(); bpy.context.object.hide_render = True',
        'if not mesh.data.shape_keys: mesh.modifiers.new("Sub", "SUBSURF")',
        'arm.animation_data_create(); act = bpy.data.actions.new("Wave"); arm.animation_data.action = act',
        'b = arm.pose.bones[0]',
        'b.rotation_mode = "XYZ"; b.rotation_euler = (0, 0, 0); b.keyframe_insert("rotation_euler", frame=1)',
        'b.rotation_euler = (0.6, 0, 0); b.keyframe_insert("rotation_euler", frame=20)',
        `t = bpy.data.texts.new("evil.py"); t.use_module = True; t.write('''open(${JSON.stringify(marker)}, "w").write("x")''')`,
        `bpy.ops.wm.save_as_mainfile(filepath=${JSON.stringify(path.join(tmp, 'model.blend'))}, relative_remap=True)`,
      ].join('\n');
      execFileSync(BLENDER!, ['--background', '--factory-startup', '--python-expr', py], { stdio: 'ignore', timeout: 120_000 });
      const blend = readFileSync(path.join(tmp, 'model.blend'));
      c = await createClient();

      // Alone: the texture is missing, and the report says so (and what was left out).
      const a = await c.req('POST', '/api/avatars?filename=model.blend', blend, oct);
      expect(a.status).toBe(200);
      await avatarSettled(a.json.id);
      const da = (await c.req('GET', `/api/avatars/${a.json.id}`)).json;
      expect(da.error).toBeNull();
      expect(da.status).toBe('ready');
      expect(da.info.missingBones).toEqual([]);
      const codes = da.info.warnings.map((w: any) => w.code);
      expect(codes).toEqual(expect.arrayContaining(['blend_missing_textures', 'blend_skipped']));
      expect(da.info.conversion.blend.skipped).toBeGreaterThanOrEqual(3);

      // Zipped with its texture folder: found.
      const zip = Buffer.from(zipSync({ 'My character/model.blend': new Uint8Array(blend), 'My character/textures/skin.png': new Uint8Array(readFileSync(path.join(tmp, 'textures', 'skin.png'))) }));
      const z = await c.req('POST', '/api/avatars?filename=character.zip', zip, oct);
      expect(z.status).toBe(200);
      await avatarSettled(z.json.id);
      const dz = (await c.req('GET', `/api/avatars/${z.json.id}`)).json;
      expect(dz.status).toBe('ready');
      expect(dz.info.warnings.map((w: any) => w.code)).not.toContain('blend_missing_textures');
      expect(dz.info.textures.length).toBeGreaterThan(0);

      // As a motion: the armature's action comes back as a GLB animation.
      const m = await c.req('POST', '/api/avatar-clips/convert?filename=wave.blend', blend, oct);
      expect(m.status).toBe(200);
      expect(parseGlb(m.raw).json.animations?.length).toBeGreaterThan(0);

      // A zip without a .blend isn't taken for one.
      expect((await c.req('POST', '/api/avatars?filename=x.zip', Buffer.from(zipSync({ 'a.txt': new Uint8Array([1]) })), oct)).status).toBe(415);
      // Nothing in the file ever ran.
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 400_000);

  it('cleans a model up to a triangle budget and renders a turntable; jobs are listed', async () => {
    c = await createClient();
    const up = await c.req('POST', '/api/avatars?filename=Mannequin.glb', MANNEQUIN, oct);
    await avatarSettled(up.json.id);
    const before = (await c.req('GET', `/api/avatars/${up.json.id}`)).json.triangles;
    const r = await c.req('POST', `/api/avatars/${up.json.id}/cleanup`, { maxTriangles: 2000, maxTexture: 512 });
    expect(r.status).toBe(200);
    expect(r.json.trianglesAfter).toBeLessThan(r.json.trianglesBefore);
    await avatarSettled(up.json.id);
    const d = (await c.req('GET', `/api/avatars/${up.json.id}`)).json;
    expect(d.status).toBe('ready');
    expect(d.triangles).toBeLessThan(before);
    const t = await c.req('POST', `/api/avatars/${up.json.id}/turntable`);
    expect(t.status).toBe(200);
    expect(t.json.frames).toBe(8);
    const img = await sharp((await c.req('GET', t.json.url)).raw).metadata();
    expect(img.width).toBe(2048);
    const jobs = (await c.req('GET', '/api/blender/jobs')).json;
    expect(jobs.map((j: any) => j.op)).toEqual(expect.arrayContaining(['optimize', 'render']));
    // Job folders never show in the log (they are masked as <job>).
    expect(jobs.every((j: any) => j.state === 'done' && !/tmp\/blender\//.test(j.log))).toBe(true);
  }, 400_000);
});
