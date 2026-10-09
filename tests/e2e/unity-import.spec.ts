import path from 'node:path';
import { api, expect, test } from './fixtures';

// Software WebGL so the 3D preview renders headless.
test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });

/** Heavy: on two projects, like the other 3D import checks. */
test.beforeEach(({}, info) => test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'Unity import runs on two projects'));

const DIR = path.resolve('tests/fixtures/unity');

/** Wears the imported outfit in the editor's wardrobe and saves a picture. */
async function saveOutfitShot(page: import('@playwright/test').Page, id: string) {
  await page.goto(`/characters/avatars/${id}`);
  await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await page.getByRole('tab', { name: 'Wardrobe' }).click();
  const shirt = page.getByRole('tabpanel').getByText('Shirt').first();
  if (await shirt.isVisible().catch(() => false)) await shirt.click();
  await page.waitForTimeout(2500);
  await page.getByTestId('avatar-preview').screenshot({ path: `docs/3d-import/evidence/unity-outfit-${test.info().project.name}.png` });
}

test.describe('Unity packages', () => {
  test('a VRChat-style avatar package, then an outfit package made for it', async ({ page, errors }) => {
    test.slow();
    await page.goto('/characters/avatars');
    let chooser = page.waitForEvent('filechooser');
    await page.getByTestId('avatar-import').click();
    await (await chooser).setFiles(path.join(DIR, 'Ava.unitypackage'));
    const sheet = page.getByRole('dialog', { name: 'Import from Unity' });
    await expect(sheet.getByRole('radio', { name: /Ava.*VRChat avatar descriptor/ })).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
    await sheet.getByText('The package’s license and readme').click();
    await expect(sheet.getByText(/CC0 1\.0/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Import the avatar' }).click();
    const report = sheet.getByTestId('import-report');
    await expect(report).toBeVisible({ timeout: 90_000 });
    await expect(report.getByRole('region', { name: 'Imported' })).toContainText('VRChat avatar descriptor');
    await expect(report.getByRole('region', { name: 'Imported' })).toContainText('3 PhysBones');
    await expect(report.getByRole('region', { name: 'Skipped' })).toContainText('scripts');
    await sheet.getByRole('button', { name: 'Open the avatar' }).click();
    await expect(page).toHaveURL(/\/characters\/avatars\/av_/);
    const id = page.url().split('/').pop()!;
    const ava = await api(page, 'GET', `/api/avatars/${id}`);
    // Unity's humanoid mapping, lip-sync and blink, springs, the hat as a part, the report.
    expect(ava.config.boneMap).toMatchObject({ hips: 'pelvis', spine: '上半身', neck: '首' });
    expect(ava.config.expressionMap.aa[0].morph).toBe('vrc.v_aa');
    expect(ava.config.expressionMap.blink[0].morph).toBe('eyeBlinkLeft');
    expect(ava.config.physics.chains.map((c: { bone: string; kind: string }) => `${c.bone}:${c.kind}`).sort()).toEqual(['Hair_Back_1:hair', 'breast_l:chest', 'breast_r:chest']);
    expect(ava.config.parts.map((p: { name: string; on: boolean }) => `${p.name}:${p.on}`)).toEqual(['Hat:false']);
    expect(ava.config.look).toBe('toon');
    expect(ava.config.importReport.thirdParty).toBe(true);
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    // Evidence for docs/3d-import/evidence (EVIDENCE_3D=1).
    if (process.env.EVIDENCE_3D) {
      await page.waitForTimeout(1500);
      await page.getByTestId('avatar-preview').screenshot({ path: `docs/3d-import/evidence/unity-avatar-${test.info().project.name}.png` });
    }

    // The shirt package, for that avatar: a garment and an outfit the inventory can put on.
    await page.goto('/characters/avatars');
    chooser = page.waitForEvent('filechooser');
    await page.getByTestId('avatar-import').click();
    await (await chooser).setFiles(path.join(DIR, 'AvaShirt.unitypackage'));
    await expect(sheet.getByRole('radio', { name: /Shirt.*Merge Armature/ })).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
    await sheet.getByLabel('For which avatar').selectOption({ label: 'Ava' });
    await sheet.getByRole('button', { name: 'Import the outfit' }).click();
    await expect(sheet.getByTestId('import-report')).toContainText(/bones matched to the avatar/, { timeout: 90_000 });
    const after = await api(page, 'GET', `/api/avatars/${id}`);
    expect(after.config.garments.map((g: { name: string; items: string[] }) => [g.name, g.items])).toEqual([['Shirt', ['Shirt']]]);
    expect(after.config.outfits.map((o: { name: string }) => o.name)).toEqual(['Shirt']);
    if (process.env.EVIDENCE_3D) {
      await saveOutfitShot(page, id);
    }
    expect(errors).toEqual([]);
  });

  test('an extracted folder without .meta files still imports, with its guesses listed', async ({ page, errors }) => {
    test.slow();
    await page.goto('/characters/avatars');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('avatar-import').click();
    const root = path.join(DIR, 'Ava-extracted-nometa/Assets/Ava');
    await (await chooser).setFiles(['Ava.fbx', 'Ava.prefab', 'Materials/Body.mat', 'Materials/Hat.mat', 'Textures/Body.png'].map((f) => path.join(root, f)));
    const sheet = page.getByRole('dialog', { name: 'Import from Unity' });
    await expect(sheet.getByText(/Some \.meta files are missing/)).toBeVisible({ timeout: 30_000 });
    await sheet.getByRole('button', { name: 'Import the avatar' }).click();
    const report = sheet.getByTestId('import-report');
    await expect(report).toBeVisible({ timeout: 90_000 });
    await expect(report.getByRole('region', { name: 'Guessed links' })).toContainText('Ava.fbx');
    expect(errors).toEqual([]);
  });
});
