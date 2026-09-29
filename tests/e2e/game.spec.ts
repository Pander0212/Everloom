import { api, expect, mockControl, test } from './fixtures';
import type { Page } from '@playwright/test';

async function freshChat(page: Page) {
  const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Iris Thorne', first_mes: 'Iris wipes the counter. "What can I get you?"' } });
  const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
  await page.goto(`/chat/${chat.id}`);
  return chat;
}

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

test.describe('game core', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('tracker updates the HUD, inventory use, NPCs, journal, calendar and stage mode', async ({ page, errors }) => {
    const chat = await freshChat(page);
    await expect(page.getByRole('button', { name: 'Status' })).toContainText('8:00 AM');
    await page.getByLabel('Message', { exact: true }).fill('Something cold, please.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(/Iced lemon tea, on the house/)).toBeVisible();
    // Tracker pass → toast + HUD time moves on.
    await expect(page.getByText('Story update')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Status' })).toContainText('8:20 AM');

    // Inventory: use the tea.
    await openTool(page, 'Inventory');
    await page.getByRole('button', { name: /Iced Lemon Tea/ }).first().click();
    await page.getByRole('button', { name: 'Use', exact: true }).click();
    await expect(page.getByText(/−1 Iced Lemon Tea/)).toBeVisible();
    await closeSheets(page);

    // NPCs: Tobias was met; edit his title.
    await openTool(page, 'NPCs');
    await page.getByRole('button', { name: /Tobias/ }).first().click();
    await page.getByLabel('Title').fill('Drummer');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => Object.values((await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.npcs).map((n: any) => n.title)).toContain('Drummer');
    await closeSheets(page);

    // Journal: add a quest and tick an objective.
    await openTool(page, 'Journal');
    await page.getByRole('button', { name: 'New quest' }).click();
    await page.getByLabel('Title').fill('Find a singer');
    await page.getByLabel('Objectives').fill('Ask Iris\nVisit the Ravens');
    await page.getByRole('button', { name: 'Add quest' }).click();
    await page.getByRole('button', { name: /Find a singer/ }).click();
    await page.getByRole('checkbox', { name: 'Ask Iris' }).click();
    await expect.poll(async () => Object.values((await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.quests).map((q: any) => q.objectives[0].done)).toEqual([true]);
    await closeSheets(page);

    // Calendar: add an event on the selected day.
    await openTool(page, 'Calendar');
    await page.getByRole('button', { name: 'Event', exact: true }).click();
    await page.getByLabel('Title').fill('Rehearsal');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Rehearsal', { exact: true })).toBeVisible();
    await closeSheets(page);

    // Stage mode
    await page.getByRole('button', { name: 'Switch to stage mode' }).click();
    await expect(page.getByLabel('Dialogue — tap to reveal or advance')).toBeVisible();
    await page.getByRole('button', { name: 'Switch to chat mode' }).click();
    expect(errors).toEqual([]);
  });
});
