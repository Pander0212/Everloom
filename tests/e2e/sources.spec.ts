import { api, BASE, expect, test } from './fixtures';

// The e2e server answers Chub requests from tests/fixtures/sources/chub (EVERLOOM_SOURCE_FIXTURES).
test.describe('online sources', () => {
  test.afterEach(async ({ page }) => {
    await api(page, 'PATCH', '/api/settings', { library: { nsfw: false } });
  });

  test('browse, preview, import with "In library"; hidden definitions labelled, adult content stays out', async ({ page, errors }) => {
    await page.goto('/characters');
    for (const c of await api(page, 'GET', '/api/characters')) if (c.linked) await api(page, 'DELETE', `/api/characters/${c.id}`);
    await page.getByLabel('Create', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Browse online' }).click();
    await expect(page.getByRole('heading', { name: 'Browse Chub' })).toBeVisible();
    const grid = page.getByRole('list', { name: 'Online characters' });
    await expect(grid.getByRole('button')).toHaveCount(3); // the adult one is hidden
    await expect(grid.getByText('Velvet Room')).toHaveCount(0);
    await expect(page.getByLabel('Adult')).toHaveCount(0);

    // A hidden definition: only the public profile can come across, and it says so.
    await grid.getByRole('button', { name: /The Secret Sister/ }).click();
    await expect(page.getByText('Definition hidden by creator.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import public profile' })).toBeEnabled();
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

  test('other sources, import from a link, and the browser bridge (valid and bad token)', async ({ page, errors }) => {
    await page.goto('/characters/browse');
    for (const c of await api(page, 'GET', '/api/characters')) if (c.linked || c.card?.extensions?.source_url) await api(page, 'DELETE', `/api/characters/${c.id}`);
    await page.getByLabel('Source', { exact: true }).selectOption({ label: 'Character Tavern' });
    await expect(page.getByRole('heading', { name: 'Browse Character Tavern' })).toBeVisible();
    const grid = page.getByRole('list', { name: 'Online characters' });
    await expect(grid.getByRole('button')).toHaveCount(2); // the adult card stays out
    await grid.getByRole('button', { name: /Wren of the Lantern Archive/ }).click();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText('Wren added to your library')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    // The capability matrix explains bridge-only sites.
    await page.getByRole('button', { name: 'About sources' }).click();
    const matrix = page.getByRole('list', { name: 'What each source supports' });
    await expect(matrix.getByRole('listitem').filter({ hasText: 'JanitorAI' })).toContainText('Browser bridge');
    await expect(matrix.getByRole('listitem').filter({ hasText: 'Saucepan' })).toContainText('Not supported');
    await page.getByRole('button', { name: 'Close' }).click();

    // Import from a link: a provider page works; a bridge-only site explains what to do.
    await page.getByRole('button', { name: 'Import from a link' }).click();
    await page.getByLabel('Link', { exact: true }).fill('https://pygmalion.chat/character/7a7a7a7a-1111-4222-8333-444455556666');
    await page.getByRole('dialog', { name: 'Import from a link' }).getByRole('button', { name: 'Import' }).click();
    await expect(page.getByText('Juniper added to your library')).toBeVisible();
    await page.getByRole('button', { name: 'Import from a link' }).click();
    await page.getByLabel('Link', { exact: true }).fill('https://janitorai.com/characters/1234-abcd');
    await page.getByRole('dialog', { name: 'Import from a link' }).getByRole('button', { name: 'Import' }).click();
    await expect(page.getByText(/Send to Everloom/).first()).toBeVisible();
    await page.getByRole('dialog', { name: 'Import from a link' }).getByRole('button', { name: 'Close' }).click();

    // The bridge: add a device, send with its token; a bad token is refused.
    await page.goto('/settings/characters#bridge');
    await page.getByLabel('Add a device').fill('Test laptop');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const token = await page.getByLabel('Device token').inputValue();
    expect(token).toMatch(/^evb_/);
    await expect(page.getByRole('link', { name: 'Send to Everloom', exact: true })).toHaveAttribute('href', /^javascript:/);
    // As the userscript does it: from outside the app, with only the device token.
    const send = async (t: string) =>
      (await fetch(`${BASE()}/api/bridge/import`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, origin: 'https://janitorai.com' }, body: JSON.stringify({ page: 'https://janitorai.com/characters/77', hidden: true, card: { name: 'Bridged Bea', creator_notes: 'Public bio.' } }) })).status;
    expect(await send(token)).toBe(200);
    expect(await send('evb_notarealtokennotarealtoken00')).toBe(401);
    await expect(page.getByRole('list', { name: 'Devices' })).toContainText('Test laptop');
    const bea = (await api(page, 'GET', '/api/characters')).find((c: any) => c.name === 'Bridged Bea');
    await page.goto(`/characters`);
    await page.getByRole('button', { name: /Bridged Bea/ }).first().click();
    await expect(page.getByText('Definition hidden by creator.')).toBeVisible();
    expect(bea).toBeTruthy();
    expect(errors).toEqual([]);
  });
});
