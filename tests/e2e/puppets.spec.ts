/**
 * Everloom Puppets in a real browser: the placeholder puppet in the lab (/lab/puppets) renders,
 * turns its head, blinks and talks; three on stage keep their frame CPU time low. With EVIDENCE=1
 * the screenshots go to docs/puppets-evidence/ (the placeholder is simple shapes, CC0).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });
test.beforeEach(({}, info) => test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'WebGL checks run on two projects'));

const phone = () => test.info().project.name.startsWith('phone');
async function shot(page: Page, name: string) {
  const dir = process.env.EVIDENCE ? path.resolve('docs/puppets-evidence') : test.info().outputPath();
  mkdirSync(dir, { recursive: true });
  await page.getByTestId('puppet-canvas').screenshot({ path: path.join(dir, `${name}${phone() ? '-phone' : ''}.png`) });
}
const stats = (page: Page) => page.evaluate(() => ({ ...window.__puppetLab!.stage.stats }));

test('the placeholder puppet: renders, turns, blinks, talks; three on stage', async ({ page, errors }) => {
  await page.goto('/lab/puppets');
  await expect(page.getByTestId('puppet-lab')).toHaveAttribute('data-ready', '1', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shot(page, 'placeholder-rest');
  // A head turn and an expression held from the sliders' hook.
  await page.evaluate(() => { const l = window.__puppetLab!; l.set('AngleX', -30); l.set('AngleY', 20); l.set('EyeLOpen', 0.42); l.set('EyeROpen', 0.42); l.set('MouthOpen', 1); });
  await page.waitForTimeout(500);
  await shot(page, 'placeholder-turn');
  await page.evaluate(() => { const l = window.__puppetLab!; for (const p of ['AngleX', 'AngleY', 'EyeLOpen', 'EyeROpen', 'MouthOpen']) l.set(p, null); });
  // Life: within a few seconds it blinks on its own; talking opens the mouth.
  const sawBlink = await page.evaluate(async () => {
    const a = window.__puppetLab!.stage.get('p1')!.animator;
    const until = performance.now() + 8000;
    while (performance.now() < until) { await new Promise((r) => setTimeout(r, 30)); if (a.rig.get('EyeLOpen') < 0.2) return true; }
    return false;
  });
  expect(sawBlink).toBe(true);
  await page.getByRole('button', { name: 'Talk' }).click();
  await expect.poll(() => page.evaluate(() => window.__puppetLab!.stage.get('p1')!.animator.rig.get('MouthOpen'))).toBeGreaterThan(0.3);
  await page.getByRole('button', { name: 'nod', exact: true }).click();
  // Three on stage.
  await page.getByLabel('How many').selectOption('3');
  await expect(page.getByTestId('puppet-lab')).toHaveAttribute('data-ready', '3', { timeout: 30_000 });
  await page.waitForTimeout(2500);
  await shot(page, 'placeholder-three');
  const s = await stats(page);
  expect(s.puppets).toBe(3);
  // Software WebGL sets the frame rate here; the CPU time per frame is what carries over.
  expect(s.frameMs).toBeLessThan(phone() ? 40 : 16);
  expect(errors).toEqual([]);
});
