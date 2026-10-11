import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { api, expect, test } from './fixtures';

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

// MMD motion and pose without their model: a standard MMD skeleton stands in.
for (const [file, label, tracks] of [
  ['wave.vmd', 'VMD motion', ['leftUpperArm', 'leftLowerArm']],
  ['hands-up.vpd', 'VPD pose', ['leftUpperArm', 'rightUpperArm', 'leftLowerArm']],
] as const) {
  test(`imports a ${label} as an emote in this browser`, async ({ page, errors }) => {
    let converts = 0;
    page.on('request', (r) => { if (/avatar-clips\/convert/.test(r.url())) converts++; });
    await page.goto('/settings/3d');
    await page.getByTestId('clip-import').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a motion file' }).click();
    await (await chooser).setFiles(path.resolve('tests/fixtures/avatars/motions', file));
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    await page.waitForTimeout(file.endsWith('.vmd') ? 700 : 1500);
    await page.getByTestId('avatar-preview').screenshot({ path: `docs/3d-import/evidence/format-${file.replace(/\W+/g, '-')}-${test.info().project.name}.png` });
    const id = `${file.split('.')[0]!.replace(/-/g, '_')}_${test.info().project.name.replace(/[^a-z0-9]/g, '_')}`.slice(0, 40);
    await page.getByLabel('Emote id').fill(id);
    await page.getByTestId('clip-save').click();
    await expect(page.getByTestId('clip-list')).toContainText(id.slice(0, 12));
    const clip = await api(page, 'GET', `/api/avatar-clips/${id}`);
    expect(Object.keys(clip.tracks)).toEqual(expect.arrayContaining([...tracks]));
    await api(page, 'DELETE', `/api/avatar-clips/${id}`);
    expect(converts).toBe(0);
    expect(errors).toEqual([]);
  });
}

test('a lone Unity .anim says how to bring it in', async ({ page }) => {
  await page.goto('/settings/3d');
  await page.getByTestId('clip-import').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a motion file' }).click();
  await (await chooser).setFiles({ name: 'Wave.anim', mimeType: 'text/plain', buffer: Buffer.from('%YAML 1.1\n--- !u!74 &7400000\nAnimationClip:\n  m_Name: Wave\n') });
  await expect(page.getByText(/Wave\.anim is a Unity animation/)).toBeVisible();
});

// Textures: each format becomes a PNG with the right colours, orientation and transparency.
test('Materials takes TGA, PSD, DDS and KTX2 textures as PNG', async ({ page, errors }) => {
  const { upload: uploadModel, open } = await import('./avatar-helpers');
  const id = await uploadModel(page, path.resolve('tests/fixtures/avatars/models/morph-base.glb'), `Textures ${test.info().project.name}`);
  await open(page, id, 'Materials');
  for (const ext of ['tga', 'psd', 'dds', 'ktx2']) {
    const posted = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/media(\?|$)/.test(r.url()));
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Color texture' }).click();
    await (await chooser).setFiles(path.resolve('tests/fixtures/textures', `quarters.${ext}`));
    const media = await (await posted).json();
    // Read back the stored image: one pixel from the middle of each quarter.
    const px = await page.evaluate(async (mid) => {
      const img = await createImageBitmap(await (await fetch(`/media/${mid}`)).blob());
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      return { size: [img.width, img.height], q: [[16, 16], [48, 16], [16, 48], [48, 48]].map(([x, y]) => [...g.getImageData(x!, y!, 1, 1).data]) };
    }, media.id);
    expect(px.size, ext).toEqual([64, 64]);
    const want = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 128]];
    px.q.forEach((p, i) => p.forEach((v, k) => expect(Math.abs(v - want[i]![k]!), `${ext} quarter ${i} channel ${k}: ${p}`).toBeLessThanOrEqual(ext === 'ktx2' ? 12 : 3)));
  }
  await expect(page.getByTestId('material-editor').getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a model whose material points at a TGA or DDS texture keeps it', async ({ page, errors }) => {
  const mtl = readFileSync(path.join(DIR, 'robot.mtl'), 'utf8').replace(/(newmtl Grey\n)/, '$1map_Kd textures/quarters.tga\n').replace(/(newmtl Black\n)/, '$1map_Kd quarters.dds\n');
  const buf = (name: string, file: string) => ({ name, mimeType: 'application/octet-stream', buffer: readFileSync(file) });
  await page.goto('/characters/avatars');
  await pick(page, [buf('robot.obj', path.join(DIR, 'robot.obj')), { name: 'robot.mtl', mimeType: 'text/plain', buffer: Buffer.from(mtl) }, ...['tga', 'dds'].map((x) => buf(`quarters.${x}`, path.resolve('tests/fixtures/textures', `quarters.${x}`)))]);
  await expect(page).toHaveURL(/\/characters\/avatars\/av_/, { timeout: 120_000 });
  // Both materials keep their texture in the stored model (the two are the same picture, so the
  // server's optimizer may store it once).
  const detail = await api(page, 'GET', `/api/avatars/${page.url().split('/').pop()}`);
  const images = await page.evaluate(async (url) => {
    const b = new DataView(await (await fetch(url)).arrayBuffer());
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(b.buffer, 20, b.getUint32(12, true))));
    return (json.materials ?? []).filter((m: { pbrMetallicRoughness?: { baseColorTexture?: unknown } }) => m.pbrMetallicRoughness?.baseColorTexture).map((m: { name: string }) => m.name).sort() as string[];
  }, detail.model);
  expect(images).toEqual(expect.arrayContaining(['Black', 'Grey']));
  await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
  await expect(page.getByText(/Imported without/)).toHaveCount(0);
  await page.getByTestId('avatar-preview').screenshot({ path: `docs/3d-import/evidence/format-obj-tga-dds-${test.info().project.name}.png` });
  expect(errors).toEqual([]);
});
