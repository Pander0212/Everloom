import { expect, test } from './fixtures';

// After an update, a page still running the old build asks for script files that are gone.
test.describe('recovering from an update', () => {
  test('a missing script file is a 404, never the app page', async ({ page }) => {
    const missing = await page.request.get('/assets/SettingsPage-oldbuild.js');
    expect(missing.status()).toBe(404);
    expect(await missing.text()).not.toContain('<div id="root">');
    const route = await page.request.get('/characters');
    expect(route.status()).toBe(200);
    expect(await route.text()).toContain('<div id="root">');
  });

  test('a part of the app that fails to load reloads once, then offers Reload and Reset instead of spinning', async ({ page, errors }) => {
    await page.goto('/characters');
    await expect(page.getByRole('heading', { name: 'Characters' })).toBeVisible();
    let loads = 0;
    page.on('load', () => loads++);
    // Pretend the server was updated: the Settings chunk this page knows about no longer exists.
    await page.route(/\/assets\/SettingsPage-[^/]+\.js$/, (r) => r.fulfill({ status: 404, body: 'gone' }));
    await page.getByRole('link', { name: 'Settings' }).first().click();
    await expect(page.getByRole('alert').getByText(/Something went wrong|taking longer/)).toBeVisible({ timeout: 20_000 });
    expect(loads).toBe(1); // reloaded exactly once, then stopped (no reload loop)
    await expect(page.getByRole('button', { name: 'Reset app' })).toBeVisible();
    // The new build is there now: Reset brings the app back.
    await page.unroute(/\/assets\/SettingsPage-[^/]+\.js$/);
    await page.getByRole('button', { name: 'Reset app' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible();
    errors.length = 0; // the failed loads above are expected
  });
});

test.describe('server unreachable', () => {
  test('shows the error screen and recovers by itself when the server is back', async ({ page, errors }) => {
    await page.route('**/api/auth/status', (r) => r.abort('connectionrefused'));
    await page.goto('/characters');
    await expect(page.getByText("Can't reach the server")).toBeVisible({ timeout: 20_000 });
    await page.unroute('**/api/auth/status');
    // No click: it retries on its own.
    await expect(page.getByRole('heading', { name: 'Characters' })).toBeVisible({ timeout: 15_000 });
    errors.length = 0; // the refused requests above are expected
  });
});
