import { defineConfig, devices } from '@playwright/test';
import { cpSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * UX measurements (docs/ux/): task tests that count taps and time on a phone, the play screen's
 * visible controls, and screenshots for the audit. Separate ports, data and sign-in from the main
 * suite, so both can run at once. `UX_PRESET=classic|story|full` picks the first-run preset.
 *
 *   npx playwright test --config playwright.ux.config.ts
 */
const PORT = Number(process.env.UX_PORT ?? 8798);
const MOCK = Number(process.env.UX_MOCK_PORT ?? 5098);
const DATA = process.env.UX_DATA ?? path.join(os.tmpdir(), `everloom-ux-${Date.now()}`);
process.env.E2E_BASE = `http://127.0.0.1:${PORT}`;
process.env.E2E_MOCK = `http://127.0.0.1:${MOCK}/v1`;
// Keep the web build the run started with, even if it is rebuilt meanwhile.
const web = process.env.E2E_WEB_DIR ?? mkdtempSync(path.join(os.tmpdir(), 'everloom-ux-web-'));
if (!process.env.E2E_WEB_DIR) cpSync(path.resolve('apps/web/dist'), web, { recursive: true });
const AUTH = 'tests/ux/.artifacts/auth.json';

const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

export default defineConfig({
  testDir: 'tests/ux',
  outputDir: 'tests/ux/.artifacts/results',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'setup', testMatch: /setup\.ts/ },
    { name: 'phone', testMatch: /\.spec\.ts/, dependencies: ['setup'], use: { ...devices['Desktop Chrome'], ...phone, colorScheme: 'dark', storageState: AUTH } },
    { name: 'phone-light', testMatch: /screens\.spec\.ts/, dependencies: ['setup'], use: { ...devices['Desktop Chrome'], ...phone, colorScheme: 'light', storageState: AUTH } },
    { name: 'desktop', testMatch: /(screens|themes|scenery)\.spec\.ts/, dependencies: ['setup'], use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, colorScheme: 'dark', storageState: AUTH } },
  ],
  webServer: [
    { command: `npx tsx tests/mock-llm/server.ts ${MOCK}`, port: MOCK, reuseExistingServer: false },
    {
      command: `node --import tsx apps/server/src/index.ts`,
      port: PORT,
      reuseExistingServer: false,
      env: { PORT: String(PORT), EVERLOOM_DATA_DIR: DATA, EVERLOOM_WEB_DIR: web, LOG_LEVEL: 'error' },
    },
  ],
});
