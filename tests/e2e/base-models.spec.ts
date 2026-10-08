/**
 * Custom base models: the base check and morph sliders, the fallback for a base without morphs,
 * fitting unrigged clothes by hand (weights, body-slider morphs, hidden skin), skirt and hair
 * physics, skin layers and tattoos, a paired animation between characters of different heights,
 * and the story equipping a fitted garment (a swipe takes it off again).
 *
 * Heavy (software WebGL): runs on desktop-1280-light and phone-390-light only. With EVIDENCE=1 the
 * screenshots and timings go to docs/3d-base-evidence/ (all bodies and clothes here are CC0 and
 * made for Everloom).
 */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { api, expect, mockControl, test } from './fixtures';
import { ev, F, fit, garment, open, preview, record, saveAvatar, settle, SWIFTSHADER, tubeObj, upload } from './avatar-helpers';

test.use(SWIFTSHADER);
test.beforeEach(({}, info) => test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'heavy 3D checks run on two projects'));

test.describe('custom base models', () => {
  test.describe.configure({ timeout: 900_000 });

  test('a base with morphs: the check, grouped sliders, presets; a base without: the fallback', async ({ page, errors }) => {
    const id = await upload(page, path.join(F, 'models/morph-base.glb'), 'Morph base');
    await open(page, id, 'Body');
    const check = page.getByTestId('base-check');
    await expect(check).toBeVisible();
    await check.locator('summary').click();
    await expect(check).toContainText('9 sliders from the file');
    await expect(check).toContainText('Chest bones found');
    await ev(page, '1-base-check', check);
    const body = page.getByTestId('body-step');
    await expect(body.getByRole('radio', { name: /Body \(9\)/ })).toBeVisible();
    // The file's face shapes drive expressions, blinking and lip-sync rather than sliders.
    await expect(body.getByRole('radio', { name: 'Face', exact: true })).toBeVisible();
    // The sliders the prompt names: breast, hips and butt, both ways.
    for (const [v, tag] of [[1, 'max'], [-1, 'min']] as const) {
      for (const label of ['Breast size', 'Hips', 'Butt']) await body.getByLabel(`${label} value`).fill(String(v));
      await settle(page);
      await ev(page, `1-sliders-${tag}`, preview(page));
    }
    await body.getByLabel('Preset name').fill('Curvy');
    await body.getByRole('button', { name: 'Save', exact: true }).click();
    await saveAvatar(page);
    const saved = await api(page, 'GET', `/api/avatars/${id}`);
    expect(saved.config.morphs.values).toMatchObject({ [saved.config.morphs.sliders.find((s: any) => s.label === 'Hips').id]: -1 });
    expect(saved.config.morphs.presets.map((p: any) => p.name)).toEqual(['Curvy']);

    const plain = await upload(page, path.join(F, 'models/plain-base.glb'), 'Plain base');
    await open(page, plain, 'Body');
    await expect(page.getByTestId('base-check')).toContainText('No morph targets');
    await expect(page.getByLabel('Breast / chest size (generated)')).toBeVisible();
    await page.getByLabel('Breast / chest size generated value').fill('0.3');
    await page.getByLabel('Hip width generated value').fill('0.3');
    await settle(page);
    await ev(page, '2-no-morphs-fallback');
    expect(errors).toEqual([]);
  });

  test('fitting unrigged clothes by hand: shirt, trousers, skirt, shoes, long hair; a 20,000-vertex garment', async ({ page, errors }) => {
    const id = await upload(page, path.join(F, 'models/morph-base.glb'), 'Fitting base');
    await open(page, id, 'Wardrobe');
    const g = garment;
    const results: Record<string, unknown> = {};
    results.shirt = await fit(page, g('shirt'), { shots: '3-shirt' });
    results.trousers = await fit(page, g('trousers'), { shots: '3-trousers' });
    results.skirt = await fit(page, g('skirt'), { swing: 'Skirt or coat', shots: '3-skirt' });
    results.shoes = await fit(page, g('shoes'), { shots: '3-shoes' });
    results.longHair = await fit(page, g('long-hair'), { swing: 'Long hair', shots: '3-hair' });
    for (const [k, r] of Object.entries(results) as Array<[string, { vertices: number; matched: number; far: number }]>) {
      expect(r.vertices, k).toBeGreaterThan(100);
      expect(r.far, k).toBe(0);
    }
    expect((results.skirt as { swingBones: number }).swingBones).toBeGreaterThan(10);
    expect((results.longHair as { swingBones: number }).swingBones).toBeGreaterThan(10);
    await saveAvatar(page);
    expect((await api(page, 'GET', `/api/avatars/${id}`)).config.garments.length).toBe(5);
    // Opened again, dressed in everything: the skin under the clothes is hidden, the skirt and hair hang on their chains.
    await open(page, id, 'Wardrobe');
    await settle(page, 4000);
    await ev(page, '5-dressed-idle', preview(page));

    // 20,000 vertices: a tube top, rigged in the worker while the page stays responsive.
    const tube = path.join(os.tmpdir(), `tube-top-20k-${Date.now()}.obj`);
    writeFileSync(tube, tubeObj(100, 200));
    const big = await fit(page, [tube]);
    expect(big.vertices).toBeGreaterThanOrEqual(20_000);
    // The worker does the matching while the page keeps answering (frames on software WebGL take
    // a few hundred ms here). Building the result and its first draw (three.js packs the morph
    // targets into a texture then) are one longer step, recorded as longestTaskMs.
    expect(big.workerPhaseLatencyMs).toBeLessThan(1000);
    results.tube20k = big;
    record('fitting', results);

    expect(errors).toEqual([]);
  });

  test('skin layers: underwear, a tattoo placed by tapping that bends with poses and sliders, colours', async ({ page, errors }) => {
    const id = await upload(page, path.join(F, 'models/morph-base.glb'), 'Skin base');
    await open(page, id, 'Skin');
    const skin = page.getByTestId('skin-step');
    await skin.getByLabel('New layer kind').selectOption('underwear');
    let chooser = page.waitForEvent('filechooser');
    await skin.getByTestId('layer-add').click();
    await (await chooser).setFiles(path.join(F, 'layers/underwear-uv.png'));
    await expect(skin.getByTestId('skin-layer')).toHaveCount(1);
    await skin.getByLabel('New layer kind').selectOption('tattoo');
    chooser = page.waitForEvent('filechooser');
    await skin.getByTestId('layer-add').click();
    await (await chooser).setFiles(path.join(F, 'layers/tattoo.png'));
    await expect(page.getByText('Tap or click the body')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('radio', { name: 'Half' }).click();
    await settle(page);
    const box = (await preview(page).boundingBox())!;
    // The belly, clear of the underwear (tattoos sit under clothing layers).
    await page.mouse.click(box.x + box.width * 0.47, box.y + box.height * 0.6);
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('[data-testid=skin-layer]').length)).toBe(2);
    await skin.getByTestId('skin-layer').nth(1).getByTestId('layer-place').click();
    await skin.getByLabel('Skin tone').fill('#c99a78');
    await skin.getByLabel('Eyes', { exact: true }).fill('#2f7d4f');
    await settle(page, 3500);
    await ev(page, '6-underwear-tattoo', preview(page));
    await saveAvatar(page);
    const saved = await api(page, 'GET', `/api/avatars/${id}`);
    const tattoo = saved.config.skinLayers.find((l: any) => l.kind === 'tattoo');
    expect(tattoo.decal).toMatchObject({ u: expect.any(Number), v: expect.any(Number) });
    // The tattoo is in the skin texture: it bends with the arms up and a bigger chest.
    await page.getByRole('tab', { name: 'Check', exact: true }).click();
    await page.getByRole('radio', { name: 'Arms up' }).click();
    await settle(page);
    await ev(page, '6-tattoo-arms-up', preview(page));
    await page.getByRole('tab', { name: 'Body', exact: true }).click();
    await page.getByTestId('body-step').getByLabel('Breast size value').fill('1');
    await settle(page);
    await ev(page, '6-tattoo-slider', preview(page));
    expect(errors).toEqual([]);
  });

  test('the story: a fitted shirt goes on when equipped and a swipe takes it off; a handshake between different heights', async ({ page, errors }) => {
    const id = await upload(page, path.join(F, 'models/morph-base.glb'), 'Story base');
    await open(page, id, 'Wardrobe');
    await fit(page, garment('shirt'));
    await saveAvatar(page);
    // The fitted shirt is put on by an item.
    const detail = await api(page, 'GET', `/api/avatars/${id}`);
    await api(page, 'PATCH', `/api/avatars/${id}`, { config: { ...detail.config, garments: detail.config.garments.map((g: any) => ({ ...g, on: false, items: ['Linen Shirt'] })) } });
    // A second, shorter character for the handshake.
    const other = await upload(page, path.join(F, 'models/mannequin-f.glb'), 'Short partner');
    const od = await api(page, 'GET', `/api/avatars/${other}`);
    await api(page, 'PATCH', `/api/avatars/${other}`, { config: { ...od.config, scale: 0.85 } });
    const tag = test.info().project.name.replace(/-/g, ' ');
    const [a, b] = [`Ines ${tag}`, `Tomas ${tag}`];
    const ca = await api(page, 'POST', '/api/characters', { card: { name: a, first_mes: 'Ines nods.' } });
    const cb = await api(page, 'POST', '/api/characters', { card: { name: b, first_mes: 'Tomas waves.' } });
    await api(page, 'PATCH', `/api/characters/${ca.id}`, { game: { avatar3d: id, display: 'auto' } });
    await api(page, 'PATCH', `/api/characters/${cb.id}`, { game: { avatar3d: other, display: 'auto' } });
    const group = await api(page, 'POST', '/api/groups', { name: `Pair ${tag}`, members: [{ characterId: ca.id }, { characterId: cb.id }] });
    const chat = await api(page, 'POST', '/api/chats', { groupId: group.id, features: 'full' });
    expect((await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'party.add', name: a }, { type: 'item.add', name: 'Linen Shirt', category: 'clothing', slot: 'body' }] })).errors).toEqual([]);
    await page.goto(`/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Switch to stage mode' }).click();
    const stage = page.getByTestId('stage-3d');
    await expect(stage).toHaveAttribute('data-avatars', /\|/, { timeout: 60_000 });
    await expect(stage).toHaveAttribute('data-worn', new RegExp(`${ca.id}:(\\||$)`));

    await mockControl({ trackerOps: [{ type: 'party.update', name: a, equip: { slot: 'body', item: 'Linen Shirt' } }] });
    await page.getByLabel('Message', { exact: true }).fill('Ines, put your shirt on.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(stage).toHaveAttribute('data-worn', new RegExp(`${ca.id}:fit1`), { timeout: 60_000 });
    await settle(page, 3000);
    await ev(page, '8-equipped');
    await mockControl({ trackerOps: [] });
    await page.getByRole('button', { name: 'New swipe' }).click();
    await expect(stage).toHaveAttribute('data-worn', new RegExp(`${ca.id}:(\\||$)`), { timeout: 60_000 });
    await mockControl({ trackerOps: null });

    // The emote picker: the two shake hands, hands meeting though one is shorter.
    await page.getByRole('button', { name: 'Emotes' }).click();
    await page.getByTestId('emote-together').getByRole('button', { name: 'Handshake' }).click();
    await page.keyboard.press('Escape');
    // (It may already have finished by the time this looks: a handshake lasts about 3 s.)
    await expect(stage).toHaveAttribute('data-paired', /^(playing|done):handshake$/, { timeout: 30_000 });
    expect((await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.paired).toMatchObject({ clip: 'handshake', who: [a, b] });
    expect(errors).toEqual([]);
  });
});
