/**
 * The owner's own .blend samples, imported through the app as a person would (Blender converts them on
 * the server), checked in the editor, then put on the stage and asked to move: their own clips, the
 * family emotes and the story's humanoid emotes (translated to the nearest thing the body can do).
 *
 * Runs only where the samples are (git-ignored samples/3d) and Blender is set (EVERLOOM_BLENDER).
 * Screenshots and a video of each go to docs/3d-import/evidence/private/, which is git-ignored too:
 * fan-made models of existing characters stay private (CREDITS.md, "Fan-made models").
 *
 *   EVERLOOM_BLENDER=…/blender.exe npx playwright test --config playwright.3d.config.ts --project creatures
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { api, expect, test } from './fixtures';

const SAMPLES = path.resolve('samples/3d');
const OUT = path.resolve('docs/3d-import/evidence/private');

interface Case {
  file: string;
  family: string;
  /** What the story asks for, and the creature emotes to show. */
  emotes: string[];
  pose?: string;
}
const CASES: Case[] = [
  { file: 'Raibow_Dash.blend', family: 'Four-legged with wings', emotes: ['own_1', 'nod', 'wag_tail', 'flap_wings', 'hop', 'rear_up', 'laugh', 'roar'], pose: 'sit' },
  { file: 'CharizardAnthroExportv1.1_nHl3DSY.blend', family: 'Two-legged creature or dragon', emotes: ['wave', 'flap_wings', 'wag_tail', 'dance'] },
  { file: "Lana's Mom - Annue.blend", family: 'Humanoid', emotes: ['wave', 'nod'] },
];

test.skip(!existsSync(SAMPLES) || !process.env.EVERLOOM_BLENDER, 'needs samples/3d and EVERLOOM_BLENDER');
test.use({ video: { mode: 'on', size: { width: 960, height: 600 } } });

for (const c of CASES) {
  test(`${c.file}: imports, maps its body, moves on the stage`, async ({ page, errors }, info) => {
    test.setTimeout(20 * 60_000);
    const file = path.join(SAMPLES, c.file);
    test.skip(!existsSync(file), `${c.file} is not in samples/3d`);
    const dir = path.join(OUT, c.file.replace(/\.blend$/i, '').replace(/[^\w.-]+/g, '_'));
    mkdirSync(dir, { recursive: true });
    const shot = async (name: string) => {
      const p = info.outputPath(`${name}.png`);
      await page.screenshot({ path: p });
      copyFileSync(p, path.join(dir, `${name}.png`));
    };

    // The upload the import makes for a .blend (the file as the body), then the editor.
    await page.goto('/characters/avatars');
    const csrf = (await api(page, 'GET', '/api/auth/status')).csrf;
    const made = await (await page.request.post(`/api/avatars?filename=${encodeURIComponent(c.file)}`, { data: readFileSync(file), headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': csrf }, timeout: 10 * 60_000 })).json();
    expect(made.id, JSON.stringify(made)).toBeTruthy();
    await expect.poll(async () => (await api(page, 'GET', `/api/avatars/${made.id}`)).status, { timeout: 15 * 60_000, intervals: [3000] }).toBe('ready');
    await page.goto(`/characters/avatars/${made.id}`);
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 15 * 60_000 });
    await page.waitForTimeout(1500);
    await shot('01-editor');
    const avatarId = page.url().split('/').pop()!;
    const detail = await api(page, 'GET', `/api/avatars/${avatarId}`);
    // The import report: Blender's check passed and nothing is unweighted.
    expect(detail.info.conversion?.validation?.check?.ok, JSON.stringify(detail.info.conversion?.validation?.check)).toBe(true);

    // The body type the auto-mapper found, in the Bones tab.
    await page.getByRole('tab', { name: 'Bones', exact: true }).click();
    const bodyType = page.getByLabel('Body type');
    await expect(bodyType).toBeVisible();
    await expect(bodyType.locator('option:checked')).toHaveText(c.family);
    await shot('02-bones');

    const who = `Sample ${c.file.replace(/\W+/g, ' ').trim()} ${info.project.name}`;
    const character = await api(page, 'POST', '/api/characters', { card: { name: who, first_mes: 'Hello.' } });
    await api(page, 'PATCH', `/api/characters/${character.id}`, { game: { avatar3d: avatarId, display: 'auto' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: character.id });
    await page.evaluate((url) => { history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')); }, `/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Switch to stage view' }).click();
    const stage = page.getByTestId('stage-3d');
    await expect(stage).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
    await page.waitForTimeout(2500);
    await shot('03-stage-idle');

    for (const [i, emote] of c.emotes.entries()) {
      const result = await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'avatar.emote', who, emote }] });
      expect(result.errors, emote).toEqual([]);
      await expect(stage).toHaveAttribute('data-emote', new RegExp(`:${emote}$`), { timeout: 30_000 });
      await page.waitForTimeout(700);
      await shot(`${String(i + 4).padStart(2, '0')}-${emote}`);
      await page.waitForTimeout(1600);
    }
    if (c.pose) {
      const result = await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'avatar.pose', who, pose: c.pose }] });
      expect(result.errors).toEqual([]);
      await page.waitForTimeout(2200);
      await shot(`20-pose-${c.pose}`);
    }
    // The emote picker offers what this body can do (and its own clips by name).
    await page.getByRole('button', { name: 'Emotes' }).click();
    await shot('21-emote-picker');
    await page.keyboard.press('Escape');

    const video = page.video();
    await page.close();
    if (video) await video.saveAs(path.join(dir, 'stage.webm'));
    expect(errors).toEqual([]);
  });
}
