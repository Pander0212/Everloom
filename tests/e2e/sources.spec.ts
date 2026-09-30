import { api, expect, test } from './fixtures';

// The e2e server answers Chub requests from tests/fixtures/sources/chub (EVERLOOM_SOURCE_FIXTURES).
test.describe('online sources', () => {
  test.afterEach(async ({ page }) => {
    await api(page, 'PATCH', '/api/settings', { library: { nsfw: false } });
  });

  test('browse, preview, import with "In library"; hidden definitions and adult content stay out', async ({ page, errors }) => {
    await page.goto('/characters');
    for (const c of await api(page, 'GET', '/api/characters')) if (c.linked) await api(page, 'DELETE', `/api/characters/${c.id}`);
    await page.getByLabel('Create', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Browse online' }).click();
    await expect(page.getByRole('heading', { name: 'Browse Chub' })).toBeVisible();
    const grid = page.getByRole('list', { name: 'Online characters' });
    await expect(grid.getByRole('button')).toHaveCount(3); // the adult one is hidden
    await expect(grid.getByText('Velvet Room')).toHaveCount(0);
    await expect(page.getByLabel('Adult')).toHaveCount(0);

    // A hidden definition can be previewed but not imported.
    await grid.getByRole('button', { name: /The Secret Sister/ }).click();
    await expect(page.getByText("keeps this character's definition private")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import' })).toBeDisabled();
    await page.getByRole('button', { name: 'Close' }).click();

    await grid.getByRole('button', { name: /Maren Holt/ }).click();
    await expect(page.getByText(/not on my list/)).toBeVisible();
    await page.getByRole('button', { name: 'Import' }).click();
    await expect(page.getByText('Maren Holt added to your library')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open in library' })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(grid.getByRole('button', { name: /Maren Holt/ }).getByText('In library')).toBeVisible();
    await page.getByLabel('Hide ones I have').check();
    await expect(grid.getByRole('button')).toHaveCount(2);

    // The imported character is linked, with its lorebook.
    const mine = (await api(page, 'GET', '/api/characters')).find((c: any) => c.linked === 'tidewriter/maren-holt');
    expect(mine).toMatchObject({ name: 'Maren Holt', hasLorebook: true });

    // Adult content only after turning it on in Settings.
    await page.goto('/settings/characters');
    await page.getByRole('switch', { name: 'Show adult content' }).click({ force: true });
    await expect.poll(async () => (await api(page, 'GET', '/api/settings')).library.nsfw).toBe(true);
    await page.goto('/characters/browse');
    await page.getByLabel('Adult').check();
    await expect(page.getByRole('list', { name: 'Online characters' }).getByText('Velvet Room')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
