import { expect, test as setup } from '@playwright/test';
import { mkdirSync } from 'node:fs';

setup('first-run setup and login', async ({ page }) => {
  mkdirSync('tests/e2e/.artifacts', { recursive: true });
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to Everloom' })).toBeVisible();
  await page.getByLabel('Username').fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByLabel('Confirm password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
  // Sign out and back in through the login screen.
  await page.evaluate(async () => {
    const s = await (await fetch('/api/auth/status')).json();
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-csrf-token': s.csrf, 'content-type': 'application/json' }, body: '{}' });
  });
  await page.reload();
  await page.getByLabel('Username').fill('owner');
  await page.getByLabel('Password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
  // Add the mock model through the UI.
  await page.goto('/settings/connections');
  await page.getByRole('button', { name: 'Add' }).first().click();
  await page.getByLabel('Service').selectOption('custom');
  await page.getByLabel('Name', { exact: true }).fill('Mock model');
  await page.getByLabel('Endpoint URL').fill(process.env.E2E_MOCK!);
  await page.getByRole('button', { name: 'Fetch list' }).click();
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('mock-story');
  await page.getByRole('button', { name: 'Test' }).click();
  await expect(page.getByText(/^Connected\./)).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: /Mock model/ })).toBeVisible();
  await page.getByLabel('Main model').selectOption({ label: 'Mock model — mock-story' });
  await page.context().storageState({ path: 'tests/e2e/.artifacts/auth.json' });
  expect(errors).toEqual([]);
});
