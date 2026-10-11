/** Local visual verification using checked official archives; not a production install path. */
import { chromium, firefox } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { buildApp } from '../apps/server/src/app.js';
import { loadConfig } from '../apps/server/src/config.js';
import { saveModelFile } from '../apps/server/src/services/media.js';
import { setKv } from '../apps/server/src/services/settings.js';

const dataDir = process.env.NATIVE_TEST_DATA ?? mkdtempSync(path.join(os.tmpdir(), 'everloom-native-visual-'));
const built = await buildApp(loadConfig({ dataDir, webDir: path.resolve('apps/web/dist'), logLevel: 'error' }), { logger: false });
const baseURL = 'http://127.0.0.1:8801';
await built.app.listen({ host: '127.0.0.1', port: 8801 });
const dir = path.resolve('docs/3d-fix-evidence'); mkdirSync(dir, { recursive: true });
const seed = (owner: string) => {
  const selections = ['skins/young_caucasian_female_special_suit/', 'skins/young_caucasian_female/', 'skins/young_african_female/', 'clothes/female_casualsuit01/', 'clothes/male_casualsuit01/', 'hair/bob01/', 'hair/short01/', 'eyes/', 'eyebrows/eyebrow001/', 'eyelashes/eyelashes01/', 'teeth/teeth_base/', 'tongue/tongue01/'];
  for (const [pack, expected] of [['core', '9218e83c44a0335f37e01bcf471c6d57899115cacff9031fc817a34c709511ec'], ['system', '2da052728c2900d2170862cebad797b4daa2d8b9334d7db66275bf45b00ac583']] as const) {
    const bytes = readFileSync(path.resolve(`apps/web/public/avatar/makehuman-${pack}.zip`));
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('The visual fixture archive hash does not match.');
    const assets = unzipSync(bytes, { filter: f => pack === 'core' ? /\/src\/mpfb\/data\/(3dobjs\/base\.obj|rigs\/standard\/|targets\/|faceunits\/)/.test(f.name) && /\.(obj|json|target|gz)$/.test(f.name) && !/genital|penis|vagina|nipple|anus/.test(f.name) : /\.(obj|mhclo|mhmat|png|jpg|jpeg)$/.test(f.name) });
    const files: Record<string, string> = {};
    for (let [name, bytes] of Object.entries(assets)) {
      name = name.replace(/^.*\/src\/mpfb\/data\//, '');
      const media = saveModelFile(built.ctx, owner, Buffer.from(bytes), { kind: 'model-makehuman', ext: name.split('.').pop()!, meta: { makehuman: pack, path: name, license: 'CC0 1.0' } });
      files[name] = media.id;
    }
    setKv(built.ctx, owner, `makehuman:${pack}:v1`, { version: expected, files, bytes: bytes.length });
    console.log('Seeded verified data', pack, Object.keys(files).length);
  }
};
try {
  for (const [name, engine] of [['chromium', chromium], ['firefox', firefox]] as const) {
    if (process.env.NATIVE_BROWSER && process.env.NATIVE_BROWSER !== name) continue;
    const browser = await engine.launch(name === 'chromium' ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : { firefoxUserPrefs: { 'webgl.force-enabled': true } });
    try {
      const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
      const username = `visual_${name}`;
      const response = await context.request.post('/api/auth/setup', { data: { username, password: 'correct horse battery' } });
      if (!response.ok()) {
        const login = await context.request.post('/api/auth/login', { data: { username: 'visual_chromium', password: 'correct horse battery' } });
        if (!login.ok()) throw new Error(await login.text());
      }
      const user = built.ctx.sys.prepare('SELECT id FROM users WHERE username = ?').get('visual_chromium') as { id: string };
      if (name === 'chromium' && !process.env.NATIVE_TEST_DATA) seed(user.id);
      const page = await context.newPage(), events: unknown[] = [];
      page.setDefaultTimeout(90000);
      page.on('pageerror', e => events.push({ error: e.message }));
      page.on('console', m => { if (m.type() === 'error') events.push({ console: m.text() }); });
      page.on('response', r => { if (/\/api\/makehuman|\/media\//.test(r.url()) && !r.ok()) events.push({ url: r.url(), status: r.status() }); });
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      if (await page.getByRole('heading', { name: 'How will you use Everloom?' }).isVisible()) await page.getByRole('listitem').filter({ hasText: 'Full RPG' }).click();
      await page.getByRole('heading', { name: 'Chats', exact: true }).waitFor({ timeout: 60000 });
      await page.goto('/characters/avatars', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByTestId('avatar-make').click();
      await page.getByRole('menuitem', { name: 'MakeHuman (in your browser)', exact: true }).click();
      await page.getByTestId('native-human-maker').waitFor({ timeout: 30000 });
      await page.waitForFunction(() => ['ready', 'error', 'unsupported'].includes(document.querySelector('[data-testid="avatar-preview"]')?.getAttribute('data-state') ?? ''), null, { timeout: 120000 }).catch(e => { events.push({ failure: e.message }); });
      events.push({ state: await page.getByTestId('avatar-preview').getAttribute('data-state'), body: await page.locator('body').innerText() });
      events.push({ maker: await page.getByTestId('native-human-maker').innerText() });
      writeFileSync(`${dir}/native-${name}.json`, JSON.stringify(events, null, 2));
      await page.screenshot({ path: `${dir}/native-${name}-phone.png`, timeout: 60000 }).catch(e => console.log('Screenshot:', e.message));
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.screenshot({ path: `${dir}/native-${name}-desktop.png`, timeout: 60000 });
      if (await page.getByTestId('avatar-preview').getAttribute('data-state') !== 'ready') throw new Error('The native preview failed; inspect the recorded diagnostics.');
      console.log(name, 'creating native character');
      await page.getByRole('button', { name: 'Create character', exact: true }).click({ timeout: 120000, noWaitAfter: true });
      await page.waitForURL(/\/characters\/avatars\/av_/, { timeout: 120000, waitUntil: 'domcontentloaded' }).catch(async e => {
        events.push({ creationError: e.message, body: await page.locator('body').innerText() });
        writeFileSync(`${dir}/native-${name}.json`, JSON.stringify(events, null, 2));
        await page.screenshot({ path: `${dir}/native-${name}-creation-failure.png`, timeout: 60000 });
        throw e;
      });
      const id = page.url().split('/').pop()!;
      let detail: { status: string; error?: string; config?: { makehuman?: unknown } } | undefined;
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) { detail = await (await context.request.get(`/api/avatars/${id}`)).json(); if (detail?.status !== 'processing') break; await new Promise(resolve => setTimeout(resolve, 1000)); }
      if (detail?.status !== 'ready' || !detail.config?.makehuman) throw new Error(`Native creation did not persist its recipe: ${JSON.stringify(detail)}`);
      await page.getByTestId('avatar-preview').waitFor({ timeout: 90000 }).catch(async error => {
        events.push({ editorError: error.message, url: page.url(), body: await page.locator('body').innerText(), detail });
        writeFileSync(`${dir}/native-${name}.json`, JSON.stringify(events, null, 2));
        await page.screenshot({ path: `${dir}/native-${name}-editor-failure.png`, timeout: 60000 });
        throw error;
      });
      await page.waitForFunction(() => document.querySelector('[data-testid="avatar-preview"]')?.getAttribute('data-state') === 'ready', null, { timeout: 90000 });
      await page.screenshot({ path: `${dir}/native-${name}-editor.png`, timeout: 60000 });
      if (name === 'chromium') {
        await page.getByRole('switch', { name: 'Autosave', exact: true }).click();
        const ready = async () => { await page.waitForTimeout(350); await page.waitForFunction(() => document.querySelector('[data-testid="avatar-preview"]')?.getAttribute('data-state') === 'ready', null, { timeout: 90000 }); };
        const looks = [
          { name: 'feminine-long', gender: 0.1, age: 0.35, muscle: 0.4, weight: 0.45, skin: 'young_caucasian_female', hair: 'long01' },
          { name: 'masculine-short', gender: 0.95, age: 0.45, muscle: 0.7, weight: 0.55, skin: 'young_african_male', hair: 'short02' },
          { name: 'mature-braid', gender: 0.2, age: 0.72, muscle: 0.35, weight: 0.58, skin: 'middleage_asian_female', hair: 'braid01' },
        ];
        for (const look of looks) {
          await page.getByRole('tab', { name: 'Body', exact: true }).click();
          for (const key of ['gender', 'age', 'muscle', 'weight'] as const) await page.getByLabel(`${key} value`, { exact: true }).fill(String(look[key]));
          for (const [label, desired] of [['Skin', look.skin], ['Hair', look.hair]] as const) {
            const option = await page.getByLabel(label, { exact: true }).locator('option').evaluateAll((options, desired) => options.find(option => (option as HTMLOptionElement).value.includes(desired))?.getAttribute('value'), desired);
            if (!option) throw new Error(`The visual profile asset is missing: ${desired}`);
            await page.getByLabel(label, { exact: true }).selectOption(option);
          }
          await ready();
          for (const framing of ['Face', 'Full']) {
            await page.getByRole('radiogroup', { name: 'Framing' }).getByRole('radio', { name: framing, exact: true }).click();
            await ready(); await page.screenshot({ path: `${dir}/native-${look.name}-${framing.toLowerCase()}.png`, timeout: 60000 });
          }
          await page.getByRole('tab', { name: 'Check', exact: true }).click(); await page.getByLabel('Expression', { exact: true }).selectOption('joy'); await ready();
          await page.getByRole('radiogroup', { name: 'Framing' }).getByRole('radio', { name: 'Face', exact: true }).click(); await ready();
          await page.screenshot({ path: `${dir}/native-${look.name}-smile.png`, timeout: 60000 });
          await page.getByLabel('Expression', { exact: true }).selectOption('neutral');
          await page.getByLabel('Portrait lighting', { exact: true }).selectOption('golden'); await ready();
          await page.screenshot({ path: `${dir}/native-${look.name}-golden.png`, timeout: 60000 });
          await page.getByLabel('Portrait lighting', { exact: true }).selectOption('studio');
        }
        await page.getByRole('tab', { name: 'Body', exact: true }).click();
        await page.getByRole('radiogroup', { name: 'Framing' }).getByRole('radio', { name: 'Full', exact: true }).click();
        for (const value of [0, 1]) {
          await page.getByLabel('Breast size value', { exact: true }).fill(String(value)); await page.getByLabel('Butt size value', { exact: true }).fill(String(value)); await ready();
          await page.screenshot({ path: `${dir}/native-body-extreme-${value}.png`, timeout: 60000 });
        }
      }
      events.push({ creation: 'ready', id, recipePersisted: true });
      console.log(name, 'native preview ready', events);
      writeFileSync(`${dir}/native-${name}.json`, JSON.stringify(events, null, 2));
    } finally { await browser.close(); }
  }
} finally {
  await built.app.close(); built.ctx.db.close(); if (built.ctx.sys !== built.ctx.db && built.ctx.sys.open) built.ctx.sys.close();
  console.log('Visual test data:', dataDir);
}
