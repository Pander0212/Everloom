import { expect, test } from '@playwright/test';
import { api, mockControl, shot } from './helpers';

/**
 * The app in the preset chosen at first run (UX_PRESET=classic|story|full): what the play screen,
 * Tools and Settings offer. Classic chat must show no game entry anywhere.
 */
const PRESET = process.env.UX_PRESET ?? 'full';
const GAME_TOOLS = ['Inventory', 'Map', 'Journal', 'Status', 'People', 'Money', 'Outfits', 'Party', 'Battle', 'Story changes', 'New game setup', 'Facts', 'Diary'];

test(`preset ${PRESET}: what each place offers`, async ({ page }, info) => {
  await mockControl({ reset: true });
  const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Preset Pia', first_mes: 'Hello there.' } });
  const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
  await page.goto(`/chat/${chat.id}`);
  await page.getByLabel('Message', { exact: true }).fill('Hi!');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.ev-message-assistant')).toHaveCount(2, { timeout: 15_000 });
  const dir = `presets/${PRESET}/${info.project.name}`;
  await shot(page, dir, '1-play');
  const hud = page.getByRole('button', { name: /^Status:/ });
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.waitForTimeout(400);
  await shot(page, dir, '2-tools');
  const tools = page.getByRole('dialog', { name: 'Tools' });
  const offered = await tools.locator('[data-cmd]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  await page.keyboard.press('Escape');
  await page.goto('/settings');
  const pages = await page.getByRole('navigation', { name: 'Settings pages' }).getByRole('link').allInnerTexts();
  if (PRESET === 'classic') {
    expect(await hud.count()).toBe(0);
    for (const t of GAME_TOOLS) expect(offered, t).not.toContain(t);
    expect(pages.join(' ')).not.toMatch(/Game & story state/);
  } else {
    await page.goto(`/chat/${chat.id}`);
    await expect(page.getByRole('button', { name: /^Status:/ })).toBeVisible();
    expect(offered).toContain('Journal');
    if (PRESET === 'story') for (const t of ['Inventory', 'Map', 'Battle', 'Money']) expect(offered, t).not.toContain(t);
    else for (const t of ['Inventory', 'Map', 'Journal']) expect(offered, t).toContain(t);
  }
});
