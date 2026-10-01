import { api, expect, mockControl, test } from './fixtures';
import type { Page } from '@playwright/test';

async function openTool(page: Page, name: string) {
  await page.getByRole('button', { name: 'Actions and tools' }).click();
  await page.getByLabel('Search tools and actions').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

async function story(page: Page) {
  const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Iris Vale', first_mes: 'Iris looks up. "You made it," she says.' } });
  const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
  await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, {
    chatId: chat.id,
    ops: [
      { type: 'meta.update', style: 'fantasy' },
      { type: 'cutscene.add', name: 'Opening Night', steps: [{ text: 'The curtain rises.' }, { text: 'A spotlight finds you.', speaker: 'Narrator' }] },
    ],
  });
  return { ch, chat };
}

const state = async (page: Page, campaignId: string) => (await api(page, 'GET', `/api/campaigns/${campaignId}`)).state;

test.describe('stage and sound', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('play a cutscene from the tool, step through it and skip', async ({ page, errors }) => {
    const { chat } = await story(page);
    await page.goto(`/chat/${chat.id}`);
    await openTool(page, 'Stage & sound');
    await page.getByRole('button', { name: 'Play Opening Night' }).click();
    const player = page.getByRole('dialog', { name: 'Cutscene: Opening Night' });
    await expect(player).toBeVisible();
    await expect(player).toContainText('The curtain rises.');
    await player.getByRole('button', { name: 'Next' }).click();
    await expect(player).toContainText('A spotlight finds you.');
    await expect(player).toContainText('Narrator');
    await player.getByRole('button', { name: 'Skip' }).click();
    await expect(player).toBeHidden();
    await expect.poll(async () => (await state(page, chat.campaignId)).stage.playing).toBeNull();
    expect(errors).toEqual([]);
  });

  test('stage mode: the director places a sprite, effects play, speech bubbles', async ({ page, errors }) => {
    const { chat } = await story(page);
    await api(page, 'PATCH', '/api/settings', { stage: { bubbles: true, live2d: false } });
    await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'stage.layer', character: 'Iris Vale', position: 'left', anim: 'bounce' }] });
    await page.goto(`/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Switch to stage mode' }).click();
    await expect(page.getByTestId('stage-sprite')).toHaveAttribute('data-position', 'left');
    await expect(page.getByTestId('speech-bubble')).toContainText('You made it');

    await page.getByRole('button', { name: 'Scene effects' }).click();
    await page.getByRole('group', { name: 'Scene effects' }).getByRole('button', { name: 'Flash' }).click();
    await expect(page.locator('[data-fx="flash"]')).toHaveCount(1);
    const s = await state(page, chat.campaignId);
    expect(s.stage.cues.at(-1).effect).toBe('flash');
    // Live2D is off by default, so nothing asks for a Cubism Core.
    expect(await page.locator('script[src*="live2d"]').count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('ambience follows the scene; custom voices need consent', async ({ page, errors }) => {
    const { chat } = await story(page);
    await api(page, 'PATCH', '/api/settings', { audio: { ambient: true } });
    await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'ambient.set', kind: 'rain' }] });
    await page.goto(`/chat/${chat.id}`);
    await expect(page.getByTestId('audio-director')).toHaveAttribute('data-ambient', 'rain');

    const wav = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x40\x1f\x00\x00\x80\x3e\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00', 'binary').toString('base64');
    const { csrf } = await (await page.request.get('/api/auth/status')).json();
    const refused = await page.request.post('/api/voices', { data: { name: 'Mine', data: wav }, headers: { 'x-csrf-token': csrf } });
    expect(refused.status()).toBe(400);
    expect(await api(page, 'GET', '/api/voices')).toEqual([]);

    await openTool(page, 'Stage & sound');
    await page.getByRole('tab', { name: 'Voices' }).click();
    await page.getByRole('button', { name: 'Add a reference voice' }).click();
    const add = page.getByRole('dialog', { name: 'Add a reference voice' });
    await expect(add.getByRole('button', { name: 'Add voice' })).toBeDisabled();
    await expect(add).toContainText("I have the speaker's permission");
    expect(errors).toEqual([]);
  });
});
