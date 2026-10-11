import { api, expect, test } from './fixtures';

test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });
test.beforeEach(({}, info) => test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'The creator runs on two projects'));

const shot = (page: import('@playwright/test').Page, name: string) => page.getByTestId('creator-preview').screenshot({ path: `docs/3d-import/evidence/creator-${name}-${test.info().project.name}.png` });
const ready = (page: import('@playwright/test').Page) => expect(page.getByTestId('creator-preview')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });

test('the character creator: own base, sliders, hair, eyes, makeup, clothes; saved, exported as VRM, and the VRM reloads', async ({ page, errors }, info) => {
  test.setTimeout(240_000);
  const name = `Creator ${info.project.name}`;
  await page.goto('/characters/creator');
  await ready(page);
  await page.getByLabel('Character name').fill(name);
  // Body sliders.
  await page.getByRole('tab', { name: 'Body', exact: true }).click();
  const range = (label: string) => page.locator(`[aria-label="${label}"] [role="slider"]`);
  await range('Breast size').focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
  await range('Hips').focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  // Hair from the hair system.
  await page.getByRole('tab', { name: 'Hair' }).click();
  await page.getByLabel('Hairstyle').selectOption({ label: 'Twin tails' });
  await page.getByLabel('Hair colour').fill('#d06090');
  // Eyes and makeup.
  await page.getByRole('tab', { name: 'Eyes' }).click();
  await page.getByLabel('Iris', { exact: true }).fill('#30a060');
  await page.getByRole('tab', { name: 'Skin & makeup' }).click();
  await page.getByRole('button', { name: 'Skin tone #efcdb6' }).click();
  // Clothes: a dress and shoes on top of the underwear.
  await page.getByRole('tab', { name: 'Clothes' }).click();
  for (const item of ['Dress', 'Shoes']) {
    await page.getByRole('button', { name: 'Add clothing' }).click();
    await page.getByTestId('creator-cloth').last().getByRole('combobox').first().selectOption({ label: item });
  }
  await page.getByLabel('Item 3 pattern').selectOption('dots');
  await page.waitForTimeout(1500);
  await shot(page, 'dressed');
  await page.getByRole('radio', { name: 'Face' }).click();
  await page.waitForTimeout(800);
  await shot(page, 'dressed-face');
  // Anatomy: no unlock step; without the pack it says how to get it.
  await page.getByRole('tab', { name: 'Anatomy' }).click();
  await expect(page.getByTestId('creator-anatomy')).toContainText('anatomy pack');

  // Save: it becomes a 3D avatar with the recipe.
  await page.getByTestId('creator-save').click();
  await expect(page).toHaveURL(/\/characters\/avatars\/av_/, { timeout: 120_000 });
  const id = page.url().split('/').pop()!;
  await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
  const saved = await api(page, 'GET', `/api/avatars/${id}`);
  expect(saved.kind).toBe('character');
  expect(saved.config.character.hair.back).toBe('twintails');
  expect(saved.config.character.body.sliders.breastSize).toBeGreaterThan(0.2);
  await page.getByTestId('avatar-preview').screenshot({ path: `docs/3d-import/evidence/creator-saved-${info.project.name}.png` });

  // Export VRM with the owner's license.
  await page.getByRole('tab', { name: 'Export' }).click();
  const form = page.getByTestId('vrm-license-form');
  await form.locator('summary').click();
  await form.getByLabel('VRM authors').fill('Test Owner');
  await form.getByRole('switch', { name: 'VRM redistribution' }).click({ force: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export VRM' }).click();
  const file = info.outputPath('character.vrm');
  await (await download).saveAs(file);
  // The export reloads: imported back as a new avatar, with its license read from the file.
  await page.goto('/characters/avatars');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('avatar-import').click();
  await (await chooser).setFiles(file);
  await expect(page).toHaveURL(/\/characters\/avatars\/av_/, { timeout: 120_000 });
  await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
  const back = await api(page, 'GET', `/api/avatars/${page.url().split('/').pop()}`);
  expect(back.format).toBe('vrm1');
  await page.getByRole('tab', { name: 'Export' }).click();
  const lic = page.getByTestId('vrm-license');
  await expect(lic).toContainText('Test Owner');
  await expect(lic).toContainText('Redistribution');
  await expect(page.getByTestId('vrm-license-warning')).toHaveCount(0);
  await page.getByTestId('avatar-preview').screenshot({ path: `docs/3d-import/evidence/creator-vrm-reloaded-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test('anatomy: the pack installs like any pack and the Anatomy tab works with no unlock step', async ({ page, errors }) => {
  const { strToU8, zipSync } = await import('fflate');
  const sharp = (await import('sharp')).default;
  // A tiny stand-in pack (no imagery): one shape key the creator skips (wrong size), a grey layer.
  const png = new Uint8Array(await sharp({ create: { width: 16, height: 16, channels: 4, background: '#202020' } }).png().toBuffer());
  const zip = Buffer.from(zipSync({ 'anatomy.json': strToU8(JSON.stringify({ format: 'everloom-anatomy', version: 1, name: 'Test anatomy pack', license: 'CC0', bases: { 'anime-f': { vertices: 4, shapeKeys: { Nipples: 'n.bin' }, layers: { areolaDistance: 'a.png' } } } })), 'n.bin': new Uint8Array(48), 'a.png': png }));
  await page.goto('/settings/3d');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('anatomy-pack-install').click();
  await (await chooser).setFiles({ name: 'anatomy-pack.zip', mimeType: 'application/zip', buffer: zip });
  await expect(page.getByText('Test anatomy pack')).toBeVisible();
  await page.goto('/characters/creator');
  await ready(page);
  await page.getByRole('tab', { name: 'Anatomy' }).click();
  // No confirmation, no setting: the switch is simply there.
  await page.getByRole('switch', { name: 'Anatomy' }).click({ force: true });
  await expect(page.getByRole('slider').first()).toBeVisible();
  await ready(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('creator-save').click();
  await expect(page).toHaveURL(/\/characters\/avatars\/av_/, { timeout: 120_000 });
  const saved = await (await page.request.get(`/api/avatars/${page.url().split('/').pop()}`)).json();
  expect(saved.config.character.anatomy.enabled).toBe(true);
  expect(saved.adult).toBe(true);
  await page.request.delete('/api/anatomy-pack', { headers: { 'x-csrf-token': (await (await page.request.get('/api/auth/status')).json()).csrf } });
  expect(errors).toEqual([]);
});
