/** Start npm run dev -w apps/web first. Only renders Everloom's own built-in recipes. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const browser = await chromium.launch({ ...(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.goto(process.env.CREATOR_THUMBNAIL_ORIGIN ?? 'http://127.0.0.1:5173');
  const items = await page.evaluate(async repo => {
    const { renderer } = await import(`/@fs/${repo}/tools/avatars/creator-thumbnails.ts`);
    window.creatorThumbnails = await renderer();
    return window.creatorThumbnails.items;
  }, repo);
  for (const { kind, id } of items) {
    const png = await page.evaluate(({ kind, id }) => window.creatorThumbnails.render(kind, id), { kind, id });
    const dir = path.join(repo, 'apps/web/public/avatar/creator-thumbnails', kind);
    await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, `${id}.png`), Buffer.from(png, 'base64'));
  }
  await page.evaluate(() => window.creatorThumbnails.dispose());
  console.log(`Rendered ${items.length} built-in creator thumbnails.`);
} finally { await browser.close(); }
