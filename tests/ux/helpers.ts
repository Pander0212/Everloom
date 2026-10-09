import { expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

export const MOCK = () => process.env.E2E_MOCK!;

export async function mockControl(body: object) {
  await fetch(MOCK().replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify(body) });
}

export async function api(page: Page, method: string, path: string, body?: unknown): Promise<any> {
  if (!page.url().startsWith('http')) await page.goto('/');
  return page.evaluate(
    async ([method, path, body]) => {
      const status = await (await fetch('/api/auth/status')).json();
      const res = await fetch(path as string, {
        method: method as string,
        headers: body === undefined ? { 'x-csrf-token': status.csrf } : { 'content-type': 'application/json', 'x-csrf-token': status.csrf },
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

/**
 * A small world to measure in: Iris at the Lantern café in Northcrest, a second place to travel to,
 * clothes in the bag, a few turns of story. Returns the chat. In Classic chat there is no game.
 */
export async function seedWorld(page: Page, o: { game?: boolean } = {}) {
  const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Iris Thorne', description: 'Owner of the Lantern café.', first_mes: 'Iris wipes the counter. "What can I get you?"' } });
  const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, greeting: true });
  if (o.game !== false && chat.campaignId) {
    const config = {
      title: 'Rain Town',
      style: 'modern',
      seed: 3,
      character: { name: 'Anala', className: 'Courier', resourceProfile: 'hybrid', level: 1, age: 24, ageStage: 'Adult', customBars: [] },
      appearance: '',
      currency: { name: 'Dollars', symbol: '$', amount: 40 },
      groups: [],
      trackers: [],
      items: [
        { name: 'Rain coat', qty: 1, category: 'clothing', equipped: true },
        { name: 'Summer dress', qty: 1, category: 'clothing' },
        { name: 'Umbrella', qty: 1, category: 'tool' },
      ],
      skills: [],
      quests: [],
      npcs: [],
      location: { world: 'Earth', region: 'Greenmarch', local: 'Northcrest', description: 'A rainy city.', kind: 'town' },
      startDate: { year: 2026, month: 7, day: 1, hour: 10 },
      dayLength: { mode: 'turns', realMinutesPerDay: 20 },
      facts: [],
    };
    await api(page, 'POST', `/api/chats/${chat.id}/newgame`, { config, opening: false });
    const r = await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, {
      chatId: chat.id,
      ops: [{ type: 'location.upsert', name: 'Eastport', level: 'local', kind: 'town', parent: 'Greenmarch', x: 700, y: 300 }],
    });
    expect(r.errors).toEqual([]);
  }
  return { chat, character: ch };
}

/** Counts what a player does: taps (a tap into a text field counts once), scrolls to reach a control, and time. */
export class Probe {
  taps = 0;
  scrolls = 0;
  private t0 = Date.now();
  constructor(private page: Page) {}
  private async reach(l: Locator) {
    await l.waitFor({ state: 'visible' });
    const box = await l.boundingBox();
    const vp = this.page.viewportSize()!;
    if (box && (box.y < 0 || box.y + box.height > vp.height || box.x < 0 || box.x + box.width > vp.width)) this.scrolls++;
  }
  async tap(l: Locator) {
    await this.reach(l);
    this.taps++;
    await l.click();
  }
  async type(l: Locator, text: string) {
    await this.reach(l);
    this.taps++;
    await l.fill(text);
  }
  /** A native select: open and choose. */
  async choose(l: Locator, option: { label: string } | string) {
    await this.reach(l);
    this.taps += 2;
    await l.selectOption(option);
  }
  result() {
    return { taps: this.taps, scrolls: this.scrolls, ms: Date.now() - this.t0 };
  }
}

/** Interactive controls a player can see on screen right now (inside the viewport, not hidden). */
export async function visibleControls(page: Page) {
  return page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const els = [...document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), textarea, select, [role=button], [role=switch], [role=tab], [role=menuitem]')];
    const seen = new Set<HTMLElement>();
    const out: string[] = [];
    for (const el of els) {
      if (seen.has(el) || el.closest('[aria-hidden=true], [inert]')) continue;
      // A control nested in another control counts once.
      if (el.parentElement?.closest('button, a[href], [role=button]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) continue;
      // Covered by something else (a sheet, an overlay)?
      const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), Math.min(vh - 1, Math.max(0, r.top + r.height / 2)));
      if (hit && !el.contains(hit) && !hit.contains(el)) continue;
      seen.add(el);
      out.push((el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40));
    }
    return out;
  });
}

/** Closes notices (toasts) so they don't cover the screen being measured. */
export async function dismissToasts(page: Page) {
  for (let i = 0; i < 5; i++) {
    const b = page.locator('button[aria-label="Dismiss"]');
    if (!(await b.count())) break;
    await b.first().click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

export function saveJson(name: string, data: unknown) {
  mkdirSync('tests/ux/.artifacts/out', { recursive: true });
  writeFileSync(`tests/ux/.artifacts/out/${name}`, JSON.stringify(data, null, 2));
}

export async function shot(page: Page, project: string, name: string) {
  mkdirSync(`tests/ux/.artifacts/out/screens/${project}`, { recursive: true });
  await page.waitForTimeout(400);
  await dismissToasts(page);
  await page.screenshot({ path: `tests/ux/.artifacts/out/screens/${project}/${name}.png` });
}
