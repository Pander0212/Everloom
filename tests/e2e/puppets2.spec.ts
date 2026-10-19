/**
 * Puppets v2 in a real browser (/lab/puppets2): the auto-rigged test figure waves with a bent elbow,
 * crosses and raises its arms, walks in place, turns to its profile and walks across the stage with
 * its feet on the floor; three on stage stay within the frame budget. With EVIDENCE=1 the frames go to
 * docs/puppets-v2/evidence/ (the test figure is procedural shapes, no generated art).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { api, expect, mockControl, test } from './fixtures';

test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });
test.beforeEach(({}, info) => test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'WebGL checks run on two projects'));

const phone = () => test.info().project.name.startsWith('phone');
async function shot(page: Page, name: string) {
  const dir = process.env.EVIDENCE ? path.resolve('docs/puppets-v2/evidence') : test.info().outputPath();
  mkdirSync(dir, { recursive: true });
  await page.locator('[data-testid=puppet2-canvas], [data-testid=stage-puppets2]').first().screenshot({ path: path.join(dir, `lab-${name}${phone() ? '-phone' : ''}.png`) });
}
const stage = (page: Page, js: string) => page.evaluate(`(() => { const s = window.__puppet2Lab.stage; ${js} })()`);

test('the auto-rigged figure: gestures, walking, turning, three on stage', async ({ page, errors }) => {
  await page.goto('/lab/puppets2');
  await expect(page.getByTestId('puppet2-lab')).toHaveAttribute('data-ready', '1', { timeout: 30_000 });
  await page.waitForTimeout(800);
  await shot(page, 'rest');
  await stage(page, "s.gesture('p1', 'wave_L')");
  await page.waitForTimeout(700);
  await shot(page, 'wave');
  await page.waitForTimeout(2000);
  await stage(page, "s.setBase('p1', 'armsCrossed')");
  await page.waitForTimeout(800);
  await shot(page, 'cross');
  await stage(page, "s.setBase('p1', 'armsUp')");
  await page.waitForTimeout(800);
  await shot(page, 'arms-up');
  await stage(page, "s.setBase('p1', 'walk')");
  await page.waitForTimeout(1250);
  await shot(page, 'walk-front');
  await stage(page, "s.setBase('p1', 'idle')");
  await page.waitForTimeout(500);
  // Walk to the left edge: turns to the profile on the way, back to the front on arrival.
  await stage(page, "s.walkTo('p1', 0.15)");
  await page.waitForTimeout(450);
  expect(await stage(page, "return s.get('p1').view")).toBe('side');
  await shot(page, 'walk-side');
  await expect.poll(() => stage(page, "return s.get('p1').walkTo"), { timeout: 10_000 }).toBeNull();
  await page.waitForTimeout(500);
  expect(await stage(page, "return s.get('p1').view")).toBe('front');
  await shot(page, 'arrived');
  await stage(page, "s.gesture('p1', 'jump')");
  await page.waitForTimeout(650);
  await shot(page, 'jump');
  // Three on stage.
  await page.getByLabel('How many').selectOption('3');
  await expect(page.getByTestId('puppet2-lab')).toHaveAttribute('data-ready', '3', { timeout: 30_000 });
  await stage(page, "s.setBase('p1', 'walk'); s.gesture('p2', 'wave_R'); s.setBase('p3', 'handsOnHips')");
  await page.waitForTimeout(2500);
  await shot(page, 'three');
  const st = (await stage(page, 'return { ...s.stats }')) as { puppets: number; frameMs: number };
  expect(st.puppets).toBe(3);
  // Software WebGL sets the frame rate here; the CPU time per frame is what carries over.
  expect(st.frameMs).toBeLessThan(phone() ? 40 : 16);
  expect(errors).toEqual([]);
});

test('a full-body puppet on the story stage follows the story, and a new swipe takes it back', async ({ page, errors }) => {
  const { figurePack } = await import('./puppet2-pack');
  const zip = await figurePack({ outfits: true });
  await page.goto('/');
  const puppet = await page.evaluate(async (b64) => {
    const body = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const status = await (await fetch('/api/auth/status')).json();
    const r = await fetch('/api/puppets2/import', { method: 'POST', body, headers: { 'content-type': 'application/zip', 'x-csrf-token': status.csrf } });
    return r.json();
  }, zip.toString('base64'));
  expect(puppet).toMatchObject({ views: ['front', 'side'], outfits: ['casual', 'formal'] });
  const name = `Ines ${test.info().project.name.replace(/-/g, ' ')}`;
  const key = name.toLowerCase();
  const ch = await api(page, 'POST', '/api/characters', { card: { name, first_mes: 'Ines looks up. "Oh, hello."' } });
  await api(page, 'PATCH', `/api/characters/${ch.id}`, { game: { puppet2: puppet.id, display: 'puppet' } });
  const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id });
  await page.goto(`/chat/${chat.id}`);
  await page.getByRole('button', { name: 'Switch to stage view' }).click();
  const layer = page.getByTestId('stage-puppets2');
  await expect(layer).toHaveAttribute('data-state', new RegExp(`^${ch.id}:front:idle::dress$`), { timeout: 30_000 });
  await expect(page.getByTestId('stage-sprite')).toHaveCount(0);
  // The story waves and changes clothes: a gesture plays once, the other outfit is hidden.
  const r = await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'avatar.emote', who: name, emote: 'wave' }, { type: 'avatar.pose', who: name, pose: 'idle_confident' }] });
  expect(r.errors).toEqual([]);
  await page.reload();
  await expect(layer).toHaveAttribute('data-state', new RegExp(`^${ch.id}:front:handsOnHips:`), { timeout: 30_000 });
  // Through a reply: the tracker puts on the formal outfit; a new swipe without it takes it off.
  await mockControl({ trackerOps: [{ type: 'avatar.outfit', who: name, outfit: 'formal' }, { type: 'avatar.emote', who: name, emote: 'wave' }] });
  await page.getByLabel('Message', { exact: true }).fill('Ready for the gala?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.avatars[key]?.outfit, { timeout: 20_000 }).toBe('formal');
  await expect(layer).toHaveAttribute('data-state', new RegExp(`^${ch.id}:front:handsOnHips:(wave_L)?:shorts,top$`), { timeout: 20_000 });
  await shot(page, 'story-formal');
  await mockControl({ trackerOps: [] });
  await page.getByRole('button', { name: 'New version' }).click();
  await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.avatars[key]?.outfit ?? null, { timeout: 20_000 }).toBeNull();
  await expect(layer).toHaveAttribute('data-state', new RegExp(`^${ch.id}:front:handsOnHips:[^:]*:dress$`), { timeout: 20_000 });
  await mockControl({ trackerOps: null });
  expect(errors).toEqual([]);
});
