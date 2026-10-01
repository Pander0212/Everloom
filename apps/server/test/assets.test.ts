import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { emotionOf } from '../src/services/assets.js';
import { createClient, type TestClient } from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const png = new Uint8Array(PNG);

let c: TestClient | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

describe('asset library', () => {
  it('file names map to emotions', () => {
    expect(emotionOf('happy.png')).toBe('joy');
    expect(emotionOf('Mara_sad.webp')).toBe('sadness');
    expect(emotionOf('neutral.PNG')).toBe('neutral');
    expect(emotionOf('street-at-night.jpg')).toBeNull();
  });

  it('adds, searches, tags, imports a zip with an expression set, and deletes', async () => {
    c = await createClient();
    const oct = { 'content-type': 'application/octet-stream' };
    const a = await c.req('POST', '/api/assets?name=Harbour%20at%20dusk&type=background&tags=sea,evening', PNG, oct);
    expect(a.status).toBe(200);
    expect(a.json).toMatchObject({ name: 'Harbour at dusk', type: 'background', tags: ['sea', 'evening'] });
    expect((await c.req('POST', '/api/assets?name=notes', Buffer.from('just text, not a picture'), oct)).status).toBe(415);

    const zip = Buffer.from(
      zipSync({
        'Mara/happy.png': png,
        'Mara/sad.png': png,
        'Mara/neutral.png': png,
        'backgrounds/street.png': png,
        'icons/lute.png': png,
        'readme.txt': strToU8('hello'),
        '__MACOSX/Mara/._happy.png': png,
      }),
    );
    const imp = await c.req('POST', '/api/assets/zip?name=Pack.zip', zip, { 'content-type': 'application/zip' });
    expect(imp.json).toEqual({ added: 5, skipped: 1, sets: ['Mara'] });

    const all = (await c.req('GET', '/api/assets')).json;
    expect(all.assets).toHaveLength(6);
    expect(all.sets).toEqual([{ name: 'Mara', expressions: { joy: expect.any(String), sadness: expect.any(String), neutral: expect.any(String) } }]);
    expect(all.tags).toEqual(expect.arrayContaining(['sea', 'evening', 'mara']));
    expect((await c.req('GET', '/api/assets?type=background')).json.assets.map((x: any) => x.name).sort()).toEqual(['Harbour at dusk', 'street']);
    expect((await c.req('GET', '/api/assets?type=icon')).json.assets.map((x: any) => x.name)).toEqual(['lute']);
    expect((await c.req('GET', '/api/assets?q=harbour')).json.assets).toHaveLength(1);
    expect((await c.req('GET', '/api/assets?q=mara%20joy')).json.assets.map((x: any) => x.expression)).toEqual(['joy']);

    const patched = await c.req('PATCH', `/api/assets/${a.json.id}`, { name: 'Harbour', tags: ['Sea', 'night'] });
    expect(patched.json).toMatchObject({ name: 'Harbour', tags: ['sea', 'night'] });
    // Shared assets are never "unused" in the media check, and they are served like any picture.
    expect((await c.req('GET', '/api/library/media')).json.integrity.unusedRows).toEqual([]);
    expect((await c.req('GET', a.json.url)).status).toBe(200);

    expect((await c.req('DELETE', `/api/assets/${a.json.id}`)).json.ok).toBe(true);
    expect((await c.req('GET', '/api/assets')).json.assets).toHaveLength(5);
    // Ordinary media can't be deleted through the asset routes.
    const plain = await c.req('POST', '/api/media?kind=upload', PNG, oct);
    expect((await c.req('DELETE', `/api/assets/${plain.json.id}`)).status).toBe(404);
  });
});
