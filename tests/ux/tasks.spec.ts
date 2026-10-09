import { expect, test, type Page } from '@playwright/test';
import { api, dismissToasts, mockControl, Probe, saveJson, seedWorld, visibleControls } from './helpers';

/**
 * Task tests (docs/ux/task-tests.md): nine common things a player does on a phone, each started
 * from the play screen of a game chat, counting taps, scrolls to reach a control, and time. The
 * flows follow the shortest path a player can see on screen (no typing into search boxes unless
 * that is the path). UX_LABEL names the run (before / after).
 */
const LABEL = process.env.UX_LABEL ?? 'after';
const results: Record<string, { taps: number; scrolls: number; ms: number }> = {};

type Ctx = { chatId: string; campaignId: string };
type Flow = (page: Page, p: Probe, c: Ctx) => Promise<void>;

const sheet = (page: Page, name: RegExp | string) => page.getByRole('dialog', { name });

const FLOWS: Record<string, Flow> = {
  'Send a message and swipe': async (page, p) => {
    await p.type(page.getByLabel('Message', { exact: true }), 'Something cold, please.');
    await p.tap(page.getByRole('button', { name: 'Send' }));
    await expect(page.getByText(/Iced lemon tea, on the house/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'New swipe' })).toBeEnabled({ timeout: 15_000 });
    await mockControl({ story: 'Tobias waves from the doorway.' });
    await p.tap(page.getByRole('button', { name: 'New swipe' }));
    await expect(page.getByText('Tobias waves from the doorway.')).toBeVisible();
    await mockControl({ story: null });
  },
  'Edit a message': async (page, p) => {
    const msg = page.locator('[id^="msg-"]').filter({ hasText: /What can I get you/ }).last();
    await p.tap(msg.getByRole('button', { name: 'Message actions' }));
    await p.tap(page.getByRole('menuitem', { name: 'Edit' }));
    await p.type(page.getByLabel('Edit message'), 'Iris dries a glass. "What can I get you?"');
    await p.tap(page.getByRole('button', { name: 'Save', exact: true }));
    await expect(page.getByText('Iris dries a glass.')).toBeVisible();
  },
  "Change the character's outfit": async (page, p, c) => {
    await p.tap(page.getByRole('button', { name: 'Actions and tools' }));
    await p.tap(page.getByRole('button', { name: 'Inventory', exact: true }));
    await p.tap(sheet(page, /Inventory/).getByRole('button', { name: /Summer dress/ }).first());
    await p.tap(page.getByRole('button', { name: 'Equip', exact: true }));
    await expect.poll(async () => Object.values((await api(page, 'GET', `/api/campaigns/${c.campaignId}`)).state.inventory).find((i: any) => i.name === 'Summer dress')?.equipped).toBe(true);
  },
  'Open the map and travel': async (page, p, c) => {
    await p.tap(page.getByRole('button', { name: 'Actions and tools' }));
    await p.tap(page.getByRole('button', { name: 'Map', exact: true }));
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await p.tap(page.getByRole('button', { name: /^Eastport/ }).first());
    await p.tap(sheet(page, 'Eastport').getByRole('button', { name: 'Travel here' }));
    await expect.poll(async () => { const s = (await api(page, 'GET', `/api/campaigns/${c.campaignId}`)).state; return s.locations[s.currentLocationId]?.name; }).toBe('Eastport');
  },
  'Check the inventory': async (page, p) => {
    await p.tap(page.getByRole('button', { name: 'Actions and tools' }));
    await p.tap(page.getByRole('button', { name: 'Inventory', exact: true }));
    await expect(sheet(page, /Inventory/).getByText('Umbrella')).toBeVisible();
  },
  'Change the model': async (page, p) => {
    await p.tap(page.getByRole('button', { name: 'Back' }));
    await p.tap(page.getByRole('link', { name: 'Settings' }));
    await p.tap(page.getByRole('link', { name: /Connections/ }).first());
    await p.choose(page.getByLabel('Main model'), { label: 'Second model — mock-story' });
    await expect(page.getByLabel('Main model')).toHaveValue(/.+/);
  },
  'Turn a feature off': async (page, p) => {
    await p.tap(page.getByRole('button', { name: 'Back' }));
    await p.tap(page.getByRole('link', { name: 'Settings' }));
    await p.tap(page.getByRole('link', { name: /Features/ }).first());
    await p.tap(page.getByRole('switch', { name: 'Diary' }));
    await expect(page.getByRole('switch', { name: 'Diary' })).not.toBeChecked();
  },
  'Find the memory screen': async (page, p) => {
    await p.tap(page.getByRole('button', { name: 'Chat menu' }));
    await p.tap(page.getByRole('menuitem', { name: 'Memory' }));
    await expect(sheet(page, /Memory/)).toBeVisible();
  },
  'Start a new chat with a character': async (page, p) => {
    await p.tap(page.getByRole('button', { name: 'Back' }));
    await p.tap(page.getByRole('button', { name: 'New chat' }).first());
    await p.tap(sheet(page, 'New chat').getByRole('button', { name: /Iris Thorne/ }).first());
    await p.tap(page.getByRole('button', { name: 'Start chat' }));
    await expect(page).toHaveURL(/\/chat\//);
  },
};

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
