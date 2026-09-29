import { test as base, expect, type Page } from '@playwright/test';

/** Every test fails on console errors or uncaught exceptions. */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await use(errors);
    expect(errors, 'console errors').toEqual([]);
  },
});
export { expect };

export const MOCK = () => process.env.E2E_MOCK!;
export const BASE = () => process.env.E2E_BASE!;

export async function mockControl(body: object) {
  await fetch(MOCK().replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify(body) });
}

/** API helper that reuses the page's session cookie and CSRF token. */
export async function api(page: Page, method: string, path: string, body?: unknown): Promise<any> {
  if (!page.url().startsWith('http')) await page.goto('/');
  return page.evaluate(
    async ([method, path, body]) => {
      const status = await (await fetch('/api/auth/status')).json();
      const res = await fetch(path as string, {
        method: method as string,
        headers: { 'content-type': 'application/json', 'x-csrf-token': status.csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
    [method, path, body] as const,
  );
}

export async function isPhone(page: Page) {
  return (page.viewportSize()?.width ?? 1280) < 768;
}

export function uid(testInfo: { project: { name: string } }) {
  return `${testInfo.project.name.replace(/[^a-z0-9]/gi, '')}${Math.random().toString(36).slice(2, 6)}`;
}
