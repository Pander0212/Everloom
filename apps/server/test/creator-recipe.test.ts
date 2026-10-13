import { afterEach, expect, it } from 'vitest';
import { CharacterSpecSchema, HAIR_PARTS } from '@everloom/engine';
import { validateCreatorRecipe } from '../src/services/avatars/creator-recipe.js';
import { createClient, type TestClient } from './helpers.js';
let client: TestClient | undefined;
afterEach(async () => { await client?.close(); });
it('accepts installed choices, drops unsupported sliders/media and excludes anatomy', () => {
  const spec = validateCreatorRecipe({ hair: { front: 'not-installed', color: '#123456' }, body: { sliders: { height: 1, unknown: 1, belly: 1 } }, anatomy: { enabled: true }, clothes: [{ template: 'coat', texture: 'private-media' }] });
  expect(HAIR_PARTS.some(p => p.id === spec.hair.front)).toBe(true);
  expect(spec.hair.color).toBe('#123456');
  expect(spec.body.sliders.unknown).toBeUndefined();
  expect(spec.body.sliders.belly).toBe(0.6);
  expect(spec.clothes[0]?.texture).toBeNull();
  expect(spec.anatomy.enabled).toBe(false);
  expect(CharacterSpecSchema.safeParse(spec).success).toBe(true);
});
it('returns modest cached appearances and keeps minors free of adult features', async () => {
  client = await createClient();
  const input = { name: 'Robin', text: 'A 15-year-old student with dark hair.' };
  const first = await client.req('POST', '/api/avatars/creator-recipe', input);
  expect(first.status).toBe(200);
  expect(first.json.minor).toBe(true);
  expect(first.json.spec.clothes.map((c: any) => c.template)).toEqual(['longsleeve', 'pants', 'shoes']);
  expect(first.json.spec.anatomy.enabled).toBe(false);
  const cached = await client.req('POST', '/api/avatars/creator-recipe', input);
  expect(cached.json.source).toBe('cache');
  expect(cached.json.spec).toEqual(first.json.spec);
});
