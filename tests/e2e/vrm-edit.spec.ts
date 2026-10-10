/**
 * Acceptance item 9: an exported VRM (here Seed-san, a VRM 0.x model under the VRM Public License,
 * standing in for a VRoid Studio export) is edited: a texture, the hair colour and body sliders. Its
 * VRM license is shown, and nothing is blocked: the edits save and it exports again.
 */
import path from 'node:path';
import { api, expect, test } from './fixtures';
import { open, saveAvatar, SWIFTSHADER, upload } from './avatar-helpers';

test.use(SWIFTSHADER);
test.beforeEach(({}, info) => test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'Runs on two projects'));

test('an exported VRM: textures, hair colour and sliders edited, its license shown, nothing blocked', async ({ page, errors }, info) => {
  test.setTimeout(240_000);
  const id = await upload(page, path.resolve('tests/fixtures/models/seed.vrm'), `Seed ${info.project.name}`);
  await open(page, id, 'Export');
  const lic = page.getByTestId('vrm-license');
  await expect(lic).toBeVisible({ timeout: 30_000 });
  await expect(lic).toContainText('Who may use it');
  await expect(lic).toContainText('Sexual use');
  await lic.screenshot({ path: `docs/3d-import/evidence/vrm-license-${info.project.name}.png` });
  // The hair colour.
  await page.getByRole('tab', { name: 'Skin', exact: true }).click();
  await page.getByLabel('Hair', { exact: true }).fill('#c04080');
  // A texture on a material slot (a TGA, converted to PNG on the way).
  await page.getByRole('tab', { name: 'Materials', exact: true }).click();
  const posted = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/media(\?|$)/.test(r.url()));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Color texture' }).click();
  await (await chooser).setFiles(path.resolve('tests/fixtures/textures/quarters.tga'));
  const media = (await (await posted).json()).id as string;
  // A body slider.
  await page.getByRole('tab', { name: 'Body', exact: true }).click();
  const butt = page.getByLabel(/^Butt size (generated |bones )?value$/);
  await butt.fill('0.2');
  await butt.blur();
  await saveAvatar(page);
  const saved = await api(page, 'GET', `/api/avatars/${id}`);
  expect(saved.config.appearance.hair.color).toBe('#c04080');
  expect(JSON.stringify(saved.config.materialOverrides)).toContain(media);
  expect(JSON.stringify([saved.config.bodyShape, saved.config.morphs?.values])).toMatch(/0\.2/);
  await page.getByTestId('avatar-preview').screenshot({ path: `docs/3d-import/evidence/vrm-edited-${info.project.name}.png` });
  // Exporting is not blocked; the export keeps the model's own license.
  await page.getByRole('tab', { name: 'Export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export VRM' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.vrm$/);
  expect(errors).toEqual([]);
});
