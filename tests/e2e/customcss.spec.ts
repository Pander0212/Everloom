import { api, expect, test } from './fixtures';

test.describe('custom CSS', () => {
  test.afterEach(async ({ page }) => {
    await api(page, 'PATCH', '/api/settings', { css: { snippets: [] } });
  });

  test('the assistant writes a snippet; it applies everywhere but Settings; safe mode turns it off', async ({ page, errors }) => {
    const storySize = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--story-size').trim());
    await page.goto('/settings/css');
    await expect(page.getByRole('heading', { name: 'Custom CSS' })).toBeVisible();
    await page.getByRole('button', { name: 'New snippet' }).click();
    await page.getByLabel('Describe the change').fill('Bigger, roomier story text');
    await page.getByRole('button', { name: 'Write' }).click();
    await expect(page.getByLabel('CSS', { exact: true })).toHaveValue(/--story-size: 19px/);
    await expect(page.getByLabel('Name')).toHaveValue('Roomier story text');
    await expect(page.getByText(/^\d+ rules$/)).toBeVisible();
    await page.getByRole('button', { name: 'Save snippet' }).click();
    await expect(page.getByRole('list', { name: 'Snippets' }).getByText('Roomier story text')).toBeVisible();
    // Settings keeps the default look.
    expect(await storySize()).not.toBe('19px');
    await page.goto('/characters');
    await expect.poll(storySize).toBe('19px');
    // Safe mode: off for the session, back on with ?safe-mode=0.
    await page.goto('/characters?safe-mode');
    await expect.poll(storySize).not.toBe('19px');
    await page.goto('/');
    await expect.poll(storySize).not.toBe('19px');
    await page.goto('/?safe-mode=0');
    await expect.poll(storySize).toBe('19px');
    // Disabling the snippet turns it off.
    await page.goto('/settings/css');
    await page.getByRole('switch', { name: 'Enable Roomier story text' }).click({ force: true });
    await page.goto('/characters');
    await page.waitForTimeout(300);
    expect(await storySize()).not.toBe('19px');
    expect(errors).toEqual([]);
  });
});
