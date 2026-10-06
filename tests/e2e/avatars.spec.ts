import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { api, expect, test } from './fixtures';

const MODEL = path.resolve('tests/fixtures/avatars/models/mannequin-m.glb');

/** Every request for 3D code or 3D files. */
function watch3d(page: Page) {
  const hits: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/\/assets\/3d-|\/three\/basis\/|\/avatar\/clips\//.test(u)) hits.push(u);
  });
  return hits;
}

async function uploadAvatar(page: Page, name: string): Promise<string> {
  if (!page.url().startsWith('http')) await page.goto('/');
  const id = await page.evaluate(
    async ([b64, name]) => {
      const status = await (await fetch('/api/auth/status')).json();
      const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
      const r = await fetch(`/api/avatars?filename=${encodeURIComponent(`${name}.glb`)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': status.csrf }, body: bytes });
      return (await r.json()).id as string;
    },
    [readFileSync(MODEL).toString('base64'), name] as const,
  );
  await expect.poll(async () => (await api(page, 'GET', `/api/avatars/${id}`)).status, { timeout: 30_000 }).toBe('ready');
  return id;
}

test.describe('3D characters', () => {
  test('import through the wizard: checks, settings, picture', async ({ page, errors }) => {
    await page.goto('/characters/avatars');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('avatar-import').click();
    await (await chooser).setFiles(MODEL);
    await expect(page).toHaveURL(/\/characters\/avatars\/av_/);
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 45_000 });
    for (const pose of ['T-pose', 'Arms up', 'Squat', 'Right hand up', 'Idle']) await page.getByRole('radio', { name: pose }).click();
    await page.getByRole('tab', { name: 'Bones' }).click();
    await expect(page.getByText('All main bones are mapped')).toBeVisible();
    await page.getByRole('tab', { name: 'Fit' }).click();
    const toon = page.getByRole('radio', { name: 'Anime (toon)' });
    await toon.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await toon.click();
    await page.getByTestId('avatar-save').click();
    await expect(page.getByTestId('avatar-save')).toBeDisabled();
    await page.getByRole('tab', { name: 'Optimize' }).click();
    await expect(page.getByTestId('avatar-report')).toContainText('Optimized');
    await page.getByRole('tab', { name: 'Details' }).click();
    const pic = page.getByRole('button', { name: 'Take picture' });
    await pic.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await pic.click();
    await page.goto('/characters/avatars');
    await expect(page.getByTestId('avatar-list').locator('img').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a character with an avatar is 3D on the stage; emotes play; pictures when 3D is off here', async ({ page, errors }) => {
    const avatar = await uploadAvatar(page, 'Stage body');
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Rook Ashby', first_mes: 'Rook waves. "Over here!"' } });
    await api(page, 'PATCH', `/api/characters/${ch.id}`, { game: { avatar3d: avatar, display: 'auto' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
    await page.goto(`/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Switch to stage mode' }).click();
    await expect(page.getByTestId('stage-3d')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stage-sprite')).toHaveCount(0);
    // The story can make the character emote and hold a pose (and it rolls back like any op).
    const r = await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'avatar.emote', who: 'Rook Ashby', emote: 'nod' }, { type: 'avatar.pose', who: 'Rook Ashby', pose: 'sit' }] });
    expect(r.errors).toEqual([]);
    const s = (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state;
    expect(s.stage.avatars['rook ashby']).toMatchObject({ pose: 'sit', emote: { id: 'nod' } });
    await page.waitForTimeout(1500);
    // The emote picker and /emote record emotes like any story change.
    await page.getByRole('button', { name: 'Emotes' }).click();
    await page.getByTestId('emote-picker').getByRole('button', { name: 'Wave', exact: true }).click();
    await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.avatars['rook ashby'].emote.id).toBe('wave');
    await page.keyboard.press('Escape');
    const composer = page.getByLabel('Message', { exact: true });
    await composer.fill('/emote shakes head');
    await composer.press('Control+Enter');
    await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.avatars['rook ashby'].emote.id).toBe('shake_head');
    await composer.fill('/pose stand');
    await composer.press('Control+Enter');
    await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.avatars['rook ashby'].pose).toBeNull();

    // Look around: drag to orbit, then back to the directed camera.
    await page.getByRole('button', { name: 'Look around' }).click();
    const box = (await page.getByTestId('stage-3d').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height * 0.3, { steps: 5 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Stop looking around' }).click();

    // Pictures only on this device: the sprite comes back.
    await page.evaluate(() => localStorage.setItem('everloom:3d', JSON.stringify({ spritesOnly: true })));
    await page.reload();
    // Stage mode is remembered for the chat.
    await expect(page.getByRole('button', { name: 'Switch to chat mode' })).toBeVisible();
    await expect(page.getByTestId('stage-sprite')).toHaveCount(1);
    await expect(page.getByTestId('stage-3d')).toHaveCount(0);
    await page.evaluate(() => localStorage.removeItem('everloom:3d'));
    expect(errors).toEqual([]);
  });

  test('nothing 3D downloads on screens without 3D', async ({ page, errors }) => {
    const hits = watch3d(page);
    for (const url of ['/', '/characters', '/settings', '/personas', '/lore']) {
      await page.goto(url);
      // The live event stream never lets the network go idle; give lazy screens time instead.
      await page.waitForTimeout(1200);
    }
    await page.goto('/settings/3d');
    await expect(page.getByText('On this device')).toBeVisible();
    await page.waitForTimeout(1200);
    expect(hits).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('3D motions', () => {
  test('import a BVH motion as an emote; it joins the picker', async ({ page, errors }) => {
    await page.goto('/settings/3d');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a motion file' }).click();
    await (await chooser).setFiles(path.resolve('tests/fixtures/avatars/motions/greet.bvh'));
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    const id = `greet_${test.info().project.name.replace(/[^a-z0-9]/g, '_')}`.slice(0, 40);
    await page.getByLabel('Emote id').fill(id);
    await page.getByLabel('Emote label').fill('Big greeting');
    await page.getByTestId('clip-save').click();
    await expect(page.getByTestId('clip-list')).toContainText('Big greeting');
    const clips = await api(page, 'GET', '/api/avatar-clips');
    expect(clips.map((c: { id: string }) => c.id)).toContain(id);
    const clip = await api(page, 'GET', `/api/avatar-clips/${id}`);
    expect(clip.frames).toBeGreaterThan(10);
    expect(Object.keys(clip.tracks)).toEqual(expect.arrayContaining(['rightUpperArm', 'rightLowerArm']));
    await api(page, 'DELETE', `/api/avatar-clips/${id}`);
    expect(errors).toEqual([]);
  });
});
