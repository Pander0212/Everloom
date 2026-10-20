/**
 * Character Studio looks in a real browser, with the synthetic template pack (simple shapes):
 * roll and edit a character in the studio, see it in every template; a story character with a
 * look stands on the stage in its pose; the story opens a scene whose options are a choice menu;
 * a new swipe takes the scene away again. With EVIDENCE=1 the frames go to
 * docs/character-studio/evidence/ (procedural shapes only).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { api, expect, mockControl, test } from './fixtures';

test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });
test.beforeEach(({}, info) => test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'WebGL checks run on two projects'));

const phone = () => test.info().project.name.startsWith('phone');
async function shot(page: Page, name: string, testId: string) {
  const dir = process.env.EVIDENCE ? path.resolve('docs/character-studio/evidence') : test.info().outputPath();
  mkdirSync(dir, { recursive: true });
  await page.getByTestId(testId).first().screenshot({ path: path.join(dir, `${name}${phone() ? '-phone' : ''}.png`) });
}
async function installFixture(page: Page) {
  const { fixturePack } = await import('../../tools/studio/fixture-pack');
  const zip = await fixturePack();
  await page.goto('/');
  return page.evaluate(async (b64) => {
    const st = await (await fetch('/api/auth/status')).json();
    const r = await fetch('/api/paperdoll/templates/import', { method: 'POST', body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), headers: { 'content-type': 'application/zip', 'x-csrf-token': st.csrf } });
    return r.json();
  }, zip.toString('base64'));
}

test('the studio: roll, edit and save a look, the same in every template', async ({ page, errors }) => {
  const installed = await installFixture(page);
  expect(installed.map((t: { id: string }) => t.id).sort()).toEqual(['park-bench', 'stand-neutral', 'stand-wave']);
  await page.goto('/characters/looks');
  await page.getByRole('button', { name: 'Random NPC' }).click();
  // A male roll has no female-only template: roll until a female, so the preview has art.
  for (let i = 0; i < 8 && !(await page.getByTestId('looks-preview').count()); i++) await page.getByRole('button', { name: 'Randomize' }).click();
  await expect(page.getByTestId('looks-preview')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await page.getByRole('tab', { name: 'Hair' }).click();
  await page.getByRole('radiogroup', { name: 'Hairstyle' }).getByRole('radio', { name: 'Bob' }).click();
  await page.getByRole('radiogroup', { name: 'Hair colour' }).getByRole('radio', { name: '#c9c9cf' }).click();
  await expect(page.getByTestId('looks-preview')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await shot(page, 'studio-template-1', 'looks-preview');
  await page.getByRole('button', { name: 'Next template' }).click();
  await expect(page.getByTestId('looks-preview')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await shot(page, 'studio-template-2', 'looks-preview');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('looks-list').getByRole('button').filter({ hasText: /\w/ }).first()).toBeVisible();
  // (The projects share one database: find this run's look rather than counting.)
  await expect.poll(async () => (await api(page, 'GET', '/api/paperdoll/characters?perPage=100')).items.some((i: { sheet: { hair: { back: string; color: string } } }) => i.sheet.hair.back === 'bob' && i.sheet.hair.color === '#c9c9cf')).toBe(true);
  expect(errors).toEqual([]);
});

test('a look on the story stage: pose, a scene with a choice menu, rolled back by a swipe', async ({ page, errors }) => {
  await installFixture(page);
  const name = `Lena ${test.info().project.name.replace(/-/g, ' ')}`;
  const ch = await api(page, 'POST', '/api/characters', { card: { name, first_mes: 'Lena waves from the bench.', description: 'A 27-year-old botanist.' } });
  await api(page, 'PATCH', `/api/characters/${ch.id}`, { game: { display: 'looks', age: 27 } });
  const look = await api(page, 'POST', '/api/paperdoll/characters', { characterId: ch.id, sheet: { name, sex: 'female', age: 27, hair: { back: 'long_straight', color: '#a0673a' }, wardrobe: { top: 'tee', bottom: 'skirt' } } });
  expect(look.kind).toBe('story');
  const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
  await page.goto(`/chat/${chat.id}`);
  await page.getByRole('button', { name: 'Switch to stage view' }).click();
  await expect(page.getByTestId('looks-character')).toHaveAttribute('data-template', 'stand-neutral', { timeout: 30_000 });
  await expect(page.getByTestId(`looks-doll-${ch.id}`)).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await shot(page, 'stage-pose', 'looks-stage');
  // The story waves (a pose) …
  const r = await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'studio.pose', who: name, template: 'stand-wave', expression: 'smile' }] });
  expect(r.errors).toEqual([]);
  await page.reload();
  await expect(page.getByTestId('looks-character')).toHaveAttribute('data-template', 'stand-wave', { timeout: 30_000 });
  // … then, through a reply, opens a scene; its options are a choice menu.
  await mockControl({ trackerOps: [{ type: 'studio.scene', template: 'park-bench', who: [name] }] });
  await page.getByLabel('Message', { exact: true }).fill('Shall we sit for a while?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByTestId('looks-scene')).toHaveAttribute('data-template', 'park-bench', { timeout: 30_000 });
  await expect(page.getByTestId('looks-scene-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await page.getByTestId('looks-choices').getByRole('button', { name: /Evening/ }).click();
  await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.studio.scene?.options.time, { timeout: 20_000 }).toBe('evening');
  await expect(page.getByTestId('looks-choices').getByRole('button', { name: /Evening/ })).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'stage-scene-choice', 'looks-scene');
  // A new swipe without the scene takes it away (the state is the message's).
  await mockControl({ trackerOps: [] });
  await page.getByRole('button', { name: 'New version' }).click();
  await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.studio?.scene ?? null, { timeout: 20_000 }).toBeNull();
  await expect(page.getByTestId('looks-scene')).toHaveCount(0, { timeout: 20_000 });
  await mockControl({ trackerOps: null });
  expect(errors).toEqual([]);
});
