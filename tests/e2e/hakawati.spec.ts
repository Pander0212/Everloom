import { api, expect, mockControl, test, uid } from './fixtures';
import type { Page } from '@playwright/test';

/** Input modes, scenario questions, Quickstart, scenarios, story cards, undo/redo, scaling (docs/ux/hakawati.md). */

async function tool(page: Page, name: string) {
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByLabel('Search tools, settings and the story').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

test.describe('features from Hakawati', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('input modes frame the text for the model and show it as what it is', async ({ page, errors }) => {
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Mode Mara', first_mes: 'Mara waits.' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, features: 'classic' });
    await page.goto(`/chat/${chat.id}`);
    await page.getByRole('button', { name: /^Input mode/ }).click();
    await page.getByRole('radio', { name: /^Act/ }).click();
    await page.getByLabel('Message', { exact: true }).fill('open the door');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.ev-message-user em', { hasText: 'open the door' })).toBeVisible();
    await expect(page.getByText(/take 1/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Input mode/ }).click();
    await page.getByRole('radio', { name: /^Direct/ }).click();
    await page.getByLabel('Message', { exact: true }).fill('Make it scarier');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('[data-mode="direct"]')).toContainText('Direction: Make it scarier');
    await expect(page.locator('.ev-message-assistant')).toHaveCount(3, { timeout: 15_000 });
    const sent = JSON.stringify(await api(page, 'GET', `/api/chats/${chat.id}/prompt`));
    expect(sent).toContain('*open the door*');
    expect(sent).toContain('Out of character');
    // Back to plain chat for the next tests on this device.
    await page.getByRole('button', { name: /^Input mode/ }).click();
    await page.getByRole('radio', { name: /^Chat/ }).click();
    expect(errors).toEqual([]);
  });

  test('a card’s questions are asked in New chat and fill this chat only', async ({ page, errors }, info) => {
    const name = `Quiz Quill ${uid(info)}`;
    const ch = await api(page, 'POST', '/api/characters', { card: { name, first_mes: 'Welcome aboard the ${Your ship? | options: Gull, Wren}, ${What is your name?}.' } });
    await page.goto('/');
    await page.getByRole('button', { name: 'New chat' }).first().click();
    const sheet = page.getByRole('dialog', { name: 'New chat' });
    await sheet.getByRole('button', { name: new RegExp(name) }).click();
    await expect(sheet.getByRole('region', { name: 'Before you start' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Start chat' })).toBeDisabled();
    await sheet.getByRole('button', { name: 'Wren', exact: true }).click();
    await sheet.getByLabel('What is your name?').fill('Ana');
    await sheet.getByRole('button', { name: 'Start chat' }).click();
    await expect(page.locator('.ev-message').getByText('Welcome aboard the Wren, Ana.')).toBeVisible();
    expect((await api(page, 'GET', `/api/characters/${ch.id}`)).card.first_mes).toContain('${What is your name?}');
    expect(errors).toEqual([]);
  });

  test('Quickstart builds a story; cancel keeps the idea and leaves nothing behind', async ({ page, errors }) => {
    test.slow();
    const before = (await api(page, 'GET', '/api/characters')).length;
    await page.goto('/?quickstart=1');
    const sheet = page.getByRole('dialog', { name: 'Quickstart' });
    await sheet.getByLabel('Your idea').fill('A sky-ship captain at a floating port');
    await sheet.getByRole('radio', { name: 'Adventure' }).click();
    await sheet.getByRole('radio', { name: 'Classic chat' }).click();
    // Cancel while the first step is still running.
    await mockControl({ delayMs: 3000 });
    await sheet.getByRole('button', { name: 'Start the story' }).click();
    await expect(sheet.getByRole('list', { name: 'Progress' })).toContainText('Writing the character');
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    await expect(sheet.getByLabel('Your idea')).toHaveValue('A sky-ship captain at a floating port');
    expect((await api(page, 'GET', '/api/characters')).length).toBe(before);
    // Now let it run.
    await mockControl({ delayMs: 5 });
    await sheet.getByRole('button', { name: 'Start the story' }).click();
    await expect(page).toHaveURL(/\/chat\//, { timeout: 20_000 });
    await expect(page.getByText(/You coming aboard, or just admiring the view/).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a scenario starts a story from its own copy, with its questions', async ({ page, errors }, info) => {
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Opera Otto', first_mes: 'Hm?' } });
    const title = `Opera heist ${uid(info)}`;
    await api(page, 'POST', '/api/scenarios', { title, summary: 'Steal the diva’s pearls.', opening: 'Rain on the opera steps, ${Your alias?}.', characterId: ch.id, mode: 'classic', note: 'Keep it tense.', cards: [{ type: 'place', title: 'The Opera', keys: ['opera'], content: 'Gilded and leaking.' }] });
    await page.goto('/scenarios');
    await page.getByRole('listitem').filter({ hasText: title }).getByRole('button', { name: 'Start' }).click();
    const sheet = page.getByRole('dialog', { name: `Start “${title}”` });
    await sheet.getByLabel('Your alias?').fill('Magpie');
    await sheet.getByRole('button', { name: 'Start the story' }).click();
    await expect(page.getByText('Rain on the opera steps, Magpie.')).toBeVisible();
    // Its story cards are this chat's.
    await tool(page, 'Story cards');
    await expect(page.getByRole('list', { name: 'Story cards' })).toContainText('The Opera');
    expect(errors).toEqual([]);
  });

  test('story cards from the story, then undo and redo a turn', async ({ page, errors }) => {
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Iris Thorne', first_mes: 'Iris wipes the counter. "What can I get you?"' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, features: 'classic' });
    await page.goto(`/chat/${chat.id}`);
    await page.getByLabel('Message', { exact: true }).fill('Something cold, please.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(/Iced lemon tea, on the house/)).toBeVisible();
    await tool(page, 'Story cards');
    await page.getByRole('button', { name: 'Make cards from the story' }).click();
    await page.getByRole('button', { name: 'Add 2 cards' }).click();
    await expect(page.getByRole('list', { name: 'Story cards' })).toContainText('The Lantern');
    await expect(page.getByRole('list', { name: 'Story cards' })).toContainText('Tobias');
    // Beside the story on a wide screen, a sheet otherwise.
    const side = page.getByRole('button', { name: 'Close the story panel' });
    if (await side.isVisible()) await side.click();
    else await page.getByRole('button', { name: 'Close', exact: true }).last().click();
    // Undo the turn, then redo it.
    await tool(page, 'Undo last turn');
    await expect(page.getByText('Something cold, please.')).toHaveCount(0);
    await expect(page.getByText(/Iced lemon tea, on the house/)).toHaveCount(0);
    await tool(page, 'Redo turn');
    await expect(page.getByText('Something cold, please.')).toBeVisible();
    await expect(page.getByText(/Iced lemon tea, on the house/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the story panel sets how hard the chat’s model thinks', async ({ page, errors }) => {
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Panel Pell', first_mes: 'Pell nods.' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, features: 'classic' });
    const main = (await api(page, 'GET', '/api/settings')).roles.main as string;
    const params = async () => (await api(page, 'GET', '/api/connections')).find((c: { id: string }) => c.id === main).params;
    await page.goto(`/chat/${chat.id}`);
    await tool(page, 'Story panel');
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
    const thinking = page.getByRole('radiogroup', { name: 'Thinking' });
    await thinking.getByRole('radio', { name: 'High' }).click();
    await expect.poll(async () => (await params()).reasoning_effort).toBe('high');
    expect((await params()).reasoning).toBe(true);
    await thinking.getByRole('radio', { name: 'Off' }).click();
    await expect.poll(async () => (await params()).reasoning).toBe(false);
    expect(errors).toEqual([]);
  });

  test('interface scaling: Ctrl/⌘ + plus and 0', async ({ page, errors }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();
    await page.keyboard.press('Control+Equal');
    await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe('1.1');
    await page.keyboard.press('Control+0');
    await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe('');
    expect(errors).toEqual([]);
  });
});
