#!/usr/bin/env node
/**
 * Records the Puppets v2 acceptance clips (docs/puppets-v2/README.md › Acceptance) for character
 * packs, in a real browser on a phone viewport, against a running Everloom server whose owner
 * account is fresh or uses the given password. Clips (webm) and frame strips (png) go to --out,
 * which for generated characters must be git-ignored (samples/gen/…).
 *
 *   node tools/puppets2/evidence.mjs --base http://127.0.0.1:8790 --out samples/gen/puppets2/evidence \
 *     --pack ines=samples/gen/puppets2/ines/pack.zip --pack teo=… --pack mascot=…
 *
 * The first pack is the main character (every clip); the second shows retargeting; all of them go
 * on stage together for the performance measurement (phone viewport, 4× CPU throttle).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values: a } = parseArgs({ options: { base: { type: 'string', default: 'http://127.0.0.1:8790' }, out: { type: 'string' }, pack: { type: 'string', multiple: true }, password: { type: 'string', default: 'evidence-password-1' } } });
if (!a.out || !a.pack?.length) throw new Error('need --out and at least one --pack name=zip');
if (/^(docs|apps|packages)\//.test(a.out)) throw new Error('generated characters never go into the repository: use samples/gen/…');
mkdirSync(a.out, { recursive: true });
const packs = a.pack.map((p) => { const [name, file] = p.split('='); return { name, file }; });
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: GL });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const report = { at: new Date().toISOString(), clips: [], perf: null };

async function login(page) {
  await page.goto(`${a.base}/`);
  await page.waitForTimeout(1500);
  if (await page.getByText('Create the owner account').isVisible().catch(() => false)) {
    await page.getByLabel('Username').fill('owner');
    await page.getByLabel('Password', { exact: true }).fill(a.password);
    await page.getByLabel('Confirm password').fill(a.password);
    await page.getByRole('button', { name: 'Create account' }).click();
  } else if (await page.getByLabel('Password', { exact: true }).isVisible().catch(() => false)) {
    await page.getByLabel('Username').fill('owner');
    await page.getByLabel('Password', { exact: true }).fill(a.password);
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(2000);
}

// Import every pack once (with a throwaway context), keeping the ids.
const setup = await browser.newContext();
const sp = await setup.newPage();
await login(sp);
for (const p of packs) {
  const meta = await sp.evaluate(async (b64) => {
    const body = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const st = await (await fetch('/api/auth/status')).json();
    const r = await fetch('/api/puppets2/import', { method: 'POST', body, headers: { 'content-type': 'application/zip', 'x-csrf-token': st.csrf } });
    return r.json();
  }, readFileSync(p.file).toString('base64'));
  if (!meta.id) throw new Error(`import of ${p.name} failed: ${JSON.stringify(meta).slice(0, 300)}`);
  p.id = meta.id;
  p.meta = meta;
  console.log('imported', p.name, meta.id, meta.views.join(','), `${meta.layers} layers`);
}
const state = await setup.storageState();
await setup.close();

/** One clip: a fresh phone context recording video, the lab with the puppet(s), a script of steps. */
async function clip(name, pack, steps) {
  const ctx = await browser.newContext({ ...phone, storageState: state, recordVideo: { dir: a.out, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${a.base}/lab/puppets2?p2=${pack.id}`);
  await page.waitForSelector('[data-testid=puppet2-lab][data-ready]', { timeout: 60000 });
  await page.waitForTimeout(600);
  const s = (js) => page.evaluate(`(() => { const s = window.__puppet2Lab.stage; ${js} })()`);
  const frames = [];
  const shot = async (label) => { const f = path.join(a.out, `${name}-${frames.length}.png`); await page.getByTestId('puppet2-canvas').screenshot({ path: f }); frames.push({ f, label }); };
  await steps({ page, s, shot, wait: (ms) => page.waitForTimeout(ms) });
  const video = page.video();
  await ctx.close();
  if (video) renameSync(await video.path(), path.join(a.out, `${name}.webm`));
  report.clips.push({ name, pack: pack.name, frames: frames.map((x) => ({ file: path.basename(x.f), label: x.label })), errors });
  console.log('clip', name, frames.length, 'frames', errors.length ? `errors: ${errors.join('; ')}` : '');
}

const [main, second] = packs;
await clip('1-wave', main, async ({ s, shot, wait }) => {
  await shot('rest');
  await s("s.gesture('p1', 'wave_L')");
  for (let i = 0; i < 4; i++) { await wait(380); await shot(`wave ${i}`); }
});
await clip('2-arms', main, async ({ s, shot, wait }) => {
  await s("s.setBase('p1', 'armsUp')"); await wait(1200); await shot('arms up');
  await s("s.setBase('p1', 'armsCrossed')"); await wait(1200); await shot('arms crossed');
  await s("s.setBase('p1', 'handsOnHips')"); await wait(1200); await shot('hands on hips');
});
await clip('3-walk', main, async ({ s, shot, wait }) => {
  // A phone stage is narrow: a smaller figure crosses it from one side to the other.
  await s("const p = s.get('p1'); p.height = 0.45; p.x = 0.85;");
  await wait(400);
  await s("s.walkTo('p1', 0.15)");
  for (let i = 0; i < 8; i++) { await wait(160); await shot(`walk ${i}`); }
  await wait(2000); await shot('turned back');
});
await clip('4-physics', main, async ({ s, shot, wait }) => {
  await s("s.setBase('p1', 'walk')"); await wait(900); await shot('walking');
  await s("s.setBase('p1', 'idle'); s.gesture('p1', 'jump')");
  for (let i = 0; i < 5; i++) { await wait(200); await shot(`jump ${i}`); }
  await wait(2500); await shot('settled');
});
await clip('5-outfits', main, async ({ page, s, shot, wait }) => {
  const sel = page.getByRole('combobox', { name: 'Outfit' });
  const opts = await sel.locator('option').allTextContents();
  for (const o of opts) {
    await sel.selectOption({ label: o });
    await s("s.gesture('p1', 'wave_L')");
    await wait(700);
    await shot(`outfit ${o}`);
    await wait(1600);
  }
});
await clip('6-talk', main, async ({ page, s, shot, wait }) => {
  await page.getByRole('button', { name: 'Talk' }).click();
  for (let i = 0; i < 3; i++) { await wait(140); await shot(`talking ${i}`); }
  for (const [i, e] of ['smile', 'angry', 'sad', 'surprised'].entries()) {
    await page.getByRole('combobox', { name: 'Expression' }).selectOption({ label: e });
    await wait(500); await shot(e);
    void i;
  }
  await page.getByRole('button', { name: 'Talk' }).click();
  await s("const p = s.get('p1'); p.life.blinkAt = s['time'];");
  await wait(60); await shot('blink');
});
if (main.meta.views.length > 1) {
  // Every view the character has: standing, waving, walking on the spot, then a turn front → side.
  await clip('9-views', main, async ({ s, shot, wait }) => {
    for (const v of ['front', 'threeQuarter', 'side', 'back'].filter((x) => main.meta.views.includes(x))) {
      await s(`s.setView('p1', '${v}'); s.setBase('p1', 'idle')`); await wait(900); await shot(`${v} idle`);
      await s("s.gesture('p1', 'wave_L')"); await wait(700); await shot(`${v} wave`);
      await wait(1500);
      await s("s.setBase('p1', 'walk')"); await wait(500); await shot(`${v} walk a`); await wait(330); await shot(`${v} walk b`);
      await s("s.setBase('p1', 'idle')"); await wait(600);
    }
    await s("s.setView('p1', 'front')"); await wait(1200);
    await s("s.setView('p1', 'side')"); for (let i = 0; i < 4; i++) { await wait(150); await shot(`turn ${i}`); }
  });
}
if (second) {
  await clip('7-retarget', second, async ({ s, shot, wait }) => {
    await s("s.gesture('p1', 'wave_L')"); await wait(700); await shot('wave');
    await wait(2000);
    await s("s.setBase('p1', 'armsCrossed')"); await wait(1200); await shot('arms crossed');
    await s("s.setBase('p1', 'walk')"); await wait(900); await shot('walk');
  });
}

// 8. Performance: every pack on stage, phone viewport, 4× CPU throttle, 5 s.
{
  const ctx = await browser.newContext({ ...phone, storageState: state });
  const page = await ctx.newPage();
  await page.goto(`${a.base}/lab/puppets2?p2=${packs.map((p) => p.id).join(',')}&pr=1.5`);
  await page.waitForSelector('[data-testid=puppet2-lab][data-ready]', { timeout: 60000 });
  await page.getByLabel('How many').selectOption('3');
  await page.waitForSelector('[data-testid=puppet2-lab][data-ready="3"]', { timeout: 60000 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluate("(() => { const s = window.__puppet2Lab.stage; s.setBase('p1', 'walk'); s.gesture('p2', 'wave_L'); s.setBase('p3', 'handsOnHips'); })()");
  await page.waitForTimeout(1500);
  const samples = [];
  for (let i = 0; i < 10; i++) { await page.waitForTimeout(500); samples.push(await page.evaluate(() => ({ ...window.__puppet2Lab.stage.stats }))); }
  await page.getByTestId('puppet2-canvas').screenshot({ path: path.join(a.out, '8-three.png') });
  const avg = (k) => Math.round((samples.reduce((t, x) => t + x[k], 0) / samples.length) * 10) / 10;
  report.perf = { puppets: samples.at(-1).puppets, fps: avg('fps'), frameMs: avg('frameMs'), drawCalls: avg('drawCalls'), triangles: avg('triangles'), note: 'phone viewport 390×844, pixel ratio 1.5, 4× CPU throttle, software WebGL (SwiftShader)' };
  console.log('perf', JSON.stringify(report.perf));
  await ctx.close();
}

writeFileSync(path.join(a.out, 'report.json'), JSON.stringify(report, null, 1));
await browser.close();
