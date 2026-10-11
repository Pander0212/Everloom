import { expect, test } from '@playwright/test';
import { api, dismissToasts, mockControl, seedWorld, shot } from './helpers';

/**
 * Every theme on the play screen, a menu, settings and the stage, on a phone and a desktop
 * (docs/ux/themes.md, evidence in docs/ux/evidence/themes). Also: the gallery, the per-world theme,
 * and that scenery stops under reduced motion and while the tab is hidden.
 */
const LOOKS = ['everloom', 'lantern', 'night', 'terminal', 'pixel', 'rain', 'sketch', 'sakura', 'neon', 'parchment', 'minimal'];

test.describe.configure({ mode: 'serial' });

test('every theme: story, palette, settings, stage', async ({ page }, info) => {
  test.setTimeout(600_000);
  const dir = `themes/${info.project.name}`;
  await mockControl({ reset: true });
  const { chat } = await seedWorld(page);
  await page.goto(`/chat/${chat.id}`);
  await page.getByLabel('Message', { exact: true }).fill('Something cold, please.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/Iced lemon tea, on the house/)).toBeVisible();
  await page.waitForTimeout(2000);
  for (const id of LOOKS) {
    await api(page, 'PATCH', '/api/settings', { look: { id } });
    await page.goto(`/chat/${chat.id}`);
    await expect(page.locator('html')).toHaveAttribute('data-look', id);
    await page.waitForTimeout(1200);
    await shot(page, dir, `${id}-1-story`);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.waitForTimeout(500);
    await shot(page, dir, `${id}-2-tools`);
    await page.keyboard.press('Escape');
    await page.goto('/settings/features');
    await shot(page, dir, `${id}-3-settings`);
    await api(page, 'PATCH', `/api/chats/${chat.id}`, { metadata: { mode: 'stage' } });
    await page.goto(`/chat/${chat.id}`);
    await page.waitForTimeout(1000);
    await shot(page, dir, `${id}-4-stage`);
    await api(page, 'PATCH', `/api/chats/${chat.id}`, { metadata: { mode: 'chat' } });
  }
  await api(page, 'PATCH', '/api/settings', { look: { id: 'everloom' } });
});

test('the gallery applies a theme at once; a world keeps its own', async ({ page }, info) => {
  const dir = `themes/${info.project.name}`;
  await api(page, 'PATCH', '/api/settings', { look: { id: 'everloom' } });
  await page.goto('/settings/appearance');
  await expect(page.getByRole('radiogroup', { name: 'Theme', exact: true }).getByRole('radio')).toHaveCount(LOOKS.length);
  await page.waitForTimeout(1500);
  await dismissToasts(page);
  await page.screenshot({ path: `tests/ux/.artifacts/out/screens/${dir}/gallery.png`, fullPage: true });
  await page.getByRole('radio', { name: 'Night Voyage' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-look', 'night');
  await expect.poll(async () => (await api(page, 'GET', '/api/settings')).look.id).toBe('night');
  // A world with its own theme wears it, then the player's comes back.
  const { chat } = await seedWorld(page);
  await api(page, 'PATCH', `/api/chats/${chat.id}`, { metadata: { look: 'pixel' } });
  await page.goto(`/chat/${chat.id}`);
  await expect(page.locator('html')).toHaveAttribute('data-look', 'pixel');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-look', 'night');
  await api(page, 'PATCH', '/api/settings', { look: { id: 'everloom' } });
});

test('scenery pauses under reduced motion and while hidden', async ({ page }) => {
  await api(page, 'PATCH', '/api/settings', { look: { id: 'night' }, motion: 'full' });
  const { chat } = await seedWorld(page);
  await page.goto(`/chat/${chat.id}`);
  await expect(page.locator('canvas[data-scenery="night"]')).toHaveCount(1);
  const frames = () => page.evaluate(() => window.__scenery?.frames ?? 0);
  await page.waitForTimeout(1500);
  const a = await frames();
  await page.waitForTimeout(1000);
  expect(await frames()).toBeGreaterThan(a + 5);
  // Hidden tab: no frames.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  const b = await frames();
  await page.waitForTimeout(1000);
  expect(await frames()).toBe(b);
  // Reduced motion: one still frame, then nothing.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('canvas[data-scenery="night"]')).toHaveCount(1);
  await page.waitForTimeout(800);
  const c = await frames();
  await page.waitForTimeout(1000);
  expect(await frames()).toBe(c);
  await api(page, 'PATCH', '/api/settings', { look: { id: 'everloom' } });
});

declare global {
  interface Window {
    __scenery?: { frames: number; ms: number; since: number };
  }
}
