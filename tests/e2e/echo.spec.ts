import type { Page } from '@playwright/test';
import { api, expect, mockControl, test } from './fixtures';

async function openMemory(page: Page) {
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByLabel('Search tools, settings and the story').fill('Memory');
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
}

test.describe('ECHO inspector', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('turn ECHO on, see who knows what, decide a twist behind the spoiler guard', async ({ page }) => {
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Iris Thorne', first_mes: 'Iris wipes the counter.' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
    await api(page, 'PATCH', `/api/chats/${chat.id}/echo`, { profile: 'balanced' });
    await api(page, 'POST', `/api/chats/${chat.id}/echo/events`, {
      events: [
        { type: 'speech', actors: ['Iris Thorne'], to: ['player'], action: 'Iris told the player the Ravens rehearse at the old chapel', says: [{ s: 'ravens', p: 'rehearse_at', o: 'old chapel', text: 'the Ravens rehearse at the old chapel' }], observers: [{ actor: 'player', place: 'here', sight: true, hearing: 'clear', awake: true, impairment: 0, attention: 1 }] },
        { type: 'world', action: 'A locked iron box sits behind the bar', undetermined: [{ s: 'box', p: 'contains', label: 'what is in the iron box', candidates: ['a letter', 'a map'] }] },
      ],
    });
    await page.goto(`/chat/${chat.id}`);
    await openMemory(page);
    const sheet = page.getByRole('dialog', { name: 'Memory' });
    await sheet.getByRole('tab', { name: 'ECHO' }).click();
    await expect(sheet.getByText('2 events')).toBeVisible();
    await expect(sheet.getByText(/told by Iris Thorne/)).toBeVisible();
    // Undecided details: the twist can only be chosen with spoilers shown.
    await sheet.getByRole('radio', { name: 'Undecided' }).click();
    await expect(sheet.getByText('what is in the iron box')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Decide' })).toHaveCount(0);
    await sheet.getByText('Show spoilers').click();
    await sheet.getByLabel('Decide what is in the iron box').selectOption('a map');
    await sheet.getByRole('button', { name: 'Decide' }).click();
    await expect(page.getByText('Twist decided')).toBeVisible();
    await expect(sheet.getByText('Decided: a map')).toBeVisible();
    await page.screenshot({ path: `test-results/echo-${test.info().project.name}.png`, fullPage: false });
  });
});
