import { api, BASE, expect, test } from './fixtures';

// The e2e server answers Chub requests from tests/fixtures/sources/chub (EVERLOOM_SOURCE_FIXTURES).
test.describe('online sources', () => {
  test.afterEach(async ({ page }) => {
    await api(page, 'PATCH', '/api/settings', { library: { blurAdult: false } });
  });

  test('browse, preview, import with "In library"; hidden definitions labelled; 18+ is a filter, not a setting', async ({ page, errors }) => {
    await page.goto('/characters');
    for (const c of await api(page, 'GET', '/api/characters')) if (c.linked) await api(page, 'DELETE', `/api/characters/${c.id}`);
    await page.getByLabel('Create', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Browse online' }).click();
    await expect(page.getByRole('heading', { name: 'Browse Chub' })).toBeVisible();
    const grid = page.getByRole('list', { name: 'Online characters' });
    // 18+ cards are included with no setting; the filter can leave them out.
    await expect(grid.getByText('Velvet Room')).toBeVisible();
    await expect(grid.getByRole('button')).toHaveCount(4);
    await page.getByLabel('Include 18+').uncheck();
    await expect(grid.getByRole('button')).toHaveCount(3);
    await expect(grid.getByText('Velvet Room')).toHaveCount(0);

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

    // There is no 18+ switch in Settings; the optional privacy blur (off by default) blurs 18+ pictures in lists.
    await page.goto('/settings/sources');
    await expect(page.getByRole('switch', { name: /Adult content/ })).toHaveCount(0);
    await page.goto('/settings/privacy');
    const blur = page.getByRole('switch', { name: 'Blur 18+ pictures in lists' });
    await expect(blur).not.toBeChecked();
    await blur.click({ force: true });
    await expect.poll(async () => (await api(page, 'GET', '/api/settings')).library.blurAdult).toBe(true);
    await page.goto('/characters/browse');
    await page.getByLabel('Include 18+').check();
    const velvet = page.getByRole('list', { name: 'Online characters' }).getByRole('button', { name: /Velvet Room/ });
    await expect(velvet).toBeVisible();
    await expect(velvet.locator('img.blur-lg')).toHaveCount(1);
    await expect(page.getByRole('list', { name: 'Online characters' }).locator('img.blur-lg')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('other sources, import from a link, and the browser bridge (valid and bad token)', async ({ page, errors }) => {
    await page.goto('/characters/browse');
    for (const c of await api(page, 'GET', '/api/characters')) if (c.linked || c.card?.extensions?.source_url) await api(page, 'DELETE', `/api/characters/${c.id}`);
    await page.getByLabel('Source', { exact: true }).selectOption({ label: 'Character Tavern' });
    await expect(page.getByRole('heading', { name: 'Browse Character Tavern' })).toBeVisible();
    // Only the orders the site honours are offered, and each source remembers how it was browsed.
    const sortGroup = page.getByRole('radiogroup', { name: 'Sort' });
    await expect(sortGroup.getByRole('radio')).toHaveText(['Popular', 'New', 'Top rated']);
    await sortGroup.getByRole('radio', { name: 'New' }).click();
    await page.getByLabel('Source', { exact: true }).selectOption({ label: 'Chub' });
    await expect(sortGroup.getByRole('radio')).toHaveCount(5);
    await expect(sortGroup.getByRole('radio', { name: 'Popular' })).toHaveAttribute('aria-checked', 'true');
    await page.getByLabel('Source', { exact: true }).selectOption({ label: 'Character Tavern' });
    await expect(sortGroup.getByRole('radio', { name: 'New' })).toHaveAttribute('aria-checked', 'true');
    await sortGroup.getByRole('radio', { name: 'Popular' }).click();
    const grid = page.getByRole('list', { name: 'Online characters' });
    await page.getByLabel('Include 18+').uncheck();
    await expect(grid.getByRole('button')).toHaveCount(2); // the 18+ filter is off: the adult card stays out
    await grid.getByRole('button', { name: /Wren of the Lantern Archive/ }).click();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByText('Wren added to your library')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    // The capability matrix explains bridge-only sites.
    await page.getByRole('button', { name: 'About sources' }).click();
    const matrix = page.getByRole('list', { name: 'What each source supports' });
    await expect(matrix.getByRole('listitem').filter({ hasText: 'JanitorAI' })).toContainText('Browser bridge');
    await expect(matrix.getByRole('listitem').filter({ hasText: 'Saucepan' })).toContainText('Built in');
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
    await page.goto('/settings/sources#bridge');
    await page.getByLabel('Add a device by token').fill('Test laptop');
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

  test('filters, a site notice, accounts and the self-test', async ({ page, errors }) => {
    await page.goto('/characters/browse');
    await api(page, 'DELETE', '/api/sources/botbooru/account');
    await page.getByLabel('Source', { exact: true }).selectOption({ label: 'Botbooru' });
    // Nothing is fetched from a robots-restricted site until the notice is accepted (once per account:
    // other viewports of this run share the server).
    const notice = page.getByRole('region', { name: 'About Botbooru' });
    const grid = page.getByRole('list', { name: 'Online characters' });
    await expect(notice.or(grid)).toBeVisible();
    if (await notice.isVisible()) {
      await expect(notice).toContainText('robots.txt');
      await notice.getByRole('button', { name: 'I understand, continue' }).click();
    }
    await page.getByLabel('Include 18+').uncheck();
    await expect(grid.getByRole('button')).toHaveCount(2); // the 18+ filter is off: the adult post stays out
    // The filter bar: a tag chip narrows the results; tapping it turns it into an exclusion.
    // Filters are remembered per source on this device; start from none.
    const toggle = page.getByRole('button', { name: /^Filters/ });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    for (const chip of await page.getByRole('button', { name: /^Remove / }).all()) await chip.click();
    await page.getByLabel('Add a tag').fill('fantasy');
    await page.getByLabel('Add a tag').press('Enter');
    await expect(grid.getByRole('button')).toHaveCount(1);
    await expect(grid.getByRole('button', { name: /Mossheart/ })).toBeVisible();
    await page.getByRole('button', { name: 'Including fantasy; tap to exclude instead' }).click();
    await expect(grid.getByRole('button', { name: /Tin Lark/ })).toBeVisible();
    await expect(grid.getByRole('button', { name: /Mossheart/ })).toHaveCount(0);
    // Filter syntax in the search box works too.
    await page.getByRole('button', { name: 'Remove fantasy' }).click();
    await page.getByLabel('Search online characters').fill('creator:fernwright');
    await expect(grid.getByRole('button')).toHaveCount(1);

    // Accounts: sign in; the password never comes back to the page.
    await page.goto('/settings/sources#accounts');
    const accounts = page.getByRole('list', { name: 'Site accounts' });
    await accounts.getByLabel('Botbooru Username').fill('tester');
    await accounts.getByLabel('Botbooru password').fill('right');
    await accounts.getByRole('button', { name: 'Sign in' }).first().click();
    await expect(accounts.getByRole('listitem').filter({ hasText: 'Botbooru' })).toContainText('Working');
    expect(JSON.stringify(await api(page, 'GET', '/api/sources'))).not.toContain('right"');

    // Diagnostics: the self-test reports each step.
    await page.getByLabel('Site', { exact: true }).selectOption({ label: 'Character Tavern' });
    await page.getByRole('button', { name: 'Run self-test' }).click();
    const steps = page.getByRole('list', { name: 'Character Tavern self-test' });
    await expect(steps.getByRole('listitem')).toHaveCount(4);
    await expect(steps).toContainText(/detail/i);
    expect(errors).toEqual([]);
  });
});
