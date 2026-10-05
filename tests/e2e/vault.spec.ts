import { api, expect, test } from './fixtures';

const PASS = 'e2e vault passphrase';

test.describe('vault', () => {
  test.afterEach(async ({ page }) => {
    const s = await api(page, 'GET', '/api/vault');
    if (s.enabled) await api(page, 'POST', '/api/vault/disable', { passphrase: PASS });
  });

  test('turn it on, keep the recovery key, lock now, unlock with the passphrase', async ({ page, errors }) => {
    test.setTimeout(90_000);
    await page.goto('/settings/privacy');
    await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
    await page.getByLabel('Passphrase again').fill(PASS);
    await page.getByRole('button', { name: 'Turn on the vault' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Turn on', exact: true }).click();
    const key = page.getByLabel('Recovery key value');
    await expect(key).toHaveText(/^[0-9A-Z]{4}(-[0-9A-Z]{4})+/, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'I saved the recovery key' }).check();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Lock now' }).click();
    await expect(page.getByText('Everloom is locked')).toBeVisible();
    await page.getByLabel('Vault passphrase').fill('not the passphrase');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByText(/wrong passphrase/i)).toBeVisible();
    await page.getByLabel('Vault passphrase').fill(PASS);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByText('Everloom is locked')).toBeHidden();
    expect((await api(page, 'GET', '/api/vault')).locked).toBe(false);
    // Locking refuses requests in flight (423) and a wrong passphrase is a 401: both expected here.
    errors.splice(0, errors.length, ...errors.filter((e) => !/status of (423|401)/.test(e)));
  });
});
