import { api, expect, mockControl, test } from './fixtures';
import type { Page } from '@playwright/test';

async function closeSheets(page: Page) {
  await page.waitForTimeout(300);
  for (let i = 0; i < 6; i++) {
    const btn = page.getByRole('button', { name: 'Close', exact: true });
    if (!(await btn.count())) break;
    await btn.last().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function openTool(page: Page, name: string) {
  await page.getByRole('button', { name: 'Actions and tools' }).click();
  await page.getByLabel('Search tools and actions').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

const state = async (page: Page, campaignId: string) => (await api(page, 'GET', `/api/campaigns/${campaignId}`)).state;

test.describe('world', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('new game wizard → opening scene → map expand, travel and landmark → organizations', async ({ page, errors }) => {
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Iris Thorne' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, greeting: false });
    await page.goto(`/chat/${chat.id}`);

    // Wizard from the empty state.
    await page.getByRole('button', { name: 'Set up a new game' }).click();
    await page.getByLabel('Title').fill('Rain Town');
    await page.getByRole('radio', { name: 'Modern' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Name').fill('Anala');
    await page.getByLabel('Class or role').fill('Courier');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Region').fill('Greenmarch');
    await page.getByLabel('Starting place').fill('Northcrest');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Add item' }).click();
    await page.getByLabel('Item name').fill('Umbrella');
    await page.getByRole('button', { name: 'Begin' }).click();
    await expect(page.getByText('Umbrella')).toBeVisible();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    // Opening scene streams into the chat.
    await expect.poll(async () => (await api(page, 'GET', `/api/chats/${chat.id}/messages`)).length, { timeout: 15000 }).toBe(1);
    await expect(page.getByText('Say something to begin.')).toHaveCount(0);
    await expect.poll(async () => (await state(page, chat.campaignId)).player.name).toBe('Anala');
    const s0 = await state(page, chat.campaignId);
    expect(s0.locations[s0.currentLocationId].name).toBe('Northcrest');
    expect(Object.values(s0.inventory).map((i: any) => i.name)).toContain('Umbrella');
    await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0, { timeout: 15000 });

    // Map: expand with AI adds unexplored places next to Northcrest, then travel to one.
    await openTool(page, 'Map');
    await expect(page.getByTestId('map-canvas')).toBeVisible();
    await expect(page.getByRole('button', { name: /Northcrest, you are here/ })).toBeVisible();
    await page.getByRole('button', { name: 'Expand with AI' }).click();
    await expect(page.getByRole('button', { name: 'Old Pier, unexplored' })).toBeVisible();
    await page.getByRole('button', { name: 'Old Pier, unexplored' }).click();
    await expect(page.getByRole('radiogroup', { name: 'Travel mode' })).toBeVisible();
    await page.getByRole('button', { name: 'Travel here' }).click();
    await expect.poll(async () => {
      const s = await state(page, chat.campaignId);
      return s.locations[s.currentLocationId]?.name;
    }).toBe('Old Pier');
    await expect(page.getByRole('button', { name: /Old Pier, you are here/ })).toBeVisible();

    // Place a landmark by tapping the map.
    await page.getByRole('button', { name: 'Place landmark' }).click();
    const box = (await page.getByTestId('map-canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.7);
    await page.getByLabel('Name').fill('Clock Tower');
    await page.getByRole('button', { name: 'Place', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Clock Tower/ })).toBeVisible();
    await closeSheets(page);

    // Organizations: add one, a rule and a run-in.
    await openTool(page, 'Organizations');
    await page.getByRole('button', { name: 'Add organization' }).click();
    await page.getByLabel('Name').fill('Lantern Guild');
    await page.getByLabel('Type').fill('Guild');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: /Lantern Guild/ }).click();
    await page.getByRole('tab', { name: 'Rules' }).click();
    await page.getByLabel('Add a rule or custom').fill('No open flames after dark');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('tab', { name: 'Run-ins' }).click();
    await page.getByLabel('Note a run-in').fill('Paid a toll at the bridge');
    await page.getByRole('button', { name: 'Add run-in' }).click();
    await expect(page.getByText('Paid a toll at the bridge')).toBeVisible();
    const s1 = await state(page, chat.campaignId);
    const org = Object.values(s1.orgs).find((o: any) => o.name === 'Lantern Guild') as any;
    expect(org.rules).toEqual(['No open flames after dark']);
    expect(org.runins).toHaveLength(1);
    await closeSheets(page);

    // Social and persona screens open cleanly.
    await openTool(page, 'Social');
    await closeSheets(page);
    await openTool(page, 'Persona');
    await expect(page.getByLabel('Name')).toHaveValue('Anala');
    await closeSheets(page);
    expect(errors).toEqual([]);
  });
});
