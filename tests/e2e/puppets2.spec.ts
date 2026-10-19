/**
 * Puppets v2 in a real browser (/lab/puppets2): the auto-rigged test figure waves with a bent elbow,
 * crosses and raises its arms, walks in place, turns to its profile and walks across the stage with
 * its feet on the floor; three on stage stay within the frame budget. With EVIDENCE=1 the frames go to
 * docs/puppets-v2/evidence/ (the test figure is procedural shapes, no generated art).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

test.use({ launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });
test.beforeEach(({}, info) => test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'WebGL checks run on two projects'));

const phone = () => test.info().project.name.startsWith('phone');
async function shot(page: Page, name: string) {
  const dir = process.env.EVIDENCE ? path.resolve('docs/puppets-v2/evidence') : test.info().outputPath();
  mkdirSync(dir, { recursive: true });
  await page.getByTestId('puppet2-canvas').screenshot({ path: path.join(dir, `lab-${name}${phone() ? '-phone' : ''}.png`) });
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
