// Design QA: take screenshots of key screens in several viewports and both themes.
// Usage: node scripts/shots.mjs <outDir> [baseUrl] [paths...]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
const base = process.argv[3] ?? 'http://localhost:8787';
const paths = process.argv.slice(4).length ? process.argv.slice(4) : ['/'];
mkdirSync(out, { recursive: true });
const VIEWPORTS = { phone: { width: 390, height: 844 }, small: { width: 360, height: 800 }, land: { width: 844, height: 390 }, desk: { width: 1280, height: 800 } };
const which = (process.env.VP ?? 'phone,desk').split(',');
const themes = (process.env.THEMES ?? 'dark,light').split(',');
const browser = await chromium.launch();
const errors = [];
for (const vpName of which) {
  for (const theme of themes) {
    const ctx = await browser.newContext({ viewport: VIEWPORTS[vpName], colorScheme: theme, deviceScaleFactor: 2, hasTouch: vpName !== 'desk', isMobile: vpName !== 'desk' && vpName !== 'land' });
    await ctx.addInitScript((t) => localStorage.setItem('everloom.theme', t), theme);
    const page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`${vpName}/${theme}: ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`${vpName}/${theme}: ${e.message}`));
    await page.goto(base + '/');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(600);
    if (await page.getByRole('heading', { name: 'Sign in' }).isVisible().catch(() => false)) {
      await page.getByLabel('Username').fill(process.env.EV_USER ?? 'owner');
      await page.getByLabel('Password').fill(process.env.EV_PASS ?? 'correct horse battery');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForTimeout(800);
    }
    for (const p of paths) {
      const [path, action] = p.split('#');
      await page.goto(base + path);
      await page.waitForTimeout(900);
      if (action) {
        for (const step of action.split('|')) {
          const [kind, arg] = step.split(':');
          if (kind === 'click') await page.getByRole('button', { name: arg }).first().click().catch((e) => errors.push(`click ${arg}: ${e.message.split('\n')[0]}`));
          if (kind === 'text') await page.getByText(arg).first().click().catch((e) => errors.push(`text ${arg}: ${e.message.split('\n')[0]}`));
          if (kind === 'wait') await page.waitForTimeout(Number(arg));
        }
        await page.waitForTimeout(700);
      }
      const name = `${(path + (action ? '-' + action : '')).replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'root'}-${vpName}-${theme}.png`;
      await page.screenshot({ path: `${out}/${name}` });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (overflow) errors.push(`${name}: horizontal overflow`);
    }
    await ctx.close();
  }
}
await browser.close();
console.log(errors.length ? `ISSUES:\n${errors.join('\n')}` : 'no console errors');
