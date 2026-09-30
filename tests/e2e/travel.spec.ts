import { api, expect, mockControl, test } from './fixtures';
import type { Page } from '@playwright/test';

async function openTool(page: Page, name: string) {
  await page.getByRole('button', { name: 'Actions and tools' }).click();
  await page.getByLabel('Search tools and actions').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

const state = async (page: Page, campaignId: string) => (await api(page, 'GET', `/api/campaigns/${campaignId}`)).state;
const here = (s: any) => s.locations[s.currentLocationId]?.name;

/** A modern city with a train line from Northcrest to Eastport, a friend waiting there and a guarded palace. */
async function setup(page: Page) {
  const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Iris Thorne' } });
  const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, greeting: false });
  const config = {
    title: 'Rain Town',
    style: 'modern',
    seed: 3,
    character: { name: 'Anala', className: 'Courier', resourceProfile: 'hybrid', level: 1, age: 24, ageStage: 'Adult', customBars: [] },
    appearance: '',
    currency: { name: 'Dollars', symbol: '$', amount: 40 },
    groups: [],
    trackers: [],
    items: [],
    skills: [],
    quests: [],
    npcs: [],
    location: { world: 'Earth', region: 'Greenmarch', local: 'Northcrest', description: 'A rainy city.', kind: 'station' },
    startDate: { year: 2026, month: 7, day: 1, hour: 10 },
    dayLength: { mode: 'turns', realMinutesPerDay: 20 },
    facts: [],
  };
  await api(page, 'POST', `/api/chats/${chat.id}/newgame`, { config, opening: false });
  const r = await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, {
    chatId: chat.id,
    ops: [
      { type: 'location.upsert', name: 'Eastport', level: 'local', kind: 'station', parent: 'Greenmarch', x: 700, y: 300 },
      { type: 'location.upsert', name: 'Palace', level: 'local', kind: 'landmark', parent: 'Greenmarch', x: 650, y: 650 },
      { type: 'npc.upsert', name: 'Mara Quill', location: 'Eastport' },
      { type: 'transit.add', name: 'Coast Line', mode: 'train', stops: ['Northcrest', 'Eastport'], first: '06:00', last: '22:00', every: 30, hop: 25, fare: 3 },
      { type: 'route.require', from: 'Eastport', to: 'Palace', requires: [{ kind: 'item', name: 'Palace Pass' }] },
    ],
  });
  expect(r.errors).toEqual([]);
  return chat;
}

test.describe('travel', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('transit with a ticket → arrival → a blocked route explains the fix', async ({ page, errors }) => {
    const chat = await setup(page);
    await page.goto(`/chat/${chat.id}`);
    await openTool(page, 'Map');
    await expect(page.getByTestId('map-canvas')).toBeVisible();

    // Journeys: buy a ticket, then ride with it.
    await page.getByRole('button', { name: 'Journeys' }).click();
    const sheet = page.getByRole('dialog', { name: 'Journeys' });
    await sheet.getByRole('button', { name: /Buy a ticket/ }).click();
    await expect(sheet.getByText('1 ticket')).toBeVisible();
    await expect.poll(async () => (await state(page, chat.campaignId)).player.currency).toBe(37);
    await sheet.getByRole('button', { name: 'Ride the Coast Line to Eastport' }).click();
    await expect.poll(async () => here(await state(page, chat.campaignId))).toBe('Eastport');
    const s1 = await state(page, chat.campaignId);
    expect(s1.player.currency).toBe(37);
    expect(Object.values(s1.inventory).some((i: any) => i.name === 'Ticket: Coast Line')).toBe(false);
    expect(s1.travelLog).toHaveLength(1);
    // Arrival: who's there, shown in the sheet.
    await expect(sheet.locator('section[aria-label="On arrival"]')).toContainText('Here: Mara Quill');
    await expect(sheet.locator('section[aria-label="Travel history"]')).toContainText('Northcrest → Eastport');
    await expect(sheet.locator('section[aria-label="Recent places"]')).toContainText('Northcrest');
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();

    // Visited overlay marks where you've been.
    await page.getByRole('button', { name: 'Visited', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Northcrest, visited' })).toBeVisible();

    // The palace needs a pass: code says why and what to do.
    await page.getByRole('button', { name: /^Palace/ }).click();
    const place = page.getByRole('dialog', { name: 'Palace' });
    await expect(place.getByRole('list', { name: "What's in the way" })).toContainText('Needs Palace Pass');
    await expect(place.getByRole('button', { name: 'Travel here' })).toBeDisabled();
    await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'item.add', name: 'Palace Pass' }] });
    await expect(place.getByRole('button', { name: 'Travel here' })).toBeEnabled();
    await place.getByRole('button', { name: 'Travel here' }).click();
    await expect.poll(async () => here(await state(page, chat.campaignId))).toBe('Palace');
    expect(errors).toEqual([]);
  });
});
