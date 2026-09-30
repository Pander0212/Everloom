import { api, expect, mockControl, test } from './fixtures';
import type { Page } from '@playwright/test';

async function openTool(page: Page, name: string | RegExp) {
  await page.getByRole('button', { name: 'Actions and tools' }).click();
  await page.getByLabel('Search tools and actions').fill(typeof name === 'string' ? name : 'Phone');
  await page.getByRole('button', { name, exact: typeof name === 'string' }).first().click();
}

const state = async (page: Page, campaignId: string) => (await api(page, 'GET', `/api/campaigns/${campaignId}`)).state;

async function setup(page: Page) {
  const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Iris Vale' } });
  const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, greeting: false });
  const config = {
    title: 'Millbrook Letters',
    style: 'fantasy',
    seed: 4,
    character: { name: 'Anala', className: '', resourceProfile: 'hybrid', level: 1, age: 24, ageStage: 'Adult', customBars: [] },
    appearance: '',
    currency: { name: 'Gold', symbol: 'g', amount: 20 },
    groups: [],
    trackers: [],
    items: [],
    skills: [],
    quests: [],
    npcs: [{ name: 'Mara Quill', role: 'Miller' }],
    location: { world: 'Aerth', region: 'Vale', local: 'Millbrook', description: '' },
    startDate: { year: 2026, month: 7, day: 1, hour: 10 },
    dayLength: { mode: 'turns', realMinutesPerDay: 20 },
    facts: [],
  };
  await api(page, 'POST', `/api/chats/${chat.id}/newgame`, { config, opening: false });
  return chat;
}

test.describe('communication', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('a letter by courier and its reply → a post on the notice board', async ({ page, errors }) => {
    const chat = await setup(page);
    await page.goto(`/chat/${chat.id}`);
    await openTool(page, 'Phone');
    const codex = page.getByRole('dialog', { name: 'Codex' });
    await expect(codex.getByRole('navigation', { name: 'Apps' })).toBeVisible();

    // Write a letter by messenger bird.
    await codex.getByRole('button', { name: 'Letters', exact: true }).click();
    const letters = page.getByRole('dialog', { name: 'Letters' });
    await letters.getByRole('button', { name: 'Write a letter' }).click();
    const compose = page.getByRole('dialog', { name: 'Write a letter' });
    await compose.getByLabel('To').selectOption({ label: 'Mara Quill' });
    await compose.getByLabel('Sent by').selectOption({ index: 2 });
    await compose.getByLabel('Subject').fill('The mill');
    await compose.getByLabel('Letter').fill('Is the wheel fixed yet?');
    await compose.getByRole('button', { name: /^Send/ }).click();
    await expect(compose).toHaveCount(0);
    await letters.getByRole('tab', { name: 'Sent' }).click();
    await expect(letters).toContainText('To Mara Quill');
    await expect(letters).toContainText('awaiting a reply');
    const sent = Object.values((await state(page, chat.campaignId)).mail)[0] as any;
    expect(sent.courier).toBe('bird');
    expect((await state(page, chat.campaignId)).player.currency).toBe(19.2);

    // Time passes until the reply arrives; it shows in the digest and is written when opened.
    await letters.getByRole('button', { name: 'Back to home' }).click();
    const now = (await state(page, chat.campaignId)).time.minutes;
    await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'time.advance', minutes: sent.replyDue - now }] });
    const digest = page.locator('section[aria-label="While you were away"]');
    await expect(digest).toContainText('Mara Quill · letter: Re: The mill');
    await digest.getByRole('button', { name: /Mara Quill/ }).click();
    await page.getByRole('dialog', { name: 'Letters' }).getByRole('button', { name: /Mara Quill/ }).click();
    await expect(page.getByRole('dialog', { name: 'Re: The mill' })).toContainText('The mill wheel turns again');
    await page.getByRole('dialog', { name: 'Re: The mill' }).getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog', { name: 'Letters' }).getByRole('button', { name: 'Back to home' }).click();

    // Notice board: pin a notice, then see what others post.
    await page.getByRole('dialog', { name: 'Codex' }).getByRole('button', { name: 'Notice board', exact: true }).click();
    const board = page.getByRole('dialog', { name: 'Notice board' });
    await board.getByLabel('Pin a notice').fill('Looking for work at the mill.');
    await board.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(board.getByRole('list', { name: 'Posts' })).toContainText('Looking for work at the mill.');
    await board.getByRole('button', { name: 'Check for new posts' }).click();
    await expect(board.getByRole('list', { name: 'Posts' })).toContainText('Fresh bread at dawn');
    const posts = (await state(page, chat.campaignId)).feed.map((p: any) => p.author);
    expect(posts).toEqual(['Anala', 'Mara Quill']);
    expect(errors).toEqual([]);
  });
});
