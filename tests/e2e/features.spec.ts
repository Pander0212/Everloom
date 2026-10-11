import { api, expect, test } from './fixtures';

// Feature switches: Classic chat hides every game screen; switching back brings it all back.
test.describe('feature switches', () => {
  test.afterEach(async ({ page }) => {
    await api(page, 'PATCH', '/api/settings', { features: { preset: 'full' } });
  });

  test('Classic chat: no game UI, fewer settings; a dependency is explained before it applies', async ({ page, errors }) => {
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Plain Pella', first_mes: 'Hello there.' } });
    await page.goto('/settings/features');
    await page.getByRole('radio', { name: /Classic chat/ }).click();
    await expect(page.getByRole('radio', { name: /Classic chat/ })).toHaveAttribute('aria-checked', 'true');
    // Game settings disappear from the list.
    await expect(page.getByRole('link', { name: 'Game & story state' })).toHaveCount(0);

    // A new chat in Classic mode: no status bar, no game tools in the command menu.
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
    expect(chat.campaignId).toBeNull();
    await page.goto(`/chat/${chat.id}`);
    await expect(page.getByText('Hello there.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Status:/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    const menu = page.getByRole('dialog');
    await expect(menu.getByText('Note to the AI').first()).toBeVisible();
    for (const tool of ['Inventory', 'Map', 'Journal', 'Phone', 'Battle']) await expect(menu.getByRole('button', { name: tool, exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Turning the map back on asks first and names what comes with it.
    await page.goto('/settings/features');
    await page.getByRole('switch', { name: 'Travel' }).click({ force: true });
    await expect(page.getByRole('alertdialog').or(page.getByRole('dialog'))).toContainText(/Map/);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('switch', { name: 'Travel' })).not.toBeChecked();
    expect(errors).toEqual([]);
  });

  test('a chat can be Full RPG while the rest is Classic', async ({ page, errors }) => {
    await api(page, 'PATCH', '/api/settings', { features: { preset: 'classic' } });
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Rpg Rowan', first_mes: 'Ready?' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, features: 'full' });
    expect(chat.campaignId).toBeTruthy();
    await page.goto(`/chat/${chat.id}`);
    // The game layer is on for this chat: the status bar and the game tools are there.
    await expect(page.getByRole('button', { name: /^Status:/ })).toBeVisible();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Inventory', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });
});
