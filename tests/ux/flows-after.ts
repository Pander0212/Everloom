import { expect, type Page } from '@playwright/test';
import { api, mockControl, type Probe } from './helpers';

export type Ctx = { chatId: string; campaignId: string };
export type Flow = (page: Page, p: Probe, c: Ctx) => Promise<void>;
const sheet = (page: Page, name: RegExp | string) => page.getByRole('dialog', { name });

/**
 * The flows after the redesign. The before flows (commit ad35fed) went through the "+" drawer,
 * the ⋯ menus and Settings; docs/ux/task-tests.md lists both, step by step.
 */
const palette = (page: Page) => page.getByRole('button', { name: 'Tools', exact: true });
export const FLOWS_AFTER: Record<string, Flow> = {
  'Send a message and swipe': async (page, p) => {
    await p.type(page.getByLabel('Message', { exact: true }), 'Something cold, please.');
    await p.tap(page.getByRole('button', { name: 'Send' }));
    await expect(page.getByText(/Iced lemon tea, on the house/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'New version' })).toBeEnabled({ timeout: 15_000 });
    await mockControl({ story: 'Tobias waves from the doorway.' });
    await p.tap(page.getByRole('button', { name: 'New version' }));
    await expect(page.getByText('Tobias waves from the doorway.')).toBeVisible();
    await mockControl({ story: null });
  },
  'Edit a message': async (page, p) => {
    const msg = page.locator('[id^="msg-"]').filter({ hasText: /What can I get you/ }).last();
    await p.tap(msg.getByRole('button', { name: 'Edit', exact: true }));
    await p.type(page.getByLabel('Edit message'), 'Iris dries a glass. "What can I get you?"');
    await p.tap(page.getByRole('button', { name: 'Save', exact: true }));
    await expect(page.getByText('Iris dries a glass.')).toBeVisible();
  },
  "Change the character's outfit": async (page, p, c) => {
    await p.tap(palette(page));
    await p.tap(page.getByRole('button', { name: 'Outfits', exact: true }).first());
    await p.tap(page.getByRole('button', { name: 'Wear Summer dress' }));
    await expect.poll(async () => Object.values((await api(page, 'GET', `/api/campaigns/${c.campaignId}`)).state.inventory).find((i: any) => i.name === 'Summer dress')?.equipped).toBe(true);
  },
  'Open the map and travel': async (page, p, c) => {
    await p.tap(page.getByRole('button', { name: 'Northcrest: open the map' }));
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await p.tap(page.getByRole('button', { name: /^Eastport/ }).first());
    await p.tap(sheet(page, 'Eastport').getByRole('button', { name: 'Travel here' }));
    await expect.poll(async () => { const s = (await api(page, 'GET', `/api/campaigns/${c.campaignId}`)).state; return s.locations[s.currentLocationId]?.name; }).toBe('Eastport');
  },
  'Check the inventory': async (page, p) => {
    await p.tap(palette(page));
    await p.tap(page.getByRole('button', { name: 'Inventory', exact: true }).first());
    await expect(sheet(page, /Inventory/).getByText('Umbrella')).toBeVisible();
  },
  'Change the model': async (page, p) => {
    await p.tap(page.getByRole('button', { name: /Iris Thorne/ }).first());
    await p.choose(page.getByLabel('Model', { exact: true }), { label: 'Second model — mock-story' });
    await expect(page.getByLabel('Model', { exact: true })).not.toHaveValue('');
  },
  'Turn a feature off': async (page, p) => {
    await p.tap(palette(page));
    await p.type(page.getByLabel('Search tools, settings and the story'), 'diary');
    await p.tap(page.getByRole('button', { name: 'Diary, feature switch, on' }));
    await expect(page.getByRole('button', { name: 'Diary, feature switch, off' })).toBeVisible();
  },
  'Find the memory screen': async (page, p) => {
    await p.tap(palette(page));
    await p.tap(page.getByRole('button', { name: 'Memory', exact: true }).first());
    await expect(sheet(page, /Memory/)).toBeVisible();
  },
  'Start a new chat with a character': async (page, p, c) => {
    await p.tap(palette(page));
    await p.tap(page.getByRole('button', { name: 'New chat with this character' }));
    await p.tap(page.getByRole('button', { name: 'Start chat' }));
    await expect(page).not.toHaveURL(new RegExp(c.chatId));
  },
};

