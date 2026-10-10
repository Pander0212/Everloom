/** The minor guard (src/services/minor-guard.ts): no adult switch, and never explicit content on a minor. */
import { AvatarConfigSchema, emptyCardData } from '@everloom/engine';
import sharp from 'sharp';
import { afterEach, expect, it, vi } from 'vitest';
import * as imagegen from '../src/media/imagegen.js';
import { saveImage } from '../src/services/media.js';
import { assertLinkAllowed, describesMinor, hasExplicitContent, REFUSED } from '../src/services/minor-guard.js';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
afterEach(async () => { vi.restoreAllMocks(); await c?.close(); c = null; });

const ownerOf = (t: TestClient) => (t.built.ctx.sys.prepare('SELECT id FROM users WHERE username = ?').get('owner') as { id: string }).id;
/** An avatar with an explicit body slider turned up. */
const explicit = (content: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => AvatarConfigSchema.parse({
  content,
  morphs: { sliders: [{ id: 'anatomy', label: 'Anatomy', group: 'other', plus: ['anatomy'], minus: [], adult: true }], values: { anatomy: 0.6 }, base: null },
  ...extra,
});

it('reads minor ages and child descriptions, and leaves adults and mentions of others alone', () => {
  for (const text of ['a 17-year-old', 'age: 12', 'aged 15', 'a sixteen year old', 'a schoolgirl', 'a little boy', 'she is a child', 'loli', '16歳', '中学生']) expect(describesMinor(text), text).toBe(true);
  for (const text of ['A 25-year-old adventurer', 'a mother with her kid', 'she teaches children', 'age: 30', 'an adult elf, 300 years old', '']) expect(describesMinor(text), text).toBe(false);
  expect(hasExplicitContent(AvatarConfigSchema.parse({}))).toBe(false);
  expect(hasExplicitContent(explicit())).toBe(true);
  expect(hasExplicitContent(AvatarConfigSchema.parse({ skinLayers: [{ id: 'l', name: 'L', kind: 'tattoo', texture: 'x', adult: true }] }))).toBe(true);
});

it('needs no switch or confirmation for an adult, and refuses a minor on the server whatever the app sends', async () => {
  c = await createClient();
  const id = (await c.req('POST', '/api/avatars/code', { name: 'Guard test', recipe: {} })).json.id;
  const patch = (config: unknown) => c!.req('PATCH', `/api/avatars/${id}`, { config });
  // No age, no confirmation, no setting: it simply works, and the avatar is rated adult.
  const ok = await patch(explicit());
  expect(ok.status, ok.body).toBe(200);
  expect(ok.json.config.content.adult).toBe(true);
  expect((await patch(explicit({ age: 30 }))).status).toBe(200);
  // A minor, however the request is made: recorded age, description, or a child body.
  for (const bad of [explicit({ age: 17 }), explicit({ description: 'a 16-year-old student' }), explicit({ description: 'A schoolgirl.' }), explicit({}, { recipe: { body: { age: 'teen' } } })]) {
    const r = await patch(bad);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe(REFUSED);
  }
  // A minor without explicit content is fine.
  expect((await patch(AvatarConfigSchema.parse({ content: { age: 12 } }))).status).toBe(200);
  // Linking a card: refused when the card is a minor and the avatar explicit.
  expect((await patch(explicit())).status).toBe(200);
  const owner = ownerOf(c);
  expect(() => assertLinkAllowed(c!.built.ctx, owner, id, { ...emptyCardData('Child'), description: 'a child' }, { avatar3d: id, age: 10 })).toThrow(REFUSED);
  expect(() => assertLinkAllowed(c!.built.ctx, owner, id, emptyCardData('Adult'), { avatar3d: id, age: 25 })).not.toThrow();
  // Through the API too: a minor card can't take this avatar.
  const card = await c.req('POST', '/api/characters', { card: { name: 'Young', first_mes: 'Hi', description: 'A 14-year-old.' } });
  expect((await c.req('PATCH', `/api/characters/${card.json.id}`, { game: { avatar3d: id } })).status).toBe(400);
  // And an avatar already linked to a minor's card can't become explicit.
  const plain = (await c.req('POST', '/api/avatars/code', { name: 'Plain', recipe: {} })).json.id;
  expect((await c.req('PATCH', `/api/characters/${card.json.id}`, { game: { avatar3d: plain } })).status).toBe(200);
  expect((await c.req('PATCH', `/api/avatars/${plain}`, { config: explicit() })).status).toBe(400);
}, 30000);

it('adult textures need only the provider’s permission, and never go on a minor', async () => {
  c = await createClient();
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#807050' } }).png().toBuffer();
  const generate = vi.spyOn(imagegen, 'generateImage').mockResolvedValue(image);
  const id = (await c.req('POST', '/api/avatars/code', { name: 'Texture guard test', recipe: {} })).json.id;
  const owner = ownerOf(c);
  const texture = await saveImage(c.built.ctx, owner, image, { kind: 'model-texture', meta: { adult: true } });
  const request = { prompt: 'Plain brown fabric', adult: true, avatarId: id };
  const connection = await c.req('POST', '/api/connections', { name: 'Mock image provider', provider: 'img-openai', baseUrl: 'https://example.com/v1', model: 'test', params: {} });
  await c.req('PATCH', '/api/settings', { roles: { image: connection.json.id } });
  // The provider must allow adult images (its terms, not an Everloom switch).
  expect((await c.req('POST', '/api/avatars/texture', request)).status).toBe(403);
  expect(generate).not.toHaveBeenCalled();
  expect((await c.req('PUT', `/api/connections/${connection.json.id}`, { name: 'Mock image provider', provider: 'img-openai', baseUrl: 'https://example.com/v1', model: 'test', params: { allowAdult: true } })).status).toBe(200);
  const made = await c.req('POST', '/api/avatars/texture', request);
  expect(made.status, made.body).toBe(200);
  expect(JSON.parse((c.built.ctx.db.prepare('SELECT meta FROM media WHERE id = ?').get(made.json.id) as { meta: string }).meta).adult).toBe(true);
  // An adult texture on the avatar: fine for an adult, refused for a minor.
  expect((await c.req('PATCH', `/api/avatars/${id}`, { config: AvatarConfigSchema.parse({ materialOverrides: { cloth: { texture: texture.id } } }) })).status).toBe(200);
  expect((await c.req('PATCH', `/api/avatars/${id}`, { config: AvatarConfigSchema.parse({ content: { age: 15 }, materialOverrides: { cloth: { texture: texture.id } } }) })).status).toBe(403);
  // And none is generated for a minor.
  expect((await c.req('PATCH', `/api/avatars/${id}`, { config: AvatarConfigSchema.parse({ content: { age: 15 } }) })).status).toBe(200);
  expect((await c.req('POST', '/api/avatars/texture', request)).status).toBe(403);
  expect(generate).toHaveBeenCalledTimes(1);
}, 30000);
