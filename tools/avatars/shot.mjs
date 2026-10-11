/**
 * A headless Chromium session against a running Everloom (dev or built), for looking at 3D work:
 *   node tools/avatars/shot.mjs <scenario.mjs> [baseURL]
 * The scenario module default-exports `async ({ page, shot, helpers }) => {}`; `shot(name)` saves a
 * PNG under the folder given by SHOT_DIR (default: the OS temp folder). Signs in with the e2e test
 * owner (creating it on a fresh data folder).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const [scenarioPath, base = 'http://127.0.0.1:5173'] = process.argv.slice(2);
const dir = process.env.SHOT_DIR ?? path.join(os.tmpdir(), 'everloom-shots');
mkdirSync(dir, { recursive: true });
const width = Number(process.env.SHOT_WIDTH ?? 1280), height = Number(process.env.SHOT_HEIGHT ?? 800);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ baseURL: base, viewport: { width, height }, deviceScaleFactor: 1, ...(width < 700 ? { isMobile: true, hasTouch: true } : {}) });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (process.env.SHOT_LOG) console.log('[page]', m.type(), m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const USER = 'owner', PASS = 'correct horse battery';
await page.goto('/');
const csrf = async () => (await page.evaluate(async () => (await fetch('/api/auth/status')).json())).csrf;
await page.waitForTimeout(1500);
if (await page.getByRole('button', { name: 'Create account' }).isVisible().catch(() => false)) {
  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password', { exact: true }).fill(PASS);
  await page.getByLabel('Confirm password').fill(PASS);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForTimeout(1500);
  if (await page.getByText('Full RPG').isVisible().catch(() => false)) await page.getByText('Full RPG').click();
} else if (await page.getByRole('button', { name: 'Sign in' }).isVisible().catch(() => false)) {
  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password').fill(PASS);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(1500);
}
const helpers = {
  csrf,
  async api(method, url, body) {
    return page.evaluate(async ([method, url, body]) => {
      const s = await (await fetch('/api/auth/status')).json();
      const r = await fetch(url, { method, headers: { 'x-csrf-token': s.csrf, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: await r.json().catch(() => null) };
    }, [method, url, body]);
  },
  /** Selects files from disk into the n-th file input inside `scope` (a CSS selector). */
  async pick(files, scope = 'body', index = 0) {
    await page.locator(`${scope} input[type=file]`).nth(index).setInputFiles(files);
  },
  async tab(name) { await page.getByRole('tab', { name, exact: true }).click(); await page.waitForTimeout(500); },
  async ready(timeout = 90000) { await page.locator('[data-testid=avatar-preview][data-state=ready]').waitFor({ timeout }); },
};
const shot = async (name, opts = {}) => { const file = path.join(dir, `${name}.png`); await page.screenshot({ path: file, ...opts }); console.log('shot', file); return file; };
const scenario = (await import(pathToFileURL(path.resolve(scenarioPath)).href)).default;
try {
  await scenario({ page, shot, helpers, dir });
} catch (e) {
  console.error('SCENARIO FAILED:', e);
  await shot('failure').catch(() => {});
  process.exitCode = 1;
} finally {
  if (errors.length) console.log('console errors:', errors.slice(0, 10));
  await browser.close();
}
