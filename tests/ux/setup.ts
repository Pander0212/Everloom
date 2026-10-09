import { expect, test as setup } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/** First run with the preset from UX_PRESET (default Full RPG), the mock model, and a saved sign-in. */
setup('first run, sign in, mock model', async ({ page }) => {
  mkdirSync('tests/ux/.artifacts', { recursive: true });
  const preset = ({ classic: 'Classic chat', story: 'Story', full: 'Full RPG' } as const)[(process.env.UX_PRESET ?? 'full') as 'full'] ?? 'Full RPG';
  await page.goto('/');
  await page.getByLabel('Username').fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByLabel('Confirm password').fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'How will you use Everloom?' })).toBeVisible();
  await page.getByRole('listitem').filter({ hasText: preset }).click();
  await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
  const r = await page.evaluate(async (endpoint) => {
    const s = await (await fetch('/api/auth/status')).json();
    const h = { 'content-type': 'application/json', 'x-csrf-token': s.csrf };
    const c = await (await fetch('/api/connections', { method: 'POST', headers: h, body: JSON.stringify({ name: 'Mock model', provider: 'openai', baseUrl: endpoint, model: 'mock-story' }) })).json();
    const cur = await (await fetch('/api/settings')).json();
    await fetch('/api/settings', { method: 'PATCH', headers: h, body: JSON.stringify({ roles: { ...cur.roles, main: c.id } }) });
    return c.id as string;
  }, process.env.E2E_MOCK!);
  expect(r).toBeTruthy();
  await page.context().storageState({ path: 'tests/ux/.artifacts/auth.json' });
});
