import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

// A tiny valid WAV header plus silence.
function wav(): Buffer {
  const data = Buffer.alloc(800);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

describe('reference voices', () => {
  it('need a consent confirmation, are listed apart from presets, and can be removed', async () => {
    c = await createClient();
    const data = wav().toString('base64');
    expect((await c.req('POST', '/api/voices', { name: 'Me', data })).status).toBe(400);
    expect((await c.req('POST', '/api/voices', { name: 'Me', data, consent: false })).status).toBe(400);
    const v = await c.req('POST', '/api/voices', { name: 'Me', data, consent: true });
    expect(v.status).toBe(200);
    const list = (await c.req('GET', '/api/voices')).json;
    expect(list).toEqual([expect.objectContaining({ id: v.json.id, name: 'Me', consentAt: expect.any(Number) })]);
    // Not a gallery image: a separate kind.
    const row = c.built.ctx.db.prepare('SELECT kind, meta FROM media WHERE id = ?').get(v.json.id) as { kind: string; meta: string };
    expect(row.kind).toBe('voice-ref');
    expect(JSON.parse(row.meta).consent.statement).toMatch(/my own voice/);
    expect((await c.req('POST', '/api/voices', { name: 'Img', data: Buffer.from('not audio at all, just some text that is long enough to pass the size check '.repeat(3)).toString('base64'), consent: true })).status).toBe(415);
    await c.req('DELETE', `/api/voices/${v.json.id}`);
    expect((await c.req('GET', '/api/voices')).json).toEqual([]);
  });
});

describe('Live2D', () => {
  it('ships no core; accepts only a Cubism Core upload; serves it and models only to the owner', async () => {
    c = await createClient();
    expect((await c.req('GET', '/api/live2d')).json).toMatchObject({ coreInstalled: false, coreUrl: null });
    expect((await c.req('GET', '/api/live2d/core.js')).status).toBe(404);
    expect((await c.req('POST', '/api/live2d/core', { source: 'console.log(1);'.repeat(100) })).status).toBe(400);
    const core = `var Live2DCubismCore;(function(){/* test stand-in */})();${' '.repeat(1200)}`;
    expect((await c.req('POST', '/api/live2d/core', { source: core })).json.coreInstalled).toBe(true);
    const js = await c.req('GET', '/api/live2d/core.js');
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.body).toContain('Live2DCubismCore');

    const ch = (await c.req('POST', '/api/characters', { card: { name: 'Hiyori' } })).json;
    const zip = zipSync({ 'hiyori/hiyori.model3.json': strToU8('{"Version":3}'), 'hiyori/hiyori.moc3': new Uint8Array([1, 2, 3]), 'hiyori/tex.png': new Uint8Array([137, 80]), 'hiyori/run.sh': strToU8('rm -rf /') });
    const up = await c.req('POST', `/api/live2d/models/${ch.id}`, { zip: Buffer.from(zip).toString('base64') });
    expect(up.json.model).toBe(`/api/live2d/models/${ch.id}/hiyori/hiyori.model3.json`);
    expect((await c.req('GET', up.json.model)).json).toEqual({ Version: 3 });
    expect((await c.req('GET', `/api/live2d/models/${ch.id}/hiyori/run.sh`)).status).toBe(404); // only model files are kept
    expect((await c.req('GET', `/api/live2d/models/${ch.id}/..%2F..%2Fcore.js`)).status).toBe(404);
    expect((await c.req('GET', '/api/live2d')).json.models[ch.id]).toBe(up.json.model);
    const bad = zipSync({ 'x.txt': strToU8('hi') });
    expect((await c.req('POST', `/api/live2d/models/${ch.id}`, { zip: Buffer.from(bad).toString('base64') })).status).toBe(400);
    await c.req('DELETE', '/api/live2d/core');
    expect((await c.req('GET', '/api/live2d')).json.coreInstalled).toBe(false);
  });
});
