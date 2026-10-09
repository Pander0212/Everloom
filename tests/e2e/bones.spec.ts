import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { api, expect, isPhone, test } from './fixtures';

// Software WebGL so the 3D view renders headless.
test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });
test.beforeEach(({}, info) => test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'heavy 3D checks run on two projects'));

const RIG250 = path.resolve('tests/fixtures/avatars/models/rig250.glb');

async function upload(page: Page, file: string, name: string): Promise<string> {
  if (!page.url().startsWith('http')) await page.goto('/');
  const { csrf } = await (await page.request.get('/api/auth/status')).json();
  const r = await page.request.post(`/api/avatars?filename=${encodeURIComponent(`${name}.glb`)}`, { data: readFileSync(file), headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf } });
  const { id } = (await r.json()) as { id: string };
  await expect.poll(async () => (await api(page, 'GET', `/api/avatars/${id}`)).status, { timeout: 60_000 }).toBe('ready');
  return id;
}

test.describe('the Bones tab', () => {
  test('a 250-bone avatar: mapped automatically, reviewed and changed (phone and desktop)', async ({ page, errors }, info) => {
    test.slow();
    const id = await upload(page, RIG250, 'Rig250');
    const a = await api(page, 'GET', `/api/avatars/${id}`);
    // The server mapped it on import: a five-bone spine and the secondary roles.
    expect(a.config.rig.spine).toEqual(['Spine', 'Spine1', 'Spine2', 'Chest', 'Upper_Chest']);
    const roles = (r: string) => a.config.rig.roles.filter((x: { role: string }) => x.role === r);
    expect(roles('breast').map((x: { side: string }) => x.side).sort()).toEqual(['L', 'R']);
    expect(roles('butt')).toHaveLength(2);
    expect(roles('hair')).toHaveLength(30);
    expect(roles('skirt').length).toBeGreaterThanOrEqual(14);
    expect(roles('tail')).toHaveLength(1);

    await page.goto(`/characters/avatars/${id}`);
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    await page.getByRole('tab', { name: 'Bones' }).click();
    await expect(page.getByText('Main bones mapped')).toBeVisible();
    const phone = await isPhone(page);
    if (phone) await page.getByRole('button', { name: /Open the skeleton \(\d+ bones\)/ }).click();
    const tree = page.getByTestId('bone-tree');
    // Every bone is listed (the skeleton as read on import: 245 bones and the nodes above them).
    const total = Number((await page.getByText(/^\d+ bones$/).first().innerText()).split(' ')[0]);
    expect(total).toBeGreaterThanOrEqual(245);
    await expect(tree.getByRole('listbox', { name: 'Bones' }).getByRole('option')).toHaveCount(total);
    // Filter by role, search, select two bones and make them an accessory, on the left.
    await tree.getByLabel('Show').selectOption('tail');
    await expect(tree.getByRole('listbox', { name: 'Bones' }).getByRole('option')).toHaveCount(6);
    await tree.getByLabel('Show').selectOption('all');
    await tree.getByLabel('Search bones').fill('Bracelet');
    await expect(tree.getByRole('listbox', { name: 'Bones' }).getByRole('option')).toHaveCount(2);
    await tree.getByRole('option', { name: /Bracelet\.L/ }).click();
    const panel = page.getByTestId('bone-assign');
    await panel.getByLabel('Assign to').selectOption('accessory');
    await panel.getByLabel('Side').selectOption('L');
    await panel.getByRole('button', { name: 'Assign' }).click();
    await expect(tree.getByRole('option', { name: /Bracelet\.L/ })).toContainText('L Accessory');
    if (process.env.EVIDENCE_3D) await page.screenshot({ path: `docs/3d-import/evidence/bones-${info.project.name}.png`, fullPage: false });
    if (phone) await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    // Test poses, including the shake for the breast and butt physics.
    for (const p of ['T-pose', 'A-pose', 'Squat', 'Shake']) await page.getByRole('radio', { name: p, exact: true }).click();
    // Saved by hand, or already by autosave.
    await page.getByTestId('avatar-save').click({ timeout: 3000 }).catch(() => {});
    await expect.poll(async () => (await api(page, 'GET', `/api/avatars/${id}`)).config.rig.roles.some((r: { role: string; bones: string[]; side: string }) => r.role === 'accessory' && r.bones.includes('Bracelet.L') && r.side === 'L')).toBe(true);
    expect(errors).toEqual([]);
  });
});
