import { api, expect, mockControl, test } from './fixtures';
import type { Page } from '@playwright/test';
import { zipSync } from 'fflate';

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


/** A short sine tone as a WAV file (music fixtures are made here; nothing is bundled). */
function wav(seconds: number, hz: number): Buffer {
  const rate = 8000;
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 8000), 44 + i * 2);
  return b;
}

const state = async (page: Page, campaignId: string) => (await api(page, 'GET', `/api/campaigns/${campaignId}`)).state;

test.describe('stage and sound', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });
  // Settings are shared by every spec: leave the stage and sound as the defaults found them.
  test.afterEach(async ({ page }) => {
    await api(page, 'PATCH', '/api/settings', { stage: { bubbles: false, live2d: false, fxOff: [] }, audio: { music: false, ambient: false, playlists: [] } });
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
    // Pictures only on this device: Iris has no picture, and would otherwise stand as a code-made 3D figure.
    await page.addInitScript(() => {
      // The top page only (sandboxed frames have no storage).
      if (window.top === window) localStorage.setItem('everloom:3d', JSON.stringify({ spritesOnly: true }));
    });
    await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'stage.layer', character: 'Iris Vale', position: 'left', anim: 'bounce' }] });
    await page.goto(`/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Switch to stage mode' }).click();
    await expect(page.getByTestId('stage-sprite')).toHaveAttribute('data-position', 'left');
    await expect(page.getByTestId('speech-bubble')).toContainText('You made it');
    // The sprite breathes while idle (or holds still with reduced motion).
    await expect(page.getByTestId('stage-sprite').locator('[data-motion]')).toHaveAttribute('data-motion', /idle|still/);
    // Tapping the bubble opens the whole line in the dialogue box.
    await page.getByRole('button', { name: 'Speech bubble — tap for the full line' }).click();
    await expect(page.getByTestId('speech-bubble')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Dialogue — tap to reveal or advance' })).toContainText('she says');

    await page.getByRole('button', { name: 'Scene effects' }).click();
    await page.getByRole('group', { name: 'Scene effects' }).getByRole('button', { name: 'Flash' }).click();
    await expect(page.locator('[data-fx="flash"]')).toHaveCount(1);
    const s = await state(page, chat.campaignId);
    expect(s.stage.cues.at(-1).effect).toBe('flash');
    // An effect turned off disappears from the quick menu.
    await api(page, 'PATCH', '/api/settings', { stage: { bubbles: true, live2d: false, fxOff: ['lightning'] } });
    await page.reload();
    await page.getByRole('button', { name: 'Scene effects' }).click();
    const menu = page.getByRole('group', { name: 'Scene effects' });
    await expect(menu.getByRole('button', { name: 'Fog' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Lightning' })).toHaveCount(0);
    await page.keyboard.press('Escape');
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
  test('the first tap starts the music; a mood change crossfades to the next playlist', async ({ page, errors }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __decks: HTMLMediaElement[] };
      w.__decks = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (!w.__decks.includes(this)) w.__decks.push(this);
        return play.call(this);
      };
    });
    const { chat } = await story(page);
    const { csrf } = await (await page.request.get('/api/auth/status')).json();
    const up = async (hz: number) => (await (await page.request.post('/api/media?kind=music', { data: wav(20, hz), headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf } })).json()).id as string;
    const calm = await up(330);
    const tense = await up(440);
    await api(page, 'PATCH', '/api/settings', { audio: { music: true, crossfadeMs: 1500, musicVolume: 0.5, playlists: [{ id: 'pl_calm', name: 'Calm', mood: 'calm', tracks: [calm] }, { id: 'pl_tense', name: 'Tense', mood: 'tense', tracks: [tense] }] } });
    await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'music.set', mood: 'calm' }] });
    await page.goto(`/chat/${chat.id}`);
    await expect(page.getByTestId('audio-director')).toHaveAttribute('data-playlist', 'Calm');
    const decks = () => page.evaluate(() => (window as unknown as { __decks: HTMLAudioElement[] }).__decks.filter((d) => !d.src.startsWith('data:')).map((d) => ({ track: d.src.split('/').pop(), volume: d.volume, paused: d.paused })));
    // Nothing plays before the page has had a gesture (Playwright's own navigation counts as one
    // in Chromium, so this half only applies when the browser says there hasn't been one).
    const active = await page.evaluate(() => (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive);
    if (!active) expect(await decks()).toEqual([]);
    await page.mouse.click(5, 300);
    await expect.poll(async () => (await decks()).find((d) => d.track === calm && !d.paused)?.volume ?? 0).toBeGreaterThan(0.45);
    await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'music.set', mood: 'tense' }] });
    // Midway both are audible, and the old one ends paused.
    await expect.poll(async () => { const d = await decks(); const a = d.find((x) => x.track === calm)?.volume ?? 0; const b = d.find((x) => x.track === tense)?.volume ?? 0; return a > 0.05 && b > 0.05; }, { intervals: [100] }).toBe(true);
    await expect.poll(async () => (await decks()).find((d) => d.track === tense)?.volume ?? 0).toBeGreaterThan(0.45);
    await expect.poll(async () => (await decks()).find((d) => d.track === calm)?.paused).toBe(true);
    expect(errors).toEqual([]);
  });

  test('asset library: import a zip, give an expression set to a character, set a background', async ({ page, errors }) => {
    const { ch, chat } = await story(page);
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    const zip = Buffer.from(zipSync({ 'Iris/happy.png': png, 'Iris/neutral.png': png, 'backgrounds/street.png': png }));
    await page.goto(`/chat/${chat.id}`);
    await openTool(page, 'Stage & sound');
    await page.getByRole('tab', { name: 'Sprites' }).click();
    await page.getByRole('button', { name: 'Asset library' }).click();
    const lib = page.getByRole('dialog', { name: 'Asset library' });
    const chooser = page.waitForEvent('filechooser');
    await lib.getByRole('button', { name: 'Import a zip' }).click();
    await (await chooser).setFiles({ name: 'Iris pack.zip', mimeType: 'application/zip', buffer: zip });
    const sets = lib.getByRole('region', { name: 'Expression sets' });
    await expect(sets).toContainText('Iris');
    await expect(sets).toContainText('2 expressions');
    // (Other specs may have added sets of their own, such as the demo character's.)
    await sets.getByRole('listitem').filter({ hasNotText: 'Mira' }).filter({ hasText: 'Iris' }).getByRole('button', { name: 'Give to Iris Vale' }).click();
    await expect.poll(async () => Object.keys((await api(page, 'GET', `/api/characters/${ch.id}`)).game?.expressions ?? {}).sort()).toEqual(['joy', 'neutral']);

    await lib.getByRole('radiogroup', { name: 'Type' }).getByRole('radio', { name: 'Backgrounds' }).click();
    await lib.getByRole('button', { name: 'street, background' }).click();
    await page.getByRole('dialog', { name: 'street' }).getByRole('button', { name: 'Background for this chat' }).click();
    const bg = (await api(page, 'GET', '/api/assets?type=background')).assets.find((a: { name: string }) => a.name === 'street').id;
    await expect.poll(async () => (await api(page, 'GET', `/api/chats/${chat.id}`)).metadata.background).toBe(bg);
    // Clean up so other specs start from an empty library.
    for (const a of (await api(page, 'GET', '/api/assets')).assets) await api(page, 'DELETE', `/api/assets/${a.id}`);
    expect(errors).toEqual([]);
  });
});
