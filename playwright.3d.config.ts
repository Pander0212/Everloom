import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
// Long acceptance runs must keep the exact web build they started with. The copy is made once in the
// runner (workers load this file again and inherit the environment) and removed when the run ends.
let webSnapshot = process.env.E2E_WEB_DIR;
if (!webSnapshot) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'everloom-3d-web-'));
  cpSync(path.resolve('apps/web/dist'), dir, { recursive: true });
  process.env.E2E_WEB_DIR = webSnapshot = dir;
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
}
const servers = Array.isArray(base.webServer) ? base.webServer : base.webServer ? [base.webServer] : [];
/** Real-file acceptance matrix, separate from the broad regression suite. */
export default defineConfig({
  ...base,
  timeout: 240_000,
  webServer: servers.map(server => server.env?.EVERLOOM_WEB_DIR ? { ...server, env: { ...server.env, EVERLOOM_WEB_DIR: webSnapshot } } : server),
  projects: [
    { name: 'setup', testMatch: /global\.setup\.ts/ },
    ...(['chromium', 'firefox'] as const).flatMap(browserName => [390, 1280].map(width => ({
      name: `real-${browserName}-${width}`,
      testMatch: /real-models\.spec\.ts/,
      dependencies: ['setup'],
      use: { browserName, viewport: { width, height: width === 390 ? 844 : 800 }, hasTouch: width === 390, storageState: 'tests/e2e/.artifacts/auth.json', launchOptions: browserName === 'chromium' ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : { firefoxUserPrefs: { 'webgl.force-enabled': true } } },
    }))),
  ],
});
