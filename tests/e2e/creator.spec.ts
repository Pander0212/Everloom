import { api, expect, test } from './fixtures';

test.use({ launchOptions: { ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });
test.beforeEach(({}, info) => test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'The creator runs on two projects'));
test.beforeEach(async ({ page }) => {
  await api(page, 'PATCH', '/api/settings', { features: { preset: 'full' } });
});

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
  await page.getByLabel('Hairstyle', { exact: true }).selectOption({ label: 'Twin tails' });
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
  await page.getByRole('switch', { name: 'Anatomy', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Anatomy', exact: true })).toBeChecked();
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

test('generated anatomy pack retains its internal model through creator save', async ({ page, errors }) => {
  const file = process.env.EVERLOOM_ANATOMY_PACK;
  test.skip(!file, 'Optional generated pack kept outside the repository');
  test.setTimeout(180_000);
  const { readFileSync } = await import('node:fs');
  const { parseGlb } = await import('../../apps/server/src/services/avatars/glb.js');
  await page.goto('/settings/3d');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('anatomy-pack-install').click();
  await (await chooser).setFiles({ name: 'anatomy-pack.zip', mimeType: 'application/zip', buffer: readFileSync(file!) });
  await expect(page.getByText('Everloom parametric anatomy')).toBeVisible();
  await page.goto('/characters/creator');
  await ready(page);
  await page.getByRole('tab', { name: 'Anatomy', exact: true }).click();
  await page.getByRole('switch', { name: 'Anatomy', exact: true }).check();
  await ready(page);
  await page.getByRole('switch', { name: 'Internal anatomy', exact: true }).check();
  await page.getByRole('switch', { name: 'Cutaway view', exact: true }).check();
  await expect(page.getByLabel('Anatomical model')).toHaveValue('');
  await page.getByTestId('creator-save').click();
  await expect(page).toHaveURL(/\/characters\/avatars\/av_/, { timeout: 120_000 });
  const saved = await api(page, 'GET', `/api/avatars/${page.url().split('/').pop()}`);
  expect(saved.config.character.anatomy.genitalShape).toMatchObject({ internal: 1, cutaway: 1 });
  const glb = parseGlb(await (await page.request.get(saved.model)).body());
  expect(glb.json.nodes?.some(n => n.name === 'Anatomy_internal')).toBe(true);
  expect(glb.json.nodes?.some(n => n.name === 'Anatomy_male' || n.name === 'Anatomy_female')).toBe(false);
  await api(page, 'DELETE', '/api/anatomy-pack');
  expect(errors).toEqual([]);
});

test('creator catalogs search, filter, apply parts and retain favourites after reload', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/characters/creator');
  await ready(page);
  await page.getByRole('tab', { name: 'Hair', exact: true }).click();
  const hair = page.getByTestId('creator-catalog-hair');
  await hair.locator('summary').click();
  await hair.getByLabel('Search hairstyles').fill('bob');
  await hair.getByLabel('Filter hairstyles by tag').selectOption('bob');
  await expect(hair.getByRole('button', { name: 'Use Bob', exact: true })).toBeVisible();
  await expect(hair.getByRole('button', { name: 'Use Twin tails', exact: true })).toHaveCount(0);
  await hair.getByRole('button', { name: 'Favourite Bob', exact: true }).click();
  await hair.getByRole('button', { name: 'Use Bob', exact: true }).click();
  await expect(page.getByLabel('Hairstyle', { exact: true })).toHaveValue('bob');
  await page.reload();
  await ready(page);
  await page.getByRole('tab', { name: 'Hair', exact: true }).click();
  await hair.locator('summary').click();
  await hair.getByRole('button', { name: 'Favourites only' }).click();
  await expect(hair.getByRole('button', { name: 'Use Bob', exact: true })).toBeVisible();
  await expect(hair.getByRole('button', { name: /^Use / })).toHaveCount(1);
  await expect(hair.locator('img')).toHaveJSProperty('complete', true);
  await expect(hair.locator('img')).not.toHaveJSProperty('naturalWidth', 0);
  await hair.screenshot({ path: `docs/3d-unity-fix/evidence/catalog-hair-${test.info().project.name}.png` });
  await page.getByRole('tab', { name: 'Clothes', exact: true }).click();
  const clothes = page.getByTestId('creator-catalog-clothes');
  await clothes.locator('summary').click();
  await clothes.getByLabel('Search clothing').fill('dress');
  await clothes.getByRole('button', { name: 'Add Dress', exact: true }).click();
  await expect(page.getByTestId('creator-cloth').last().getByRole('combobox').first()).toHaveValue('dress');
  await clothes.getByLabel('Search clothing').fill('does-not-exist');
  await expect(clothes.getByText('No parts match these filters.')).toBeVisible();
});
