import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { expect, test } from './fixtures';

// Software WebGL so the 3D preview renders headless.
test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });

/** Heavy: on two projects, like the other 3D import checks. */
test.beforeEach(({}, info) => test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'Format imports run on two projects'));

const DIR = path.resolve('tests/fixtures/models/formats');
/** The Collada body is kept zipped (4 MB as text); the plain-.dae test unpacks it. */
const bodyDae = () => ({ name: 'body.dae', mimeType: 'model/vnd.collada+xml', buffer: Buffer.from(unzipSync(readFileSync(path.join(DIR, 'body-dae.zip')))['Body Pack/Model/body.dae']!) });

async function pick(page: import('@playwright/test').Page, files: (string | { name: string; mimeType: string; buffer: Buffer })[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('avatar-import').click();
  await (await chooser).setFiles(files.map((f) => (typeof f === 'string' ? path.join(DIR, f) : f)) as never);
}

// Real exporter output (Blender 4.2, from Everloom's CC0 models; tools/avatars/format-fixtures.py)
// and archives made from it.
for (const [label, shot, files] of [
  ['OBJ with its MTL', 'obj', () => ['robot.obj', 'robot.mtl']],
  ['a skinned Collada .dae', 'dae', () => [bodyDae()]],
  ['a .7z holding OBJ+MTL', 'obj-7z', () => ['robot-obj.7z']],
  ['a .zip holding a .dae in folders', 'dae-zip', () => ['body-dae.zip']],
] as const) {
  test(`imports ${label}`, async ({ page, errors }) => {
    await page.goto('/characters/avatars');
    await pick(page, files());
    await expect(page).toHaveURL(/\/characters\/avatars\/av_/, { timeout: 120_000 });
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
    await page.getByTestId('avatar-preview').screenshot({ path: `docs/3d-import/evidence/format-${shot}-${test.info().project.name}.png` });
    expect(errors).toEqual([]);
  });
}

test('password-protected archives and unsupported formats say what to do', async ({ page }) => {
  await page.goto('/characters/avatars');
  const blob = (name: string, text: string) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(text) });
  for (const [file, message] of [
    ['locked.7z', /password-protected/],
    [blob('avatar.vrca', 'UnityFS\0 5.x.x'), /VRChat upload/],
    [blob('bundle.bin', 'UnityFS\0 5.x.x'), /VRChat upload/],
    [blob('figure.cs3o', 'x'), /Clip Studio 3D file/],
    [blob('scene.c4d', 'x'), /project file of another 3D program/],
  ] as const) {
    await pick(page, [file]);
    await expect(page.getByRole('alert')).toContainText(message, { timeout: 30_000 });
  }
});
