import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.E2E_PORT ?? 8799);
const MOCK = Number(process.env.E2E_MOCK_PORT ?? 5099);
const DATA = process.env.E2E_DATA ?? path.join(os.tmpdir(), `everloom-e2e-${Date.now()}`);
process.env.E2E_BASE = `http://127.0.0.1:${PORT}`;
process.env.E2E_MOCK = `http://127.0.0.1:${MOCK}/v1`;

const viewports = {
  'phone-390': { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  'phone-360': { viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  'landscape-844': { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  'desktop-1280': { viewport: { width: 1280, height: 800 } },
} as const;

const projects = Object.entries(viewports).flatMap(([name, vp]) =>
  (['dark', 'light'] as const).map((theme) => ({
    name: `${name}-${theme}`,
    testIgnore: /real-models\.spec\.ts/,
    use: { ...devices['Desktop Chrome'], ...vp, colorScheme: theme, storageState: 'tests/e2e/.artifacts/auth.json' },
    dependencies: ['setup'],
  })),
);

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'tests/e2e/.artifacts/results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'setup', testMatch: /global\.setup\.ts/ }, ...projects],
  webServer: [
    { command: `npx tsx tests/mock-llm/server.ts ${MOCK}`, port: MOCK, reuseExistingServer: false },
    {
      command: `node --import tsx apps/server/src/index.ts`,
      port: PORT,
      reuseExistingServer: false,
      env: { PORT: String(PORT), EVERLOOM_DATA_DIR: DATA, EVERLOOM_SOURCE_FIXTURES: path.resolve('tests/fixtures/sources/chub'), EVERLOOM_WEB_DIR: process.env.E2E_WEB_DIR ?? path.resolve('apps/web/dist'), LOG_LEVEL: 'error' },
    },
  ],
});
