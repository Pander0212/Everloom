import { expect, test } from '@playwright/test';
import { api, mockControl, saveJson, seedWorld } from './helpers';

/**
 * What the scenery costs (docs/ux/themes.md › Performance). The page runs with the CPU slowed 4×
 * (Chrome's "mid-tier mobile" setting) and Chrome's own count of main-thread task time is compared
 * over 6 seconds, with each theme's scenery on and with scenery off.
 */
const SCENIC = ['lantern', 'night', 'terminal', 'pixel', 'rain', 'sketch', 'sakura', 'neon', 'parchment'];

test('scenery CPU cost', async ({ page }, info) => {
  test.setTimeout(600_000);
  await mockControl({ reset: true });
  const { chat } = await seedWorld(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const busy = async () => {
    const m = (await cdp.send('Performance.getMetrics')).metrics;
    return m.find((x) => x.name === 'TaskDuration')!.value;
  };
  const measure = async (look: string, scenery: 'animated' | 'off') => {
    await api(page, 'PATCH', '/api/settings', { look: { id: look, scenery } });
    await page.goto(`/chat/${chat.id}`);
    await expect(page.locator('html')).toHaveAttribute('data-look', look);
    await page.waitForTimeout(2500); // settle: fonts, first paint, the chat's own work
    await page.evaluate(() => {
      const s = (window.__scenery ??= { frames: 0, ms: 0, since: 0 });
      s.frames = 0;
      s.ms = 0;
      s.since = performance.now();
    });
    const t0 = Date.now();
    const b0 = await busy();
    await page.waitForTimeout(6000);
    const b1 = await busy();
    const wall = (Date.now() - t0) / 1000;
    const s = await page.evaluate(() => window.__scenery!);
    return { cpu: (b1 - b0) / wall, fps: s.frames / wall, msPerFrame: s.frames ? s.ms / s.frames : 0 };
  };
  const out: Record<string, unknown> = {};
  for (const id of SCENIC) {
    // The same theme with scenery off is the baseline (fonts and colors cost the same).
    const off = await measure(id, 'off');
    const on = await measure(id, 'animated');
    out[id] = { ...on, offCpu: off.cpu, extraCpu: on.cpu - off.cpu };
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await api(page, 'PATCH', '/api/settings', { look: { id: 'everloom', scenery: 'animated' } });
  saveJson(`scenery-cpu-${info.project.name}.json`, out);
  console.log(JSON.stringify(out, null, 1));
  // The scene's own script: a few percent of one slowed core at most. Everything the page does on
  // the main thread (here including software compositing, as headless Chromium has no GPU): under
  // 10% on the phone, where the scenery is a thin band.
  for (const id of SCENIC) {
    const r = out[id] as { extraCpu: number; fps: number; msPerFrame: number };
    expect((r.fps * r.msPerFrame) / 1000, `${id} script`).toBeLessThan(info.project.name === 'phone' ? 0.02 : 0.04);
    if (info.project.name === 'phone') expect(r.extraCpu, `${id} main thread`).toBeLessThan(0.1);
  }
});

declare global {
  interface Window {
    __scenery?: { frames: number; ms: number; since: number };
  }
}
