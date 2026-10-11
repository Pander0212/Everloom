import path from 'node:path';
import { api, expect, isPhone, mockControl, test } from './fixtures';

const SERAPHINA = path.resolve('tests/fixtures/st/Seraphina.png');

/** Taps a message so its actions show, and returns it. */
async function reveal(page: import('@playwright/test').Page, messageText: RegExp) {
  const msg = page.locator('[id^="msg-"]').filter({ hasText: messageText }).last();
  await msg.locator('.ev-message-text').first().click({ position: { x: 4, y: 4 } });
  return msg;
}
async function openMore(page: import('@playwright/test').Page, messageText: RegExp) {
  await (await reveal(page, messageText)).getByRole('button', { name: 'More actions' }).click();
}

test.describe('roleplay core', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('import a card, chat with streaming, swipe, edit, branch and delete with state rollback', async ({ page, errors }) => {
    await page.goto('/characters');
    await page.locator('input[type=file]').first().setInputFiles(SERAPHINA);
    await expect(page.getByText('Character imported')).toBeVisible();
    await page.getByRole('button', { name: /Seraphina/ }).first().click();
    await page.getByRole('tab', { name: 'Edit' }).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Seraphina');
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByRole('button', { name: 'Start chat' }).click();
    await expect(page).toHaveURL(/\/chat\//);
    const chatId = page.url().split('/chat/')[1];
    const chat = await api(page, 'GET', `/api/chats/${chatId}`);

    // Send and watch it stream.
    await page.getByLabel('Message', { exact: true }).fill('Hello. Something cold, please?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Hello. Something cold, please?')).toBeVisible();
    await expect(page.getByText(/Iced lemon tea, on the house/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send' }).or(page.getByRole('button', { name: 'Continue the story' }))).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => Object.values((await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.inventory).map((i: any) => i.name))
      .toEqual(['Iced Lemon Tea']);
    await expect(page.getByText(/\+1 Iced Lemon Tea/).first()).toBeVisible();

    // Swipe → a different take without tea; the tea is rolled back.
    await mockControl({ story: 'Tobias Moreno waves from the doorway. "Evening, everyone."' });
    await page.getByRole('button', { name: 'New version' }).click();
    await expect(page.getByText('Tobias Moreno waves from the doorway')).toBeVisible();
    await expect(page.getByText('2/2')).toBeVisible();
    await expect.poll(async () => Object.keys((await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.inventory).length).toBe(0);
    await page.getByRole('button', { name: 'Previous version' }).click();
    await expect(page.getByText('1/2')).toBeVisible();
    await expect.poll(async () => Object.keys((await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.inventory).length).toBe(1);

    // Edit.
    await mockControl({ story: null });
    await (await reveal(page, /Iced lemon tea/)).getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Edit message').fill('Seraphina hands you a cup of water. "Rest now."');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Seraphina hands you a cup of water.')).toBeVisible();
    await expect.poll(async () => Object.keys((await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.inventory).length).toBe(0);

    // Branch from the greeting.
    await openMore(page, /./);
    await page.getByRole('menuitem', { name: /^Branch from here/ }).click();
    await expect(page.getByText('New branch created')).toBeVisible();
    await expect(page).not.toHaveURL(new RegExp(chatId));
    await page.goto(`/chat/${chatId}`);

    // Delete the reply → confirm → gone, state rolls back.
    await (await reveal(page, /cup of water/)).getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Seraphina hands you a cup of water.')).toHaveCount(0);
    const s = (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state;
    expect(Object.keys(s.relationships)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('prompt inspector, author note, search and export', async ({ page }) => {
    const chars = await api(page, 'GET', '/api/characters');
    const ch = chars[0] ?? (await api(page, 'POST', '/api/characters', { card: { name: 'Iris', first_mes: 'Hi there.' } }));
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
    await page.goto(`/chat/${chat.id}`);
    await page.getByLabel('Message', { exact: true }).fill('Find the lantern word please');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(/take 1/)).toBeVisible();
    // Inspector
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByLabel('Search tools, settings and the story').fill('Everything sent to the AI');
    await page.getByRole('button', { name: 'Everything sent to the AI', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Everything sent to the AI' })).toBeVisible();
    await expect(page.getByText('Chat history')).toBeVisible();
    await expect(page.getByText(/of [\d,]+ tokens/)).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    // Author's note
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByLabel('Search tools, settings and the story').fill('Note to the AI');
    await page.getByRole('button', { name: 'Note to the AI', exact: true }).click();
    await page.getByRole('textbox', { name: 'Note to the AI' }).fill('[Keep it cozy.]');
    await page.getByRole('button', { name: 'Save note' }).click();
    const updated = await api(page, 'GET', `/api/chats/${chat.id}`);
    expect(updated.metadata.authorsNote.content).toBe('[Keep it cozy.]');
    // Search
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByLabel('Search tools, settings and the story').fill('Find in chat');
    await page.getByRole('button', { name: 'Find in chat', exact: true }).click();
    await page.getByLabel('Search this chat').fill('lantern');
    await expect(page.getByText(/Find the lantern word/).last()).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    // Export JSONL
    const jsonl = await api(page, 'GET', `/api/chats/${chat.id}/export`);
    expect(String(jsonl).split('\n')[0]).toContain('user_name');
  });

  test('a second device stays in sync over SSE', async ({ page, context }) => {
    const chars = await api(page, 'GET', '/api/characters');
    const ch = chars[0] ?? (await api(page, 'POST', '/api/characters', { card: { name: 'Iris', first_mes: 'Hi there.' } }));
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
    await page.goto(`/chat/${chat.id}`);
    const other = await context.browser()!.newContext({ storageState: 'tests/e2e/.artifacts/auth.json', viewport: { width: 1280, height: 800 } });
    const page2 = await other.newPage();
    await page2.goto(`/chat/${chat.id}`);
    await expect(page2.getByLabel('Message', { exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    await page.getByLabel('Message', { exact: true }).fill('Hello from my phone');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page2.getByText('Hello from my phone')).toBeVisible();
    await expect(page2.getByText(/take 1/)).toBeVisible({ timeout: 15000 });
    await other.close();
    void isPhone;
  });
});
