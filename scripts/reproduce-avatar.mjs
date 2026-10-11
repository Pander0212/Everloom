import { chromium, firefox } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const dir = 'docs/3d-fix-evidence';
mkdirSync(dir, { recursive: true });
const file = process.argv[2];
if (!file) throw new Error('Pass a local model path');
const baseURL = process.env.REPRO_BASE ?? 'http://127.0.0.1:8799';
for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]]) {
  const browser = await engine.launch(name === 'chromium' ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, storageState: 'tests/e2e/.artifacts/auth.json' });
  const page = await context.newPage();
  const events = [];
  page.on('console', m => events.push({ kind: 'console', type: m.type(), text: m.text() }));
  page.on('pageerror', e => events.push({ kind: 'exception', text: e.message }));
  page.on('response', r => { if (/\/api\/avatars|\/media\/|\/three\//.test(r.url())) events.push({ kind: 'response', url: r.url(), status: r.status() }); });
  page.on('requestfailed', r => events.push({ kind: 'network', url: r.url(), error: r.failure()?.errorText }));
  try {
    await page.goto('/characters/avatars', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('avatar-import').click();
    await (await chooser).setFiles(file);
    await page.waitForURL(/\/characters\/avatars\/av_/, { timeout: 30000 });
    const id = page.url().split('/').pop();
    let detail;
    for (let i = 0; i < 180; i++) {
      detail = await (await page.request.get(`/api/avatars/${id}`)).json();
      if (detail.status !== 'processing') break;
      await page.waitForTimeout(1000);
    }
    events.push({ kind: 'detail', detail });
    await page.waitForTimeout(6000);
    events.push({ kind: 'preview', state: await page.getByTestId('avatar-preview').getAttribute('data-state').catch(() => null), text: await page.locator('main').innerText().catch(() => '') });
    console.log(name, detail?.status, detail?.error, events.filter(e => e.type === 'error' || e.kind === 'exception'));
  } catch (e) { events.push({ kind: 'failure', message: e.message }); console.log(name, e.message); }
  writeFileSync(`${dir}/owner-${name}-before.json`, JSON.stringify(events, null, 2));
  await page.screenshot({ path: `${dir}/owner-${name}-before.png`, fullPage: true, timeout: 60000 }).catch(e => console.log('Screenshot:', e.message));
  await browser.close();
}
