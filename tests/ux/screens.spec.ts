import { expect, test } from '@playwright/test';
import { mockControl, seedWorld, shot } from './helpers';

/** Screenshots of the main screens for docs/ux (UX_LABEL: before / after). */
const LABEL = process.env.UX_LABEL ?? 'after';

test('screens', async ({ page }, info) => {
  const dir = `${LABEL}/${info.project.name}`;
  const phone = (page.viewportSize()?.width ?? 1280) < 768;
  await mockControl({ reset: true });
  const { chat } = await seedWorld(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
  await shot(page, dir, '01-chats');
  await page.goto(`/chat/${chat.id}`);
  await page.getByLabel('Message', { exact: true }).fill('Something cold, please.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/Iced lemon tea, on the house/)).toBeVisible();
  await page.waitForTimeout(2500);
  await shot(page, dir, '02-play');
  // Message actions
  const msg = page.locator('[id^="msg-"]').last();
  await msg.hover();
  await msg.getByRole('button', { name: /^(Message actions|More actions)$/ }).first().click();
  await shot(page, dir, '03-message-actions');
  await page.keyboard.press('Escape');
  // Palette (the tools menu)
  await page.getByRole('button', { name: /^(Actions and tools|Tools)$/ }).first().click();
  await page.waitForTimeout(500);
  await shot(page, dir, '04-command-menu');
  const search = page.getByLabel(/Search tools/);
  await search.fill('story state');
  await page.waitForTimeout(300);
  await shot(page, dir, '04b-palette-search');
  await page.getByRole('button', { name: /^Story state/ }).first().click();
  await page.waitForTimeout(800);
  await shot(page, dir, '06-world-inspector');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // This chat
  await page.getByRole('button', { name: /Iris Thorne/ }).first().click();
  await page.waitForTimeout(600);
  await shot(page, dir, '05-this-chat');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // Settings
  await page.goto('/settings');
  await shot(page, dir, '07-settings');
  await page.goto('/settings/features');
  await shot(page, dir, '08-settings-features');
  await page.goto('/settings/game');
  await shot(page, dir, '09-settings-game');
  await page.goto('/settings/appearance');
  await shot(page, dir, '10-settings-appearance');
  await page.goto('/characters');
  await shot(page, dir, '11-characters');
  await page.goto('/settings/game');
  await page.getByRole('button', { name: 'What is this?' }).first().click();
  await shot(page, dir, '12-settings-help');
  if (phone) {
    await page.goto('/settings');
    await page.getByRole('radio', { name: 'Advanced' }).click();
    await page.waitForTimeout(300);
    await shot(page, dir, '13-settings-advanced');
  }
});
