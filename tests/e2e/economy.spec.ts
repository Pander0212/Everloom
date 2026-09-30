import { api, expect, mockControl, test } from './fixtures';
import type { Page } from '@playwright/test';

async function openTool(page: Page, name: string) {
  await page.getByRole('button', { name: 'Actions and tools' }).click();
  await page.getByLabel('Search tools and actions').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

async function closeSheet(page: Page) {
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

const state = async (page: Page, campaignId: string) => (await api(page, 'GET', `/api/campaigns/${campaignId}`)).state;

/** A fantasy campaign in Millbrook with 50 gold, a grocer and a rented house. */
async function setup(page: Page) {
  const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Wren Hale' } });
  const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, greeting: false });
  const config = {
    title: 'Hearth and Coin',
    style: 'fantasy',
    seed: 7,
    character: { name: 'Anala', className: 'Cook', resourceProfile: 'hybrid', level: 1, age: 24, ageStage: 'Adult', customBars: [] },
    appearance: '',
    currency: { name: 'Gold', symbol: 'g', amount: 50 },
    groups: [],
    trackers: [],
    items: [{ name: 'Old Boots', qty: 1, category: 'clothing' }],
    skills: [],
    quests: [],
    npcs: [{ name: 'Marta Reed', role: 'Grocer' }],
    location: { world: 'Aerth', region: 'Greenmarch', local: 'Millbrook', description: 'A market town.' },
    startDate: { year: 2026, month: 7, day: 1, hour: 10 },
    dayLength: { mode: 'turns', realMinutesPerDay: 20 },
    facts: [],
  };
  await api(page, 'POST', `/api/chats/${chat.id}/newgame`, { config, opening: false });
  const r = await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, {
    chatId: chat.id,
    ops: [
      { type: 'shop.upsert', name: 'Reed Grocery', kind: 'general', npc: 'Marta Reed', location: 'Millbrook', open: 480, close: 1200, stock: [{ name: 'Flour', category: 'material', price: 1, qty: 10 }, { name: 'Herbs', category: 'material', price: 1, qty: 10 }] },
      { type: 'home.add', name: 'Lane Cottage', kind: 'house', location: 'Millbrook', ownership: 'rented', rent: 12, primary: true },
    ],
  });
  expect(r.errors).toEqual([]);
  return chat;
}

test.describe('economy and home', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('shopping → crafting at home → paying rent', async ({ page, errors }) => {
    const chat = await setup(page);
    await page.goto(`/chat/${chat.id}`);

    // Shop: buy Flour and Herbs from the only shop here, then sell the boots.
    await openTool(page, 'Shops');
    await expect(page.getByRole('dialog', { name: 'Reed Grocery' })).toBeVisible();
    await page.getByRole('button', { name: 'Buy Flour' }).click();
    await expect.poll(async () => Object.values((await state(page, chat.campaignId)).inventory).map((i: any) => i.name)).toContain('Flour');
    await page.getByRole('button', { name: 'Buy Herbs' }).click();
    await expect.poll(async () => Object.values((await state(page, chat.campaignId)).inventory).map((i: any) => i.name)).toContain('Herbs');
    const beforeSell = (await state(page, chat.campaignId)).player.currency;
    expect(beforeSell).toBeLessThan(50);
    await page.getByRole('tab', { name: 'Sell' }).click();
    await page.getByRole('button', { name: 'Sell Old Boots' }).click();
    await expect.poll(async () => (await state(page, chat.campaignId)).player.currency).toBeGreaterThan(beforeSell);
    await closeSheet(page);

    // Crafting at home: the cottage kitchen is the cooking station for Herb Bread.
    await openTool(page, 'Home');
    await expect(page.getByRole('dialog', { name: 'Home' })).toContainText('Lane Cottage');
    await page.getByRole('button', { name: 'Cook' }).click();
    const bread = page.getByRole('listitem').filter({ hasText: 'Herb Bread' });
    await expect(bread.getByRole('button', { name: 'Make' })).toBeEnabled();
    await bread.getByRole('button', { name: 'Make' }).click();
    await expect
      .poll(async () => Object.values((await state(page, chat.campaignId)).inventory).map((i: any) => i.name))
      .toEqual(expect.arrayContaining([expect.stringMatching(/Herb Bread/)]));
    const s1 = await state(page, chat.campaignId);
    expect(s1.player.crafting?.cooking?.xp ?? 0).toBeGreaterThan(0);
    await closeSheet(page);

    // Rent: the bill shows in Money → Bills and paying it takes the money and moves the due date.
    await openTool(page, 'Money');
    await page.getByRole('tab', { name: 'Bills' }).click();
    const bill = Object.values(s1.economy.bills)[0] as any;
    await expect(page.getByText('Lane Cottage', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: /^Pay / }).click();
    await expect.poll(async () => (Object.values((await state(page, chat.campaignId)).economy.bills)[0] as any).nextDue).toBeGreaterThan(bill.nextDue);
    const s2 = await state(page, chat.campaignId);
    expect(s2.player.currency).toBeCloseTo(s1.player.currency - 12, 2);
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByRole('list', { name: 'Transactions' })).toContainText('Lane Cottage');
    expect(errors).toEqual([]);
  });
});
