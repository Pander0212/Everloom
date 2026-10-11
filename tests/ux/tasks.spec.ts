import { expect, test } from '@playwright/test';
import { api, dismissToasts, mockControl, Probe, saveJson, seedWorld, visibleControls } from './helpers';
import { FLOWS_BEFORE } from './flows-before';
import { FLOWS_AFTER } from './flows-after';

/**
 * Task tests (docs/ux/task-tests.md): nine common things a player does on a phone, each started
 * from the play screen of a game chat, counting taps, scrolls to reach a control, and time. The
 * flows follow the shortest path a player can see on screen (no typing into search boxes unless
 * that is the path). UX_LABEL picks the flows and names the run: `before` needs the old web build
 * (E2E_WEB_DIR=<dist of commit ad35fed>), `after` the current one.
 */
const LABEL = process.env.UX_LABEL ?? 'after';
const results: Record<string, { taps: number; scrolls: number; ms: number }> = {};

const FLOWS = LABEL === 'before' ? FLOWS_BEFORE : FLOWS_AFTER;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await mockControl({ reset: true });
});

test('play screen: visible controls', async ({ page }) => {
  const { chat } = await seedWorld(page);
  await page.goto(`/chat/${chat.id}`);
  await page.getByLabel('Message', { exact: true }).fill('Hello there.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(/Iced lemon tea, on the house/)).toBeVisible();
  await page.waitForTimeout(2500);
  await dismissToasts(page);
  const controls = await visibleControls(page);
  saveJson(`controls-${LABEL}.json`, { count: controls.length, controls });
});

for (const [name, flow] of Object.entries(FLOWS)) {
  test(`task: ${name}`, async ({ page }) => {
    await mockControl({ reset: true });
    const { chat } = await seedWorld(page);
    if (name === 'Change the model') await api(page, 'POST', '/api/connections', { name: 'Second model', provider: 'openai', baseUrl: process.env.E2E_MOCK, model: 'mock-story' });
    await page.goto(`/chat/${chat.id}`);
    await expect(page.getByLabel('Message', { exact: true })).toBeVisible();
    await page.waitForTimeout(800);
    const p = new Probe(page);
    await flow(page, p, { chatId: chat.id, campaignId: chat.campaignId });
    results[name] = p.result();
  });
}

test.afterAll(() => {
  saveJson(`tasks-${LABEL}.json`, results);
});
