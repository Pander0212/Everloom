import { api, expect, MOCK, mockControl, test } from './fixtures';
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
  // Tools with news carry a count in their name ("Phone, 1 new").
  await page.getByRole('button', { name: new RegExp(`^${name}(,|$)`) }).first().click();
}

const state = async (page: Page, campaignId: string) => (await api(page, 'GET', `/api/campaigns/${campaignId}`)).state;

test.describe('depth', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('phone, diary with photo, helper, activities, battle and atmosphere', async ({ page, errors }) => {
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Iris Thorne', first_mes: 'Iris wipes the counter.' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
    const img = await api(page, 'POST', '/api/connections', { name: 'Mock images', provider: 'img-openai', baseUrl: MOCK(), model: 'mock-image' });
    await api(page, 'PATCH', '/api/settings', { roles: { image: img.id } });
    await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'npc.upsert', name: 'Tobias', role: 'Drummer' }, { type: 'phone.notify', npc: 'Tobias', reason: 'rehearsal news' }] });
    await page.goto(`/chat/${chat.id}`);

    // Phone: the waiting text is written on open, then a reply to ours.
    await openTool(page, 'Phone');
    await page.getByRole('dialog', { name: 'Codex' }).getByRole('button', { name: /Tobias/ }).first().click();
    await expect(page.getByText(/rehearsal was a mess/).first()).toBeVisible({ timeout: 15000 });
    await page.getByLabel('Message Tobias').fill('See you tonight');
    await page.getByLabel('Message Tobias').press('Enter');
    await expect(page.getByText('See you tonight')).toBeVisible();
    await expect(page.getByText(/rehearsal was a mess/)).toHaveCount(2);
    await closeSheets(page);

    // Diary: AI draft, a snapped photo, a sticker, save.
    await openTool(page, 'Diary');
    await page.getByRole('button', { name: 'Write today’s page' }).click();
    await expect(page.getByLabel('Title')).toHaveValue('Rain and lanterns');
    await page.getByRole('button', { name: 'Snap the scene' }).click();
    await expect(page.getByLabel('Caption')).toBeVisible();
    await page.getByLabel('Caption').fill('Lantern street');
    await page.getByRole('button', { name: 'Sticker' }).click();
    await page.getByRole('button', { name: 'Add star sticker' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save page' }).click();
    await expect(page.getByRole('heading', { name: 'Rain and lanterns' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Lantern street' })).toBeVisible();
    await closeSheets(page);

    // Helper proposes, we accept.
    await openTool(page, 'Helper');
    await page.getByRole('button', { name: 'What should I do next?' }).click();
    await expect(page.getByText('Here is a potion idea for you.')).toBeVisible();
    await page.getByRole('button', { name: 'Do it' }).click();
    await expect.poll(async () => Object.values((await state(page, chat.campaignId)).inventory).map((i: any) => i.name)).toContain('Minor Healing Potion');
    await closeSheets(page);

    // Activities: sleep without narrating.
    const before = (await state(page, chat.campaignId)).time.minutes;
    await openTool(page, 'Activities');
    await page.getByRole('radio', { name: 'Sleep' }).click();
    await page.getByRole('switch', { name: 'Write it into the story' }).click();
    await page.getByRole('button', { name: /^Sleep for/ }).click();
    await expect.poll(async () => (await state(page, chat.campaignId)).time.minutes - before).toBeGreaterThanOrEqual(8 * 60);
    await closeSheets(page);

    // Battle against a rat until it ends.
    await openTool(page, 'Battle');
    await page.getByLabel('Opponent').fill('Rat');
    await page.getByRole('button', { name: 'Start battle' }).click();
    for (let i = 0; i < 25; i++) {
      if (await page.getByRole('button', { name: 'Close battle' }).count()) break;
      const attack = page.getByRole('button', { name: 'Attack', exact: true });
      await expect(attack).toBeEnabled();
      await attack.click();
      await page.waitForTimeout(150);
    }
    await expect(page.getByRole('heading', { name: /Victory|Defeat|Escaped/ })).toBeVisible();
    await page.getByRole('button', { name: 'Close battle' }).click();
    await expect.poll(async () => (await state(page, chat.campaignId)).battle).toBeNull();
    await closeSheets(page);

    // Atmosphere: paint the scene as the chat background.
    await openTool(page, 'Atmosphere');
    await page.getByRole('button', { name: 'Paint this scene' }).click();
    await expect(page.getByRole('img', { name: 'Current background' })).toBeVisible();
    expect((await api(page, 'GET', `/api/chats/${chat.id}`)).metadata.background).toBeTruthy();
    await closeSheets(page);
    expect(errors).toEqual([]);
  });
});
