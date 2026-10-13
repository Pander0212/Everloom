import path from 'node:path';
import { api, expect, test } from './fixtures';
import { upload as uploadBase, saveAvatar as saveDraft } from './avatar-helpers';

// Software WebGL so the 3D preview renders headless.
test.use({ launchOptions: { ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });

/** Heavy: on two projects, like the other 3D import checks. */
test.beforeEach(({}, info) => test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'Unity import runs on two projects'));

const DIR = path.resolve('tests/fixtures/unity');

test('a Unity outfit can enter the fitter for another base, follow its morphs and be saved', async ({ page, errors }) => {
  test.setTimeout(240_000);
  const target = await uploadBase(page, path.resolve('tests/fixtures/avatars/models/morph-base.glb'), 'Cross-avatar target');
  await page.goto('/characters/avatars');
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('avatar-import').click();
  await (await chooser).setFiles(path.join(DIR, 'AvaShirt.unitypackage'));
  const sheet = page.getByRole('dialog', { name: 'Import from Unity' });
  await sheet.getByRole('combobox', { name: 'For which avatar' }).selectOption(target);
  await sheet.getByRole('button', { name: 'Fit to this avatar', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/characters/avatars/${target}`));
  const fitter = page.getByTestId('garment-fitter');
  await expect(fitter.getByTestId('fit-confirm')).toBeVisible({ timeout: 60_000 });
  await fitter.getByTestId('fit-confirm').click();
  await expect(fitter.getByTestId('fit-review')).toBeVisible({ timeout: 120_000 });
  const result = await page.evaluate(() => {
    const s = (window as any).__everloomFit;
    return { matched: s.result.stats.matched, morphs: s.result.meshes.reduce((n: number, m: any) => n + m.morphs.length, 0) };
  });
  expect(result.matched).toBeGreaterThan(0);
  expect(result.morphs).toBeGreaterThan(0);
  await fitter.getByRole('button', { name: 'Arms up', exact: true }).click();
  await fitter.getByRole('radio', { name: 'All highest', exact: true }).click();
  await page.getByTestId('avatar-preview').screenshot({ path: `docs/3d-unity-fix/evidence/cross-avatar-fit-${test.info().project.name}.png` });
  await fitter.getByRole('radio', { name: 'As set', exact: true }).click();
  await fitter.getByRole('button', { name: 'Idle', exact: true }).click();
  await fitter.getByTestId('fit-save').click();
  await expect(fitter.getByTestId('fit-open')).toBeVisible({ timeout: 120_000 });
  await saveDraft(page);
  const saved = await api(page, 'GET', `/api/avatars/${target}`);
  expect(saved.config.garments).toHaveLength(1);
  expect(saved.config.garments[0].model).toBeTruthy();
  expect(errors).toEqual([]);
});

test('a pending split avatar finishes automatically when its model package arrives', async ({ page }, info) => {
  test.setTimeout(180_000);
  const { execFileSync } = await import('node:child_process');
  const { mkdirSync } = await import('node:fs');
  const first = info.outputPath('split-prefab.unitypackage'), second = info.outputPath('split-model.unitypackage');
  mkdirSync(path.dirname(first), { recursive: true });
  execFileSync('python3', ['-c', `
import tarfile, sys, io, hashlib
with tarfile.open(sys.argv[1], 'r:gz') as src:
    entries = [(m.name, src.extractfile(m).read()) for m in src.getmembers() if m.isfile()]
paths = {name.split('/')[0]: data.decode() for name, data in entries if name.endswith('/pathname')}
guids = {g: hashlib.sha256(('pending-test:' + g).encode()).hexdigest()[:32] for g in paths}
with tarfile.open(sys.argv[2], 'w:gz') as first, tarfile.open(sys.argv[3], 'w:gz') as second:
    for name, data in entries:
        guid, suffix = name.split('/', 1)
        for old, new in guids.items(): data = data.replace(old.encode(), new.encode())
        if suffix == 'pathname': data = data.replace(b'Assets/', b'Assets/PendingTest/')
        out = second if paths.get(guid, '').lower().endswith('.fbx') else first
        member = tarfile.TarInfo(guids.get(guid, guid) + '/' + suffix); member.size = len(data)
        out.addfile(member, io.BytesIO(data))
`, path.join(DIR, 'Ava.unitypackage'), first, second]);
  await page.goto('/characters/avatars');
  const before = await api(page, 'GET', '/api/avatars');
  const choose = async (file: string) => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('avatar-import').click();
    await (await chooser).setFiles(file);
  };
  await choose(first);
  const sheet = page.getByRole('dialog', { name: 'Import from Unity' });
  await sheet.getByLabel('Import Ava as', { exact: true }).selectOption('avatar', { timeout: 30_000 });
  await expect(sheet.getByRole('button', { name: 'Import the avatar', exact: true })).toBeEnabled({ timeout: 30_000 });
  await sheet.getByRole('button', { name: 'Import the avatar', exact: true }).click();
  await expect(sheet.getByRole('region', { name: 'Pending imports' })).toBeVisible();
  expect((await api(page, 'GET', '/api/unity/pending')).length).toBe(1);
  await page.reload();
  await choose(second);
  // No second import click: the saved request resumes after library indexing.
  await expect(sheet.getByTestId('import-report')).toBeVisible({ timeout: 120_000 });
  await expect.poll(async () => (await api(page, 'GET', '/api/unity/pending')).length).toBe(0);
  expect((await api(page, 'GET', '/api/avatars')).length).toBe(before.length + 1);
});

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
    await expect(sheet.getByRole('checkbox', { name: /Ava.*VRChat avatar descriptor/ })).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
    await sheet.getByText('The package’s license and readme').click();
    await expect(sheet.getByText(/CC0 1\.0/)).toBeVisible();
    await sheet.getByRole('button', { name: 'Import the avatar' }).click();
    const report = sheet.getByTestId('import-report');
    await expect(report).toBeVisible({ timeout: 90_000 });
    await expect(report.getByRole('region', { name: 'Imported' })).toContainText('VRChat avatar descriptor');
    await expect(report.getByRole('region', { name: 'Imported' })).toContainText('5 PhysBones');
    await expect(report.getByRole('region', { name: 'Skipped' })).toContainText('scripts');
    await sheet.getByRole('button', { name: 'Open the avatar' }).click();
    await expect(page).toHaveURL(/\/characters\/avatars\/av_/);
    const id = page.url().split('/').pop()!;
    const ava = await api(page, 'GET', `/api/avatars/${id}`);
    // Unity's humanoid mapping, lip-sync and blink, springs, the hat as a part, the report.
    expect(ava.config.boneMap).toMatchObject({ hips: 'pelvis', spine: '上半身', neck: '首' });
    expect(ava.config.expressionMap.aa[0].morph).toBe('vrc.v_aa');
    expect(ava.config.expressionMap.blink[0].morph).toBe('eyeBlinkLeft');
    expect(ava.config.physics.chains.map((c: { bone: string; kind: string }) => `${c.bone}:${c.kind}`).sort()).toEqual(['Butt_L:butt', 'Butt_R:butt', 'Hair_Back_1:hair', 'breast_l:chest', 'breast_r:chest']);
    expect(ava.config.parts.map((p: { name: string; on: boolean }) => `${p.name}:${p.on}`)).toEqual(expect.arrayContaining(['Hat:false']));
    expect(ava.config.parts.length).toBeGreaterThan(1);
    expect(ava.config.look).toBe('toon');
    expect(ava.config.importReport.thirdParty).toBe(true);
    // A face animation became the "joy" expression; a body animation became a motion clip.
    expect(ava.config.expressionMap.joy.map((m: { morph: string }) => m.morph)).toEqual(['mouthSmileLeft', 'mouthSmileRight']);
    expect((await api(page, 'GET', '/api/avatar-clips')).map((c: { id: string }) => c.id)).toContain('unity_wave');
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
    await expect(sheet.getByRole('checkbox', { name: /Shirt.*Merge Armature/ })).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
    await sheet.getByLabel('For which avatar').selectOption({ label: 'Ava' });
    await sheet.getByRole('button', { name: 'Import the outfit' }).click();
    await expect(sheet.getByTestId('import-report')).toContainText(/bones matched to the avatar/, { timeout: 90_000 });
    const after = await api(page, 'GET', `/api/avatars/${id}`);
    expect(after.config.garments.map((g: { name: string; items: string[] }) => [g.name, g.items])).toEqual([['Shirt', ['Shirt']]]);
    expect(after.config.outfits.map((o: { name: string }) => o.name)).toEqual(['Shirt']);

    // From the avatar's own wardrobe: the outfit goes into the editor's draft and is saved with it.
    await page.goto(`/characters/avatars/${id}`);
    await page.getByRole('tab', { name: 'Wardrobe' }).click();
    chooser = page.waitForEvent('filechooser');
    await page.getByTestId('unity-outfit-drop').getByRole('button', { name: 'Choose files' }).click();
    await (await chooser).setFiles(path.join(DIR, 'AvaShirt.unitypackage'));
    await expect(sheet.getByRole('checkbox', { name: /Shirt/ })).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
    await sheet.getByRole('button', { name: 'Import the outfit' }).click();
    await sheet.getByRole('button', { name: 'Done' }).click({ timeout: 90_000 });
    await page.getByTestId('avatar-save').click();
    await expect.poll(async () => (await api(page, 'GET', `/api/avatars/${id}`)).config.garments.length).toBe(2);
    if (process.env.EVIDENCE_3D) {
      await saveOutfitShot(page, id);
    }
    expect(errors).toEqual([]);
  });

  test('breast and butt physics and the body sliders work through the bone roles (acceptance item 7)', async ({ page, errors }) => {
    test.slow();
    await page.addInitScript(() => localStorage.setItem('everloom:debug3d', '1'));
    await page.goto('/characters/avatars');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('avatar-import').click();
    await (await chooser).setFiles(path.join(DIR, 'Ava.unitypackage'));
    const sheet = page.getByRole('dialog', { name: 'Import from Unity' });
    await sheet.getByRole('button', { name: 'Import the avatar' }).click({ timeout: 30_000 });
    await sheet.getByRole('button', { name: 'Open the avatar' }).click({ timeout: 90_000 });
    await expect(page).toHaveURL(/\/characters\/avatars\/av_/);
    const id = page.url().split('/').pop()!;
    const ava = await api(page, 'GET', `/api/avatars/${id}`);
    // The mapping gave the breast and butt bones their secondary roles.
    const roles = (ava.config.rig.roles as { role: string; bones: string[] }[]).filter((r) => r.role === 'breast' || r.role === 'butt').map((r) => `${r.role}:${r.bones[0]}`).sort();
    expect(roles).toEqual(['breast:breast_l', 'breast:breast_r', 'butt:Butt_L', 'butt:Butt_R']);
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    // Two breast springs and two butt springs.
    expect(await page.evaluate(() => (window as unknown as { __everloomPreview: { avatar: { bodySpringCount: number } } }).__everloomPreview.avatar.bodySpringCount)).toBe(4);
    // They swing: moving the avatar from side to side turns the butt and breast bones away from rest.
    const swing = await page.evaluate(async () => {
      type Q = { angleTo(q: Q): number; clone(): Q };
      const scene = (window as unknown as { __everloomPreview: { model: { scene: { position: { x: number }; getObjectByName(n: string): { quaternion: Q } | undefined } } } }).__everloomPreview.model.scene;
      const bones = ['Butt_L', 'breast_l'].map((n) => scene.getObjectByName(n)!);
      const rest = bones.map((b) => b.quaternion.clone());
      let max = [0, 0];
      for (let i = 0; i < 20; i++) {
        scene.position.x = i % 2 ? 0.25 : -0.25;
        await new Promise((r) => setTimeout(r, 60));
        max = bones.map((b, j) => Math.max(max[j]!, b.quaternion.angleTo(rest[j]!)));
      }
      scene.position.x = 0;
      return max;
    });
    expect(swing[0]).toBeGreaterThan(0.005);
    expect(swing[1]).toBeGreaterThan(0.005);
    // The butt slider scales the mapped butt bones.
    await page.getByRole('tab', { name: 'Body', exact: true }).click();
    const butt = page.getByLabel('Butt size bones value');
    await butt.fill('0.35');
    await butt.blur();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __everloomPreview: { model: { scene: { getObjectByName(n: string): { scale: { x: number } } | undefined } } } }).__everloomPreview.model.scene.getObjectByName('Butt_L')?.scale.x ?? 0), { timeout: 15_000 }).toBeGreaterThan(1.2);
    await page.getByTestId('avatar-preview').screenshot({ path: `docs/3d-import/evidence/unity-body-roles-${test.info().project.name}.png` });
    // Exporting a bought avatar shows its license warning (acceptance item 13).
    await page.getByRole('tab', { name: 'Export' }).click();
    await expect(page.getByTestId('third-party')).toContainText('Third-party asset, personal use');
    await page.getByTestId('third-party').screenshot({ path: `docs/3d-import/evidence/unity-license-warning-${test.info().project.name}.png` });
    expect(errors).toEqual([]);
  });

  test('an extracted folder without .meta files still imports, with its guesses listed', async ({ page, errors }) => {
    test.slow();
    await page.goto('/characters/avatars');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('avatar-import').click();
    const root = path.join(DIR, 'Ava-extracted-nometa/Assets/Ava');
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    // Keep this fallback unresolved even when an earlier test retained the original GUIDs.
    await (await chooser).setFiles(['Ava.fbx', 'Ava.prefab', 'Materials/Body.mat', 'Materials/Hat.mat', 'Textures/Body.png'].map(f => {
      let buffer = readFileSync(path.join(root, f));
      if (/\.(prefab|mat)$/.test(f)) buffer = Buffer.from(buffer.toString().replace(/guid: ([a-f0-9]{32})/g, (_, guid) => `guid: ${createHash('sha256').update('loose-test:' + guid).digest('hex').slice(0, 32)}`));
      return { name: path.basename(f), mimeType: 'application/octet-stream', buffer };
    }));
    const sheet = page.getByRole('dialog', { name: 'Import from Unity' });
    await expect(sheet.getByText(/Some \.meta files are missing/)).toBeVisible({ timeout: 30_000 });
    // The guessed links can be checked and changed before importing.
    await sheet.getByText(/Link missing files/).click();
    await expect(sheet.getByLabel('Ava.prefab → model')).toHaveValue(/.+/);
    await expect(sheet.getByLabel('Body.mat → texture')).toHaveValue(/.+/);
    await sheet.getByRole('button', { name: 'Import the avatar' }).click();
    const report = sheet.getByTestId('import-report');
    await expect(report).toBeVisible({ timeout: 90_000 });
    await expect(report.getByRole('region', { name: 'Guessed links' })).toContainText('Ava.fbx');
    expect(errors).toEqual([]);
  });
});
