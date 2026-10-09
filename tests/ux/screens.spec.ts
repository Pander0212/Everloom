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
  await msg.getByRole('button', { name: /Message actions|More/ }).first().click();
  await shot(page, dir, '03-message-actions');
  await page.keyboard.press('Escape');
  // Command menu / palette
  await page.getByRole('button', { name: /Actions and tools|Tools/ }).first().click();
  await page.waitForTimeout(500);
  await shot(page, dir, '04-command-menu');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // Chat menu
  const chatMenu = page.getByRole('button', { name: 'Chat menu' });
  if (await chatMenu.count()) {
    await chatMenu.click();
    await shot(page, dir, '05-chat-menu');
    const wi = page.getByRole('menuitem', { name: /World inspector|What the AI sees/ });
    if (await wi.count()) {
      await wi.click();
      await page.waitForTimeout(800);
      await shot(page, dir, '06-world-inspector');
    }
    await page.keyboard.press('Escape');
  }
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
  if (phone) {
    await page.goto(`/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Chat menu' }).click();
    await page.getByRole('menuitem', { name: 'Prompt inspector' }).click().catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, dir, '12-prompt-inspector');
  }
});
