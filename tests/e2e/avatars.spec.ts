import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { api, expect, mockControl, test } from './fixtures';

// Software WebGL so the 3D screens render headless (only here: it slows the whole browser down).
test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });

const MODEL = path.resolve('tests/fixtures/avatars/models/mannequin-m.glb');

/** Every request for 3D code or 3D files. */
function watch3d(page: Page) {
  const hits: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/\/assets\/3d-|\/three\/basis\/|\/avatar\/clips\//.test(u)) hits.push(u);
  });
  return hits;
}

/** A click track: short ticks at the given tempo (mono 16-bit WAV). */
function clicks(seconds: number, bpm: number): Buffer {
  const rate = 11025;
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
  const every = Math.round((rate * 60) / bpm);
  for (let i = 0; i < n; i++) {
    const t = i % every;
    const v = t < 400 ? Math.sin(t * 0.6) * Math.exp(-t / 80) * 26000 : 0;
    b.writeInt16LE(Math.round(v), 44 + i * 2);
  }
  return b;
}

async function postBytes(page: Page, url: string, bytes: Buffer) {
  const { csrf } = await (await page.request.get('/api/auth/status')).json();
  return (await page.request.post(url, { data: bytes, headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf } })).json();
}

async function uploadAvatar(page: Page, name: string): Promise<string> {
  if (!page.url().startsWith('http')) await page.goto('/');
  const id = await page.evaluate(
    async ([b64, name]) => {
      const status = await (await fetch('/api/auth/status')).json();
      const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
      const r = await fetch(`/api/avatars?filename=${encodeURIComponent(`${name}.glb`)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': status.csrf }, body: bytes });
      return (await r.json()).id as string;
    },
    [readFileSync(MODEL).toString('base64'), name] as const,
  );
  await expect.poll(async () => (await api(page, 'GET', `/api/avatars/${id}`)).status, { timeout: 30_000 }).toBe('ready');
  return id;
}

test.describe('3D characters', () => {
  test('import through the wizard: checks, settings, picture', async ({ page, errors }) => {
    await page.goto('/characters/avatars');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('avatar-import').click();
    await (await chooser).setFiles(MODEL);
    await expect(page).toHaveURL(/\/characters\/avatars\/av_/);
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 45_000 });
    for (const pose of ['T-pose', 'Arms up', 'Squat', 'Right hand up', 'Idle']) await page.getByRole('radio', { name: pose }).click();
    await page.getByRole('tab', { name: 'Bones' }).click();
    await expect(page.getByText('All main bones are mapped')).toBeVisible();
    await page.getByRole('tab', { name: 'Fit' }).click();
    const toon = page.getByRole('radio', { name: 'Anime (toon)' });
    await toon.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await toon.click();
    await page.getByTestId('avatar-save').click();
    await expect(page.getByTestId('avatar-save')).toBeDisabled();
    await page.getByRole('tab', { name: 'Optimize' }).click();
    await expect(page.getByTestId('avatar-report')).toContainText('Optimized');
    await page.getByRole('tab', { name: 'Details' }).click();
    const pic = page.getByRole('button', { name: 'Take picture' });
    await pic.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await pic.click();
    // The picture is uploaded and shown before leaving.
    await expect(page.getByRole('tabpanel').locator('img[src^="/media/"]')).toBeVisible({ timeout: 15_000 });
    await page.goto('/characters/avatars');
    await expect(page.getByTestId('avatar-list').locator('img').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a character with an avatar is 3D on the stage; emotes play; pictures when 3D is off here', async ({ page, errors }) => {
    const avatar = await uploadAvatar(page, 'Stage body');
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Rook Ashby', first_mes: 'Rook waves. "Over here!"' } });
    await api(page, 'PATCH', `/api/characters/${ch.id}`, { game: { avatar3d: avatar, display: 'auto' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
    await page.goto(`/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Switch to stage mode' }).click();
    await expect(page.getByTestId('stage-3d')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stage-sprite')).toHaveCount(0);
    // The story can make the character emote and hold a pose (and it rolls back like any op).
    const r = await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'avatar.emote', who: 'Rook Ashby', emote: 'nod' }, { type: 'avatar.pose', who: 'Rook Ashby', pose: 'sit' }] });
    expect(r.errors).toEqual([]);
    const s = (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state;
    expect(s.stage.avatars['rook ashby']).toMatchObject({ pose: 'sit', emote: { id: 'nod' } });
    await page.waitForTimeout(1500);
    // The emote picker and /emote record emotes like any story change.
    await page.getByRole('button', { name: 'Emotes' }).click();
    await page.getByTestId('emote-picker').getByRole('button', { name: 'Wave', exact: true }).click();
    await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.avatars['rook ashby'].emote.id).toBe('wave');
    await page.keyboard.press('Escape');
    const composer = page.getByLabel('Message', { exact: true });
    await composer.fill('/emote shakes head');
    await composer.press('Control+Enter');
    await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.avatars['rook ashby'].emote.id).toBe('shake_head');
    await composer.fill('/pose stand');
    await composer.press('Control+Enter');
    await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.avatars['rook ashby'].pose).toBeNull();

    // Look around: drag to orbit, then back to the directed camera.
    await page.getByRole('button', { name: 'Look around' }).click();
    const box = (await page.getByTestId('stage-3d').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height * 0.3, { steps: 5 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Stop looking around' }).click();

    // Pictures only on this device: the sprite comes back.
    await page.evaluate(() => localStorage.setItem('everloom:3d', JSON.stringify({ spritesOnly: true })));
    await page.reload();
    // Stage mode is remembered for the chat.
    await expect(page.getByRole('button', { name: 'Switch to chat mode' })).toBeVisible();
    await expect(page.getByTestId('stage-sprite')).toHaveCount(1);
    await expect(page.getByTestId('stage-3d')).toHaveCount(0);
    await page.evaluate(() => localStorage.removeItem('everloom:3d'));
    expect(errors).toEqual([]);
  });

  test('code-made is opt-in: make one, edit it, and explicitly enable procedural NPCs', async ({ page, errors }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('everloom:3d', JSON.stringify({ experimentalProcedural: true, codeNpcs: true })));
    await api(page, 'PATCH', '/api/avatar-packs/basics', { enabled: true });
    await page.goto('/characters/avatars');
    await page.getByTestId('avatar-make').click();
    // Realistic characters are only offered where Blender runs.
    const blender = await api(page, 'GET', '/api/blender');
    await expect(page.getByRole('menuitem', { name: /Realistic/ })).toHaveCount(blender.found ? 1 : 0);
    await page.getByRole('menuitem', { name: /Experimental code-made/ }).click();
    await expect(page).toHaveURL(/\/characters\/avatars\/av_/);
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 45_000 });
    await page.getByRole('tab', { name: 'Face & hair' }).click();
    await page.getByLabel('Hairstyle').selectOption('bun');
    await page.getByRole('tab', { name: 'Clothes' }).click();
    await page.getByLabel('Top', { exact: true }).selectOption('robe');
    await page.getByTestId('avatar-save').click();
    await expect(page.getByTestId('avatar-save')).toBeDisabled({ timeout: 15_000 });
    const id = page.url().split('/').pop()!;
    const saved = await api(page, 'GET', `/api/avatars/${id}`);
    expect(saved.config.recipe).toMatchObject({ hair: { style: 'bun' }, top: { kind: 'robe' } });
    // Upgrade: open it in the parts maker with its choices carried over.
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Open in the parts maker' }).click();
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 45_000 });
    await page.getByRole('tab', { name: 'Hair' }).click();
    await expect(page.getByRole('option', { name: 'Bun', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Tops' }).click();
    await expect(page.getByRole('option', { name: 'Robe', exact: true })).toHaveAttribute('aria-selected', 'true');

    // A character with no picture at all: a figure made from the description.
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Old Tam', description: 'An elderly fisherman with a white beard, a grey beanie and boots.', first_mes: 'Tam squints at the sea.' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
    await page.goto(`/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Switch to stage mode' }).click();
    await expect(page.getByTestId('stage-3d')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stage-sprite')).toHaveCount(0);
    // Turned off on this device: back to the (empty) picture slot.
    await page.evaluate(() => localStorage.setItem('everloom:3d', JSON.stringify({ codeNpcs: false })));
    await page.reload();
    await expect(page.getByTestId('stage-sprite')).toHaveCount(1);
    await expect(page.getByTestId('stage-3d')).toHaveCount(0);
    await page.evaluate(() => localStorage.removeItem('everloom:3d'));
    expect(errors).toEqual([]);
  });

  test('parts maker on a phone: build, save, use on the stage, and an equipped item swaps a part', async ({ page, errors }) => {
    await page.goto('/');
    await api(page, 'PATCH', '/api/avatar-packs/basics', { enabled: true });
    await page.goto('/characters/avatars');
    await page.getByTestId('avatar-make').click();
    await page.getByRole('menuitem', { name: /From parts/ }).click();
    await expect(page).toHaveURL(/\/characters\/maker/);
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 45_000 });
    const who = `Wren ${test.info().project.name.replace(/-/g, ' ')}`;
    await page.getByLabel('Character name').fill(who);
    await page.getByRole('tab', { name: 'Hair' }).click();
    await page.getByRole('option', { name: 'Bun', exact: true }).click();
    await page.getByRole('button', { name: 'Auburn' }).click();
    await page.getByRole('tab', { name: 'Tops' }).click();
    await page.getByRole('option', { name: 'Jacket', exact: true }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('option', { name: 'Shirt', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('option', { name: 'Sweater', exact: true }).click();
    await page.getByTestId('maker-save').click();
    await expect(page).toHaveURL(/\/characters\/avatars\/av_/, { timeout: 20_000 });
    const id = page.url().split('/').pop()!;
    const saved = await api(page, 'GET', `/api/avatars/${id}`);
    expect(saved).toMatchObject({ kind: 'parts', name: who, model: '/avatar/packs/basics/traits/body/soft.glb' });
    expect(saved.config.maker.parts).toMatchObject({ HAIR: 'bun', TOP: 'sweater' });
    expect(saved.config.garments.map((g: any) => g.id)).toEqual(expect.arrayContaining(['hair-bun', 'top-sweater']));
    // Reopening shows the maker with the saved parts.
    await page.reload();
    await expect(page.getByLabel('Character name')).toHaveValue(who);

    // On the stage, with a helmet equipped: the helmet part goes on and hides the hair.
    const ch = await api(page, 'POST', '/api/characters', { card: { name: who, first_mes: 'Wren adjusts her sweater.' } });
    await api(page, 'PATCH', `/api/characters/${ch.id}`, { game: { avatar3d: id, display: 'auto' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
    const r = await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'party.add', name: who }, { type: 'item.add', name: 'Iron Helmet', category: 'armor', slot: 'head' }, { type: 'party.update', name: who, equip: { slot: 'head', item: 'Iron Helmet' } }] });
    expect(r.errors).toEqual([]);
    await page.goto(`/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Switch to stage mode' }).click();
    const stage = page.getByTestId('stage-3d');
    await expect(stage).toBeVisible({ timeout: 20_000 });
    await expect(stage).toHaveAttribute('data-worn', /item-hat-helmet/, { timeout: 30_000 });
    await expect(stage).not.toHaveAttribute('data-worn', /hair-bun/);
    expect(errors).toEqual([]);
  });

  test('the story changes the outfit and a swipe takes it back; a dance keeps time with the music; the dressing room', async ({ page, errors }) => {
    const avatar = await uploadAvatar(page, 'Outfit body');
    // A whole-outfit model ("Ball gown"), as the dressing room makes it.
    const o = await postBytes(page, `/api/avatars/${avatar}/outfit-model?filename=gown.glb`, readFileSync(path.resolve('tests/fixtures/avatars/models/mannequin-f.glb')));
    const detail = await api(page, 'GET', `/api/avatars/${avatar}`);
    await api(page, 'PATCH', `/api/avatars/${avatar}`, { config: { ...detail.config, outfits: [{ id: 'gown', name: 'Ball gown', model: o.model, modelLow: o.modelLow }] } });
    const name = `Odile ${test.info().project.name.replace(/-/g, ' ')}`;
    const ch = await api(page, 'POST', '/api/characters', { card: { name, first_mes: 'Odile smooths her coat.' } });
    await api(page, 'PATCH', `/api/characters/${ch.id}`, { game: { avatar3d: avatar, display: 'auto' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
    const key = name.toLowerCase();

    // Music with a clear 100 BPM beat, and a dance.
    const track = (await postBytes(page, '/api/media?kind=music', clicks(12, 100))).id as string;
    const settings = await api(page, 'GET', '/api/settings');
    await api(page, 'PATCH', '/api/settings', { audio: { ...settings.audio, music: true, playlists: [{ id: 'pl_party', name: 'Party', mood: 'party', tracks: [track] }] } });
    await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'music.set', mood: 'party' }] });
    await page.goto(`/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Switch to stage mode' }).click();
    const stage = page.getByTestId('stage-3d');
    await expect(stage).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('audio-director')).toHaveAttribute('data-playlist', 'Party');
    await page.getByRole('button', { name: 'Emotes' }).click();
    await page.getByTestId('emote-picker').getByRole('button', { name: 'Dance', exact: true }).click();
    await page.keyboard.press('Escape');
    // The tempo is read from the track; the dance (120 BPM at speed 1) slows to match it.
    await expect(stage).toHaveAttribute('data-dance', /^(9[5-9]|10[0-5])(\.\d+)?\|.+:0\.8\d/, { timeout: 20_000 });

    // The story puts on the ball gown; a new swipe without it takes it off again.
    await mockControl({ trackerOps: [{ type: 'avatar.outfit', who: name, outfit: 'Ball gown' }] });
    await page.getByLabel('Message', { exact: true }).fill('Shall we go to the ball?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.avatars[key]?.outfit, { timeout: 20_000 }).toBe('Ball gown');
    await expect(stage).toHaveAttribute('data-outfit', new RegExp(`${ch.id}:gown`), { timeout: 20_000 });
    await mockControl({ trackerOps: [] });
    await page.getByRole('button', { name: 'New swipe' }).click();
    await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.avatars[key]?.outfit ?? null, { timeout: 20_000 }).toBeNull();
    await expect(stage).toHaveAttribute('data-outfit', new RegExp(`${ch.id}:(\\||$)`), { timeout: 20_000 });
    await mockControl({ trackerOps: null });

    // The dressing room: try the outfit on in the preview.
    await page.goto(`/characters/avatars/${avatar}`);
    await page.getByRole('tab', { name: 'Wardrobe' }).click();
    await page.getByTestId('wardrobe').getByRole('button', { name: 'Ball gown' }).click();
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    expect(errors).toEqual([]);
  });

  test('3D on the character sheet and in the asset library', async ({ page, errors }) => {
    const avatar = await uploadAvatar(page, 'Shelf body');
    const name = `Pell ${test.info().project.name.replace(/-/g, ' ')}`;
    const ch = await api(page, 'POST', '/api/characters', { card: { name } });
    await api(page, 'PATCH', `/api/characters/${ch.id}`, { game: { avatar3d: avatar, display: 'auto' } });
    await page.goto('/characters');
    await page.getByRole('button', { name: new RegExp(name) }).first().click();
    await page.getByTestId('detail-3d-show').click();
    await expect(page.getByTestId('detail-3d').getByTestId('stage-3d')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');

    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
    await page.goto(`/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Actions and tools' }).click();
    await page.getByLabel('Search tools and actions').fill('Stage & sound');
    await page.getByRole('button', { name: 'Stage & sound', exact: true }).click();
    await page.getByRole('tab', { name: 'Sprites' }).click();
    await page.getByRole('button', { name: 'Asset library' }).click();
    const lib = page.getByRole('dialog', { name: 'Asset library' });
    await lib.getByRole('radiogroup', { name: 'Shelf' }).getByRole('radio', { name: '3D' }).click();
    const shelf = lib.getByTestId('assets3d');
    await shelf.getByLabel('Search 3D assets').fill('Shelf body');
    await expect(shelf.getByText('Shelf body').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('nothing 3D downloads on screens without 3D', async ({ page, errors }) => {
    const hits = watch3d(page);
    for (const url of ['/', '/characters', '/settings', '/personas', '/lore']) {
      await page.goto(url);
      // The live event stream never lets the network go idle; give lazy screens time instead.
      await page.waitForTimeout(1200);
    }
    await page.goto('/settings/3d');
    await expect(page.getByText('On this device')).toBeVisible();
    await page.waitForTimeout(1200);
    expect(hits).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('3D motions', () => {
  test('import a BVH motion as an emote; it joins the picker', async ({ page, errors }) => {
    await page.goto('/settings/3d');
    await page.getByTestId('clip-import').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a motion file' }).click();
    await (await chooser).setFiles(path.resolve('tests/fixtures/avatars/motions/greet.bvh'));
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 30_000 });
    const id = `greet_${test.info().project.name.replace(/[^a-z0-9]/g, '_')}`.slice(0, 40);
    await page.getByLabel('Emote id').fill(id);
    await page.getByLabel('Emote label').fill('Big greeting');
    await page.getByTestId('clip-save').click();
    await expect(page.getByTestId('clip-list')).toContainText('Big greeting');
    const clips = await api(page, 'GET', '/api/avatar-clips');
    expect(clips.map((c: { id: string }) => c.id)).toContain(id);
    const clip = await api(page, 'GET', `/api/avatar-clips/${id}`);
    expect(clip.frames).toBeGreaterThan(10);
    expect(Object.keys(clip.tracks)).toEqual(expect.arrayContaining(['rightUpperArm', 'rightLowerArm']));
    await api(page, 'DELETE', `/api/avatar-clips/${id}`);
    expect(errors).toEqual([]);
  });
});
