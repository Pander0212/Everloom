import { api, expect, test } from './fixtures';

test.describe('privacy', () => {
  test.afterEach(async ({ page }) => {
    await api(page, 'PATCH', '/api/settings', { privacy: { shield: { enabled: false, terms: [] } } });
  });

  test('name shield: add a name, its stand-in is suggested, and the preview shows what the provider gets', async ({ page, errors }) => {
    await page.goto('/settings/privacy');
    await page.getByRole('switch', { name: 'Use the name shield' }).click({ force: true });
    await page.getByRole('button', { name: 'Add a name' }).click();
    const real = page.getByLabel('Real name (New name)', { exact: true });
    await real.fill('Lena Brook');
    await real.blur();
    const standin = page.getByLabel('Stand-in for Lena Brook', { exact: true });
    await expect(standin).not.toHaveValue('');
    const value = await standin.inputValue();
    await page.getByLabel('Try it').fill("I'm Lena, LENA BROOK.");
    await expect(page.getByLabel('As sent')).toHaveText(`I'm ${value.split(' ')[0]}, ${value.toUpperCase()}.`);
    // A new stand-in on request.
    await page.getByRole('button', { name: 'New stand-in for Lena Brook' }).click();
    await expect(standin).not.toHaveValue(value);
    const saved = (await api(page, 'GET', '/api/settings')).privacy.shield;
    expect(saved.enabled).toBe(true);
    expect(saved.terms[0]).toMatchObject({ real: 'Lena Brook', kind: 'full' });
    expect(errors).toEqual([]);
  });
});
