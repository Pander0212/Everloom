import { api, expect, mockControl, test } from './fixtures';
import type { Page } from '@playwright/test';

async function openTool(page: Page, name: string) {
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByLabel('Search tools, settings and the story').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

/** A fantasy campaign with a potion and a sword in the bag. */
async function setup(page: Page) {
  const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Tamsin Rook' } });
  const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, greeting: false });
  const config = {
    title: 'Pictures',
    style: 'fantasy',
    seed: 11,
    character: { name: 'Odile', className: 'Scout', resourceProfile: 'hybrid', level: 1, age: 26, ageStage: 'Adult', customBars: [] },
    appearance: '',
    currency: { name: 'Gold', symbol: 'g', amount: 5 },
    groups: [],
    trackers: [],
    items: [
      { name: 'Healing Potion', qty: 2, category: 'medicine' },
      { name: 'Iron Sword', qty: 1, category: 'weapon' },
    ],
    skills: [],
    quests: [],
    npcs: [],
    location: { world: 'Aerth', region: 'Greenmarch', local: 'Millbrook', description: 'A market town.' },
    startDate: { year: 2026, month: 7, day: 1, hour: 10 },
    dayLength: { mode: 'turns', realMinutesPerDay: 20 },
    facts: [],
  };
  await api(page, 'POST', `/api/chats/${chat.id}/newgame`, { config, opening: false });
  return chat;
}

test.describe('Everloom art', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });
  test.afterEach(async ({ page }) => {
    await api(page, 'PATCH', '/api/settings', { art: { enabled: true } });
  });

  test('items show pixel-art pictures, the owner can pick another, and Illustrations off brings back the line icons', async ({ page, errors }) => {
    const chat = await setup(page);
    await page.goto(`/chat/${chat.id}`);
    await openTool(page, 'Inventory');
    const bag = page.getByRole('dialog', { name: 'Inventory' });
    await expect(bag.locator('img[src="/art/items/potion-red.png"]')).toBeVisible();
    await expect(bag.locator('img[src="/art/items/sword.png"]')).toBeVisible();
    // The picture really loaded.
    expect(await bag.locator('img[src="/art/items/sword.png"]').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(32);

    // Pick a different picture for the sword.
    await bag.getByRole('button', { name: /Iron Sword/ }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Iron Sword' });
    await sheet.getByRole('button', { name: 'Picture' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a picture' });
    await picker.getByLabel('Search pictures').fill('axe');
    await picker.getByRole('button', { name: 'axe', exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect(sheet.locator('img[src="/art/items/axe.png"]')).toBeVisible();
    await expect.poll(async () => Object.values((await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.inventory).find((i: any) => i.name === 'Iron Sword')).toMatchObject({ icon: 'art:axe' });

    // Illustrations off: line icons, no bundled pictures anywhere in the bag.
    await api(page, 'PATCH', '/api/settings', { art: { enabled: false } });
    await page.reload();
    await openTool(page, 'Inventory');
    await expect(page.getByRole('dialog', { name: 'Inventory' }).getByText('Healing Potion')).toBeVisible();
    await expect(page.locator('img[src^="/art/"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the asset library adds Everloom's backgrounds once; the demo character comes with expressions", async ({ page, errors }) => {
    const chat = await setup(page);
    await page.goto(`/chat/${chat.id}`);
    await openTool(page, 'Stage & sound');
    await page.getByRole('tab', { name: 'Sprites' }).click();
    await page.getByRole('button', { name: 'Asset library' }).click();
    const lib = page.getByRole('dialog', { name: 'Asset library' });
    await lib.getByRole('button', { name: "Add Everloom's art" }).click();
    // (Other viewports share the server's data, so the pack may already be there.)
    await expect(page.getByText(/Added \d+ of Everloom's pictures|Everloom's pictures are already here/).first()).toBeVisible();
    await lib.getByRole('radiogroup', { name: 'Type' }).getByRole('radio', { name: 'Backgrounds' }).click();
    await expect(lib.getByRole('button', { name: 'Tavern, background' })).toBeVisible();
    const count = (await api(page, 'GET', '/api/assets?tag=everloom')).assets.length;
    expect(count).toBeGreaterThanOrEqual(12);
    await lib.getByRole('button', { name: "Add Everloom's art" }).click();
    await expect(page.getByText("Everloom's pictures are already here").first()).toBeVisible();
    expect((await api(page, 'GET', '/api/assets?tag=everloom')).assets.length).toBe(count);

    const mira = await api(page, 'POST', '/api/characters/demo', {});
    expect(mira.name).toBe('Mira Vale');
    expect(Object.keys(mira.game.expressions)).toEqual(expect.arrayContaining(['neutral', 'joy', 'sadness', 'surprise']));
    expect(errors).toEqual([]);
  });
});
