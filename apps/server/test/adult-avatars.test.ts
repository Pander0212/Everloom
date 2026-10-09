import { AvatarConfigSchema, emptyCardData } from '@everloom/engine';
import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import * as imagegen from '../src/media/imagegen.js';
import { saveImage } from '../src/services/media.js';
import { assertAdultLink, describesMinor } from '../src/services/avatars/adult.js';
import { createClient, type TestClient } from './helpers.js';
let c: TestClient | null = null;
afterEach(async () => { vi.restoreAllMocks(); await c?.close(); c = null; });
it('identifies stated minor ages and minor descriptions', () => {
  for (const text of ['a 17-year-old', 'age: 12', 'a sixteen year old', 'a schoolgirl', 'a little boy']) expect(describesMinor(text)).toBe(true);
  expect(describesMinor('A 25-year-old adventurer')).toBe(false);
});
it('enforces owner confirmation, age and character descriptions on the server', async () => {
  c = await createClient();
  const created = await c.req('POST', '/api/avatars/code', { name: 'Adult test', recipe: {} });
  expect(created.status).toBe(200);
  const id = created.json.id;
  const config = AvatarConfigSchema.parse({ content: { adult: true, age: 25, confirmedAdult: true } });
  // No setting is needed for adult content (only the online character browser has an 18+ switch);
  // the character's recorded age and description still decide.
  expect((await c.req('PATCH', `/api/avatars/${id}`, { config: { ...config, content: { ...config.content, age: 17 } } })).status).toBe(400);
  expect((await c.req('PATCH', `/api/avatars/${id}`, { config: { ...config, content: { ...config.content, description: 'a 16-year-old student' } } })).status).toBe(400);
  expect((await c.req('PATCH', `/api/avatars/${id}`, { config })).status).toBe(200);
  const owner = (c.built.ctx.sys.prepare('SELECT id FROM users WHERE username = ?').get('owner') as { id: string }).id;
  expect(() => assertAdultLink(c!.built.ctx, owner, id, { ...emptyCardData('Child'), description: 'a child' }, { avatar3d: id, age: 10 })).toThrow(/minor/);
  await c.req('PATCH', '/api/settings', { library: { nsfw: false } });
  expect(() => assertAdultLink(c!.built.ctx, owner, id, emptyCardData('Adult'), { avatar3d: id, age: 25 })).not.toThrow();
}, 30000);

it('requires adult eligibility and provider permission before generating or reusing adult textures', async () => {
  c = await createClient();
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#807050' } }).png().toBuffer();
  const generate = vi.spyOn(imagegen, 'generateImage').mockResolvedValue(image);
  const id = (await c.req('POST', '/api/avatars/code', { name: 'Texture guard test', recipe: {} })).json.id;
  const owner = (c.built.ctx.sys.prepare('SELECT id FROM users WHERE username = ?').get('owner') as { id: string }).id;
  const texture = await saveImage(c.built.ctx, owner, image, { kind: 'model-texture', meta: { adult: true } });
  const request = { prompt: 'Plain brown fabric', adult: true, avatarId: id };
  expect((await c.req('POST', '/api/avatars/texture', request)).status).toBe(403);
  expect((await c.req('POST', '/api/avatars/texture', { prompt: request.prompt, base: texture.id, avatarId: id })).status).toBe(403);
  expect((await c.req('PATCH', `/api/avatars/${id}`, { config: AvatarConfigSchema.parse({ materialOverrides: { cloth: { texture: texture.id } } }) })).status).toBe(403);
  await c.req('PATCH', '/api/settings', { library: { nsfw: true, adultConfirmed: true } });
  const config = AvatarConfigSchema.parse({ content: { adult: true, age: 25, confirmedAdult: true } });
  expect((await c.req('PATCH', `/api/avatars/${id}`, { config })).status).toBe(200);
  const connection = await c.req('POST', '/api/connections', { name: 'Mock image provider', provider: 'img-openai', baseUrl: 'https://example.com/v1', model: 'test', params: {} });
  expect(connection.status).toBe(200);
  await c.req('PATCH', '/api/settings', { roles: { image: connection.json.id } });
  expect((await c.req('POST', '/api/avatars/texture', request)).status).toBe(403);
  expect(generate).not.toHaveBeenCalled();
  // Connections are saved whole (PUT), as the settings screen does.
  expect((await c.req('PUT', `/api/connections/${connection.json.id}`, { name: 'Mock image provider', provider: 'img-openai', baseUrl: 'https://example.com/v1', model: 'test', params: { allowAdult: true } })).status).toBe(200);
  const result = await c.req('POST', '/api/avatars/texture', request);
  expect(result.status).toBe(200);
  expect(generate).toHaveBeenCalledTimes(1);
  const row = c.built.ctx.db.prepare('SELECT meta FROM media WHERE id = ?').get(result.json.id) as { meta: string };
  expect(JSON.parse(row.meta).adult).toBe(true);
  // The online browser's 18+ switch doesn't affect the character editor.
  await c.req('PATCH', '/api/settings', { library: { nsfw: false } });
  expect((await c.req('POST', '/api/avatars/texture', request)).status).toBe(200);
}, 30000);
