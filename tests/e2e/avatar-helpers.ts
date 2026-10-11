/**
 * Shared steps for the custom-base specs (base-models.spec.ts and measure-3d.spec.ts): uploading a
 * base, opening the editor, fitting a garment by hand and saving, and writing evidence (screenshots
 * and numbers) to docs/3d-base-evidence/ when EVIDENCE=1.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { api, expect, test } from './fixtures';

export const F = path.resolve('tests/fixtures/avatars');
export const EVIDENCE = process.env.EVIDENCE ? path.resolve('docs/3d-base-evidence') : null;
export const phone = () => test.info().project.name.startsWith('phone');
/** Software WebGL (SwiftShader) for the heavy 3D specs. */
export const SWIFTSHADER = { launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } };

export async function ev(page: Page, name: string, target?: Locator) {
  const file = EVIDENCE ? path.join(EVIDENCE, `${name}${phone() ? '-phone' : ''}.png`) : test.info().outputPath(`${name}.png`);
  mkdirSync(path.dirname(file), { recursive: true });
  await (target ?? page).screenshot({ path: file });
}

/** Numbers for the status page, merged into docs/3d-base-evidence/<file> (timings.json by default). */
export function record(key: string, value: unknown, file = 'timings.json') {
  if (!EVIDENCE) return;
  const out = path.join(EVIDENCE, file);
  const all = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};
  all[`${key}${phone() ? ' (phone)' : ''}`] = value;
  writeFileSync(out, JSON.stringify(all, null, 1));
}

export async function upload(page: Page, file: string, name: string): Promise<string> {
  if (!page.url().startsWith('http')) await page.goto('/');
  const id = await page.evaluate(async ([b64, name]) => {
    const status = await (await fetch('/api/auth/status')).json();
    const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
    const r = await fetch(`/api/avatars?filename=${encodeURIComponent(`${name}.glb`)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-csrf-token': status.csrf }, body: bytes });
    return (await r.json()).id as string;
  }, [readFileSync(file).toString('base64'), name] as const);
  await expect.poll(async () => (await api(page, 'GET', `/api/avatars/${id}`)).status, { timeout: 60_000 }).toBe('ready');
  return id;
}

export async function open(page: Page, id: string, tab: string) {
  await page.goto(`/characters/avatars/${id}`);
  await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 90_000 });
  await page.getByRole('tab', { name: tab, exact: true }).click();
}

/** Saves the editor (autosave may already have): done when it says "Saved". */
export async function saveAvatar(page: Page) {
  const button = page.getByTestId('avatar-save');
  // Autosave may get there first (the button turns disabled under the click).
  if (await button.isEnabled()) await button.click({ timeout: 5_000 }).catch(() => undefined);
  await expect(button).toBeDisabled({ timeout: 60_000 });
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
}

export const preview = (page: Page) => page.getByTestId('avatar-preview');
export const settle = (page: Page, ms = 2500) => page.waitForTimeout(ms);
/** The OBJ, MTL and PNG of a fixture garment. */
export const garment = (n: string) => ['obj', 'mtl', 'png'].map((x) => path.join(F, `garments/${n}/${n}.${x}`)).filter(existsSync);

/** Fits one garment from the fixtures (or a file path) and saves it; returns the fitting stats. */
export async function fit(page: Page, files: string[], opts: { swing?: 'Skirt or coat' | 'Long hair'; shots?: string } = {}): Promise<Record<string, number>> {
  const fitter = page.getByTestId('garment-fitter');
  await fitter.scrollIntoViewIfNeeded();
  const chooser = page.waitForEvent('filechooser');
  await fitter.getByTestId('fit-open').click();
  await (await chooser).setFiles(files);
  await expect(fitter.getByTestId('fit-confirm')).toBeVisible({ timeout: 60_000 });
  if (opts.swing) await fitter.getByRole('radio', { name: opts.swing }).click();
  if (opts.shots) { await settle(page); await ev(page, `${opts.shots}-1-place`, preview(page)); }
  // Long tasks on the page while the worker rigs (the UI must stay responsive).
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__long.push(e.duration); }).observe({ type: 'longtask', buffered: false });
  });
  const t0 = Date.now();
  await fitter.getByTestId('fit-confirm').click();
  // While the worker copies weights, the page keeps answering: the slowest 50 ms timer.
  const responsiveMs = await page.evaluate(async () => {
    let worst = 0;
    const busy = () => /Copying weights/.test(document.querySelector('[data-testid=fit-progress]')?.textContent ?? '');
    for (let i = 0; i < 4000 && (busy() || i < 10); i++) {
      const t = performance.now();
      await new Promise((r) => setTimeout(r, 50));
      if (busy()) worst = Math.max(worst, performance.now() - t - 50);
    }
    return Math.round(worst);
  });
  await expect(fitter.getByTestId('fit-review')).toBeVisible({ timeout: 180_000 });
  const wall = Date.now() - t0;
  const stats: Record<string, number> = await page.evaluate(() => {
    const s = (window as unknown as { __everloomFit: { result: { stats: Record<string, number>; bones: unknown[] }; coveredTriangles: number } }).__everloomFit;
    return { ...s.result.stats, workerPhaseLatencyMs: 0, swingBones: s.result.bones.length, hiddenTriangles: s.coveredTriangles, longestTaskMs: Math.max(0, ...(window as unknown as { __long: number[] }).__long) };
  });
  if (opts.shots) {
    await settle(page);
    await ev(page, `${opts.shots}-2-rigged`, preview(page));
    for (const [pose, name] of [['Squat', 'squat'], ['Arms up', 'arms-up']] as const) {
      await fitter.getByRole('button', { name: pose, exact: true }).click();
      await settle(page);
      await ev(page, `${opts.shots}-3-${name}`, preview(page));
    }
    await fitter.getByRole('button', { name: 'Idle', exact: true }).click();
    await fitter.getByRole('radio', { name: 'All highest' }).click();
    await settle(page);
    await ev(page, `${opts.shots}-4-sliders-max`, preview(page));
    await fitter.getByRole('radio', { name: 'As set' }).click();
  }
  const s0 = Date.now();
  await fitter.getByTestId('fit-save').click();
  // Saving uploads the rigged GLB and the server optimizes it (and makes the phone copy).
  await expect(fitter.getByTestId('fit-open')).toBeVisible({ timeout: 300_000 });
  return { ...stats, workerPhaseLatencyMs: responsiveMs, wallMs: wall, saveMs: Date.now() - s0 };
}

/** An open tube (rings × segments vertices) around the chest, as a 20,000-vertex test garment. */
export function tubeObj(rings: number, segments: number) {
  const lines: string[] = ['o tube_top'];
  for (let r = 0; r < rings; r++) {
    const y = 0.95 + (r / (rings - 1)) * 0.5;
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      lines.push(`v ${(Math.cos(a) * 0.19).toFixed(5)} ${y.toFixed(5)} ${(Math.sin(a) * 0.13).toFixed(5)}`);
    }
  }
  for (let r = 0; r < rings - 1; r++) for (let s = 0; s < segments; s++) {
    const i = r * segments + s + 1, j = r * segments + ((s + 1) % segments) + 1;
    lines.push(`f ${i} ${j} ${j + segments} ${i + segments}`);
  }
  return lines.join('\n');
}
