/**
 * Acceptance item 11: a 250-bone avatar with physics chains (tests/fixtures/avatars/models/rig250.glb:
 * 245 bones, 30 hair strands, 14 skirt panels, breast and butt chains, twist helpers) dancing on the
 * stage, on the phone profile (4× CPU slowdown), per quality. Headless Chromium draws with
 * SwiftShader, so the frame rate is the software rasteriser's; the CPU time per frame (animation,
 * physics, skinning upload, draw submission) is what carries over to a phone. Runs with MEASURE_3D=1:
 *
 *   MEASURE_3D=1 npx playwright test tests/e2e/perf-250.spec.ts --project phone-390-light --project desktop-1280-light
 *
 * The numbers go to docs/3d-import/evidence/perf-250.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { api, expect, test } from './fixtures';
import { phone, SWIFTSHADER, upload } from './avatar-helpers';

test.use(SWIFTSHADER);
test.beforeEach(({}, info) => {
  test.skip(!process.env.MEASURE_3D, 'measuring runs only with MEASURE_3D=1');
  test.skip(!/^(desktop-1280|phone-390)-light$/.test(info.project.name), 'measured on two projects');
});
test.describe.configure({ timeout: 900_000 });

type Stats = { fps: number; frameMs: number; level: number; drawCalls: number; triangles: number };
interface StageHandle { stats: Stats; onFrame: ((s: Stats) => void) | null; ids(): string[]; get(id: string): { emote(id: string, o?: { loop?: boolean }): Promise<boolean>; physics: { joints: unknown[] } } | undefined }

test('a 250-bone avatar with physics dancing on the stage, per quality', async ({ page, errors }, info) => {
  const avatar = await upload(page, path.resolve('tests/fixtures/avatars/models/rig250.glb'), 'Rig 250');
  const c = await api(page, 'POST', '/api/characters', { card: { name: `Rig 250 ${info.project.name}`, first_mes: 'Hi.' } });
  await api(page, 'PATCH', `/api/characters/${c.id}`, { game: { avatar3d: avatar, display: 'auto' } });
  const chat = await api(page, 'POST', '/api/chats', { characterId: c.id });
  const cdp = await page.context().newCDPSession(page);
  const rows: Record<string, unknown>[] = [];
  for (const quality of ['low', 'medium', 'high'] as const) {
    await page.evaluate((q) => { localStorage.setItem('everloom:3d', JSON.stringify({ quality: q, fpsCap: 60, physics: true, outlines: true })); localStorage.setItem('everloom:debug3d', '1'); }, quality);
    await page.goto(`/chat/${chat.id}`);
    // Stage mode is remembered per chat: switch only the first time.
    await expect(page.getByRole('button', { name: /^Switch to (stage|chat) (view|mode)$/ }).first()).toBeVisible({ timeout: 30_000 });
    const toStage = page.getByRole('button', { name: 'Switch to stage view' });
    if (await toStage.isVisible()) await toStage.click();
    await expect(page.getByTestId('stage-3d')).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
    await page.waitForTimeout(2000);
    if (phone()) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const r = await page.evaluate(async () => {
      const s = (window as unknown as { __everloomStage: StageHandle }).__everloomStage;
      const id = s.ids()[0]!;
      await s.get(id)!.emote('dance', { loop: true });
      await new Promise((ok) => setTimeout(ok, 3000));
      const frames: Array<{ ms: number; at: number }> = [];
      const prev = s.onFrame;
      s.onFrame = (st) => { frames.push({ ms: st.frameMs, at: performance.now() }); prev?.(st); };
      await new Promise((ok) => setTimeout(ok, 8000));
      s.onFrame = prev;
      const cpu = frames.map((f) => f.ms).sort((a, b) => a - b);
      const span = frames.length > 1 ? frames.at(-1)!.at - frames[0]!.at : 8000;
      return {
        fps: Math.round(((frames.length - 1) / span) * 10000) / 10,
        cpuMsMean: Math.round((cpu.reduce((a, b) => a + b, 0) / Math.max(1, cpu.length)) * 10) / 10,
        cpuMsP95: cpu[Math.floor(cpu.length * 0.95)] ?? 0,
        joints: s.get(id)!.physics.joints.length,
        level: s.stats.level,
        drawCalls: s.stats.drawCalls,
        triangles: s.stats.triangles,
      };
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    rows.push({ profile: phone() ? 'phone (4× CPU slowdown)' : 'desktop', quality, ...r, cpuFpsCeiling: Math.round((1000 / Math.max(1, r.cpuMsMean)) * 10) / 10 });
    if (quality === 'medium') await page.getByTestId('stage-3d').screenshot({ path: `docs/3d-import/evidence/perf-250-${info.project.name}.png` });
  }
  const file = 'docs/3d-import/evidence/perf-250.json';
  let all: Record<string, unknown> = {};
  try { all = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first run */ }
  all[info.project.name] = rows;
  writeFileSync(file, JSON.stringify(all, null, 1));
  console.log(JSON.stringify(rows));
  expect(errors).toEqual([]);
});
