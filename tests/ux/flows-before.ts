import { expect, type Page } from '@playwright/test';
import { api, mockControl, type Probe } from './helpers';

export type Ctx = { chatId: string; campaignId: string };
export type Flow = (page: Page, p: Probe, c: Ctx) => Promise<void>;
const sheet = (page: Page, name: RegExp | string) => page.getByRole('dialog', { name });

/** The nine tasks on the UI before the redesign (commit ad35fed): the "+" drawer, the ⋯ menus and Settings. */
export const FLOWS_BEFORE: Record<string, Flow> = {
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

