import path from 'node:path';
import { readFileSync } from 'node:fs';
import { api, expect, test } from './fixtures';

test.use({ launchOptions: { ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });
test.beforeEach(({}, info) => test.skip(info.project.name !== 'phone-390-light', 'Phone 3D acceptance'));

test('a persona appears in 3D and NPC appearances respect off, ask and automatic modes', async ({ page, errors }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await api(page, 'PATCH', '/api/settings', { features: { preset: 'full' } });
  const { csrf } = await (await page.request.get('/api/auth/status')).json();
  const uploaded = await page.request.post('/api/avatars?filename=mannequin.glb&name=Stage%20persona', {
    headers: { 'x-csrf-token': csrf, 'content-type': 'application/octet-stream' },
    data: readFileSync(path.resolve('tests/fixtures/avatars/models/mannequin-m.glb')),
  });
  expect(uploaded.ok()).toBe(true);
  const avatar = await uploaded.json();
  await expect.poll(async () => (await api(page, 'GET', `/api/avatars/${avatar.id}`)).status, { timeout: 60_000 }).toBe('ready');
  const persona = await api(page, 'POST', '/api/personas', { name: 'Stage Player', age: 30, data: { avatar3d: avatar.id } });
  const character = await api(page, 'POST', '/api/characters', { card: { name: 'Stage Host', first_mes: 'Welcome to the workshop.' } });
  const chat = await api(page, 'POST', '/api/chats', { characterId: character.id, personaId: persona.id });
  await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [
    { type: 'npc.upsert', name: 'Mara Catalog', age: 28, appearance: 'A woman with a bob hairstyle wearing a jacket and trousers.' },
    { type: 'stage.layer', character: 'Mara Catalog', position: 'left' },
  ] });
  const recipes: Array<{ source: string }> = [];
  page.on('response', response => { if (response.url().endsWith('/api/avatars/creator-recipe') && response.ok()) void response.json().then(value => recipes.push(value)); });
  const mode = async (npcLooks: 'off' | 'ask' | 'automatic') => {
    await page.evaluate(npcLooks => localStorage.setItem('everloom:3d', JSON.stringify({ npcLooks, spritesOnly: false, codeNpcs: false })), npcLooks);
    await page.goto(`/chat/${chat.id}`);
    await expect(page.getByRole('button', { name: /Switch to (stage|chat) view/ })).toBeVisible();
    const switcher = page.getByRole('button', { name: 'Switch to stage view' });
    if (await switcher.isVisible()) await switcher.click();
    await expect(page.getByTestId('stage-3d')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    await expect(page.getByTestId('stage-3d')).toHaveAttribute('data-avatars', new RegExp(persona.id));
  };
  await mode('off');
  await expect(page.getByRole('button', { name: 'Create 3D look for Mara Catalog' })).toHaveCount(0);
  await expect(page.getByTestId('stage-3d')).not.toHaveAttribute('data-avatars', /npc:/);
  expect(recipes).toHaveLength(0);
  await mode('ask');
  await page.getByRole('button', { name: 'Create 3D look for Mara Catalog' }).click();
  await expect(page.getByTestId('stage-3d')).toHaveAttribute('data-avatars', /npc:/, { timeout: 60_000 });
  expect(recipes).toHaveLength(1);
  await mode('automatic');
  await expect(page.getByRole('button', { name: 'Create 3D look for Mara Catalog' })).toHaveCount(0);
  await expect(page.getByTestId('stage-3d')).toHaveAttribute('data-avatars', /npc:/, { timeout: 60_000 });
  await expect.poll(() => recipes.length).toBe(2);
  expect(recipes[1]!.source).toBe('cache');
  await page.getByTestId('stage-3d').screenshot({ path: 'docs/3d-unity-fix/evidence/persona-npc-phone.png' });
  expect(errors).toEqual([]);
});
