import { api, expect, isPhone, mockControl, test } from './fixtures';
import type { Page } from '@playwright/test';

async function openTool(page: Page, name: string) {
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByLabel('Search tools, settings and the story').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

async function story(page: Page) {
  const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Iris Vale', first_mes: 'The lantern flickers as you come in.' } });
  const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
  await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'meta.update', style: 'fantasy' }, { type: 'item.add', name: 'Brass Key' }] });
  return chat;
}

test.describe('customization', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('save a slot, lose the key, load the save as a new chat with the key back', async ({ page, errors }) => {
    const chat = await story(page);
    await page.goto(`/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByLabel('Search tools, settings and the story').fill('Saves');
    await page.getByRole('button', { name: 'Saves', exact: true }).click();
    const saves = page.getByRole('dialog', { name: 'Saves' });
    await saves.getByLabel('Save name').fill('Before the vault');
    await saves.getByRole('button', { name: 'Save now' }).click();
    await expect(saves.getByRole('list', { name: 'Save slots' })).toContainText('Before the vault');
    await expect(saves.getByRole('list', { name: 'Save slots' })).toContainText('The lantern flickers');
    await saves.getByRole('button', { name: 'Close', exact: true }).click();

    await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'item.remove', name: 'Brass Key' }] });
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByLabel('Search tools, settings and the story').fill('Saves');
    await page.getByRole('button', { name: 'Saves', exact: true }).click();
    await page.getByRole('button', { name: 'Load Before the vault' }).click();
    await page.getByRole('dialog', { name: /Load “Before the vault”/ }).getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page).not.toHaveURL(new RegExp(`/chat/${chat.id}$`));
    const loadedId = page.url().split('/chat/')[1]!;
    const loaded = await api(page, 'GET', `/api/chats/${loadedId}`);
    const s = (await api(page, 'GET', `/api/campaigns/${loaded.campaignId}`)).state;
    expect(Object.values(s.inventory).map((i: any) => i.name)).toContain('Brass Key');
    // The save list is shared by the whole story.
    expect((await api(page, 'GET', `/api/chats/${loadedId}/slots`)).map((x: any) => x.name)).toEqual(['Before the vault']);
    expect(errors).toEqual([]);
  });

  test('cinematic mode, view toggles, accent palette and the genre theme', async ({ page, errors }) => {
    const chat = await story(page);
    await page.goto(`/chat/${chat.id}`);
    const root = page.locator('.ev-story');
    await expect(root).toHaveAttribute('data-genre', 'fantasy');
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByLabel('Search tools, settings and the story').fill('Cinematic mode');
    await page.getByRole('button', { name: 'Cinematic mode', exact: true }).click();
    await expect(root).toHaveAttribute('data-cinematic', '');
    await expect(page.getByRole('button', { name: 'Tools', exact: true })).toBeHidden();
    await expect(page.getByText('The lantern flickers as you come in.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Tools', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByLabel('Search tools, settings and the story').fill('View on this device');
    await page.getByRole('button', { name: 'View on this device', exact: true }).click();
    await page.getByRole('dialog', { name: 'View on this device' }).getByText('Status bar', { exact: true }).click();
    await page.getByRole('dialog', { name: 'View on this device' }).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.ev-hud')).toBeHidden();
    await page.reload();
    await expect(page.getByText('The lantern flickers as you come in.')).toBeVisible();
    await expect(page.locator('.ev-hud')).toBeHidden();

    await page.goto('/settings/appearance');
    await page.getByRole('radiogroup', { name: 'Accent' }).getByRole('radio', { name: 'Sea' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'sea');
    await expect.poll(async () => (await api(page, 'GET', '/api/settings')).palette).toBe('sea');
    await page.getByRole('radiogroup', { name: 'Accent' }).getByRole('radio', { name: 'Amber' }).click();
    await page.evaluate(() => localStorage.removeItem('everloom:view'));
    expect(errors).toEqual([]);
  });

  test('diagnostics page and debug bundle', async ({ page, errors }) => {
    await page.goto('/settings/diagnostics');
    await expect(page.getByText('Characters · chats · saves')).toBeVisible();
    // Provider tests run from here too.
    const conns = page.getByRole('list', { name: 'Connections' });
    if (await conns.count()) {
      await conns.getByRole('button', { name: /^Test / }).first().click();
      await expect(conns.getByText(/^Works: /).first()).toBeVisible();
    }
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download debug bundle' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^everloom-debug-.*\.json$/);
    expect(errors).toEqual([]);
  });

  test('movable panels on desktop: float, drag, and it stays put after a reload', async ({ page, errors }) => {
    test.skip(await isPhone(page) || (page.viewportSize()?.width ?? 0) < 1024, 'desktop only');
    const chat = await story(page);
    await page.goto(`/chat/${chat.id}`);
    await openTool(page, 'Inventory');
    await page.getByRole('button', { name: 'Float this panel' }).click();
    const panel = page.getByTestId('floating-panel');
    await expect(panel).toBeVisible();
    // The story stays usable underneath: no modal overlay.
    await expect(page.getByRole('button', { name: 'Tools', exact: true })).toBeEnabled();
    const before = (await panel.boundingBox())!;
    const handle = page.getByTestId('panel-handle');
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + 40, h.y + 12);
    await page.mouse.down();
    await page.mouse.move(h.x - 260, h.y + 62, { steps: 8 });
    await page.mouse.up();
    const after = (await panel.boundingBox())!;
    expect(Math.round(after.x)).toBe(Math.round(before.x - 300));
    expect(Math.round(after.y)).toBe(Math.round(before.y + 50));
    await page.reload();
    await openTool(page, 'Inventory');
    const again = (await page.getByTestId('floating-panel').boundingBox())!;
    expect(Math.round(again.x)).toBe(Math.round(after.x));
    await page.getByTestId('floating-panel').getByRole('button', { name: 'Dock panel' }).click();
    await expect(page.getByTestId('floating-panel')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /Inventory/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('status bar: reorder its items anywhere; on desktop it floats, snaps and resets', async ({ page, errors }) => {
    const chat = await story(page);
    await api(page, 'PATCH', '/api/settings', { hud: { pinned: ['time', 'weather', 'hp'] } });
    await page.goto(`/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByLabel('Search tools, settings and the story').fill('View on this device');
    await page.getByRole('button', { name: 'View on this device', exact: true }).click();
    const view = page.getByRole('dialog', { name: 'View on this device' });
    await view.getByRole('button', { name: 'Move Weather up' }).click();
    await expect.poll(async () => (await api(page, 'GET', '/api/settings')).hud.pinned).toEqual(['weather', 'time', 'hp']);
    const desktop = !(await isPhone(page)) && (page.viewportSize()?.width ?? 0) >= 1024;
    if (desktop) {
      await view.getByText('Float the status bar', { exact: true }).click();
      await view.getByRole('button', { name: 'Close', exact: true }).click();
      const pill = page.getByTestId('floating-hud');
      await expect(pill).toBeVisible();
      const h = (await page.getByTestId('hud-handle').boundingBox())!;
      await page.mouse.move(h.x + 8, h.y + 20);
      await page.mouse.down();
      await page.mouse.move(h.x - 200, h.y + 300, { steps: 8 });
      await page.mouse.up();
      const moved = (await pill.boundingBox())!;
      await page.reload();
      const again = (await page.getByTestId('floating-hud').boundingBox())!;
      expect(Math.round(again.x)).toBe(Math.round(moved.x));
      expect(Math.round(again.y)).toBe(Math.round(moved.y));
      // Dragged into the corner, it snaps to the edges.
      const h2 = (await page.getByTestId('hud-handle').boundingBox())!;
      await page.mouse.move(h2.x + 8, h2.y + 20);
      await page.mouse.down();
      await page.mouse.move(0, 0, { steps: 8 });
      await page.mouse.up();
      const snapped = (await page.getByTestId('floating-hud').boundingBox())!;
      expect([Math.round(snapped.x), Math.round(snapped.y)]).toEqual([8, 8]);
      await page.getByRole('button', { name: 'Tools', exact: true }).click();
      await page.getByLabel('Search tools, settings and the story').fill('View on this device');
      await page.getByRole('button', { name: 'View on this device', exact: true }).click();
      await page.getByRole('dialog', { name: 'View on this device' }).getByRole('button', { name: 'Reset layout' }).click();
      await expect(page.getByTestId('floating-hud')).toHaveCount(0);
      await expect(page.locator('.ev-hud')).toBeVisible();
    }
    await api(page, 'PATCH', '/api/settings', { hud: { pinned: ['time', 'weather', 'location', 'hp', 'hunger', 'energy'] } });
    expect(errors).toEqual([]);
  });
});
