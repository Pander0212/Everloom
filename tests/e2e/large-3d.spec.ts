import { existsSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const file = process.env.EVERLOOM_LARGE_UNITY;
const blend = process.env.EVERLOOM_LARGE_BLEND;
test.use({ launchOptions: { ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });
test('large Unity upload resumes after a phone disconnect and imports the complete avatar', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone-390-light' || !file || !existsSync(file), 'Optional generated large package');
  test.setTimeout(900_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 4 * 1024 ** 2, uploadThroughput: 4 * 1024 ** 2 });
  let interrupted = false;
  const offsets: number[] = [];
  await page.route('**/api/unity/uploads/*?offset=*', async route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    offsets.push(offset);
    if (!interrupted && offset >= 64 * 1024 ** 2) { interrupted = true; await route.abort('internetdisconnected'); }
    else await route.continue();
  });
  const choose = async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('avatar-import').click();
    await (await chooser).setFiles(file!);
  };
  await page.goto('/characters/avatars');
  await choose();
  const sheet = page.getByRole('dialog', { name: 'Import from Unity' });
  await expect(sheet.getByRole('alert')).toBeVisible({ timeout: 120_000 });
  expect(interrupted).toBe(true);
  const count = offsets.length;
  await page.reload();
  await choose();
  await expect(sheet.getByRole('checkbox', { name: /Ava.*VRChat/ })).toHaveAttribute('aria-checked', 'true', { timeout: 600_000 });
  expect(offsets[count]).toBeGreaterThanOrEqual(64 * 1024 ** 2);
  await sheet.screenshot({ path: path.resolve('docs/3d-unity-fix/evidence/large-upload-phone.png') });
  await sheet.getByRole('button', { name: 'Import the avatar' }).click();
  await expect(sheet.getByTestId('import-report')).toBeVisible({ timeout: 120_000 });
  await sheet.getByRole('button', { name: 'Open the avatar' }).click();
  await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
  await page.screenshot({ path: path.resolve('docs/3d-unity-fix/evidence/large-import-phone.png') });
});

test('large Blend upload resumes after a phone disconnect and retains the conversion report', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'phone-390-light' || !blend || !existsSync(blend), 'Optional owner Blend file and Blender installation');
  test.setTimeout(900_000);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 4 * 1024 ** 2, uploadThroughput: 4 * 1024 ** 2 });
  let interrupted = false;
  const offsets: number[] = [];
  await page.route('**/api/unity/uploads/*?offset=*', async route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    offsets.push(offset);
    if (!interrupted && offset >= 16 * 1024 ** 2) { interrupted = true; await route.abort('internetdisconnected'); }
    else await route.continue();
  });
  const choose = async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('avatar-import').click();
    await (await chooser).setFiles(blend!);
  };
  await page.goto('/characters/avatars');
  await choose();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 120_000 });
  expect(interrupted).toBe(true);
  const count = offsets.length;
  await page.reload();
  await choose();
  await expect(page).toHaveURL(/\/characters\/avatars\/av_/, { timeout: 600_000 });
  expect(offsets[count]).toBeGreaterThanOrEqual(16 * 1024 ** 2);
  const id = page.url().split('/').pop();
  await expect.poll(async () => (await (await page.request.get(`/api/avatars/${id}`)).json()).status, { timeout: 120_000 }).toBe('ready');
  const saved = await (await page.request.get(`/api/avatars/${id}`)).json();
  expect(saved.info.conversion.blender).toMatch(/^5\.2\./);
  expect(saved.info.conversion.validation).toBeTruthy();
  expect(saved.info.missingBones).toEqual([]);
  // Owner model screenshots and generated files deliberately stay out of repository evidence.
});
