import { api, expect, mockControl, test } from './fixtures';
import type { Page } from '@playwright/test';

async function openTool(page: Page, name: string) {
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByLabel('Search tools, settings and the story').fill(name);
  await page.getByRole('button', { name, exact: true }).click();
}

const state = async (page: Page, campaignId: string) => (await api(page, 'GET', `/api/campaigns/${campaignId}`)).state;
const ops = (page: Page, chat: any, list: object[]) => api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: list });

async function setup(page: Page) {
  const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Iris Vale' } });
  const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, greeting: false });
  const config = {
    title: 'Ember Road',
    style: 'fantasy',
    seed: 11,
    character: { name: 'Anala', className: '', resourceProfile: 'hybrid', level: 1, age: 24, ageStage: 'Adult', customBars: [] },
    appearance: '',
    currency: { name: 'Gold', symbol: 'g', amount: 20 },
    groups: [],
    trackers: [],
    items: [],
    skills: [],
    quests: [],
    npcs: [],
    location: { world: 'Aerth', region: 'Vale', local: 'Ashford', description: '' },
    startDate: { year: 2026, month: 7, day: 1, hour: 10 },
    dayLength: { mode: 'turns', realMinutesPerDay: 20 },
    facts: [],
  };
  await api(page, 'POST', `/api/chats/${chat.id}/newgame`, { config, opening: false });
  const r = await ops(page, chat, [
    { type: 'party.meta', maxActive: 1 },
    { type: 'party.add', name: 'Iris' },
    { type: 'party.add', name: 'Wren' },
    { type: 'skillnode.add', name: 'Ember', kind: 'attack', element: 'fire', costType: 'none', cost: 0, power: 12, level: 1 },
  ]);
  expect(r.errors).toEqual([]);
  return chat;
}

test.describe('party and battle', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('formation, tactics, level-up, skills → battle with a reserve swap, a break and a summary', async ({ page, errors }) => {
    const chat = await setup(page);
    await page.goto(`/chat/${chat.id}`);

    // Formation: one active, one in reserve; move Iris to the back row with heal-first tactics.
    await openTool(page, 'Party');
    const party = page.getByRole('dialog', { name: 'Party' });
    await expect(party.locator('section[aria-label="Active party"]')).toContainText('Iris');
    await expect(party.locator('section[aria-label="Reserve"]')).toContainText('Wren');
    await party.getByRole('button', { name: /^Iris/ }).click();
    const iris = page.getByRole('dialog', { name: 'Iris' });
    await iris.getByRole('radiogroup', { name: 'Row' }).getByRole('radio', { name: 'Back' }).click();
    await iris.getByRole('tab', { name: 'Tactics' }).click();
    await iris.getByRole('radio', { name: /Heal first/ }).click();
    await expect.poll(async () => (await state(page, chat.campaignId)).party.pm_iris).toMatchObject({ row: 'back', tactics: { preset: 'heal-first' } });
    await iris.getByRole('button', { name: 'Close', exact: true }).click();
    await party.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Level-up moment → spend a stat point and learn a skill.
    await ops(page, chat, [{ type: 'xp.add', amount: 100 }]);
    const moment = page.getByRole('dialog', { name: 'Anala reached level 2' });
    await expect(moment).toBeVisible();
    await expect(moment).toContainText('3 stat points and 1 skill point to spend.');
    await moment.getByRole('button', { name: 'Spend points' }).click();
    const me = page.getByRole('dialog', { name: 'Anala' });
    await me.getByRole('button', { name: 'Raise Attack' }).click();
    await expect.poll(async () => (await state(page, chat.campaignId)).player.statPoints).toBe(2);
    await me.getByRole('button', { name: 'Learn Ember' }).click();
    await expect.poll(async () => Object.values((await state(page, chat.campaignId)).player.skills).map((k: any) => k.name)).toContain('Ember');
    await me.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog', { name: 'Party' }).getByRole('button', { name: 'Close', exact: true }).click();

    // Battle: an enemy weak to fire. Intents show; swap Wren in; break it with Ember; win.
    await ops(page, chat, [{ type: 'battle.start', enemies: [{ name: 'Bramble Wolf', level: 1, hp: 90, atk: 1, spd: 1, weaknesses: ['fire'] }] }]);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByLabel('Search tools, settings and the story').fill('Battle');
    await page.getByRole('button', { name: /^Battle/ }).first().click();
    await expect(page.getByText(/^Next: (Attack|Heavy strike) →/)).toBeVisible();
    await page.getByRole('button', { name: 'Swap in Wren' }).click();
    await expect(page.getByRole('list', { name: 'Battle log' })).toContainText('Wren swaps in for Iris.');
    await page.getByLabel('Skill').selectOption({ label: 'Ember' });
    for (let i = 0; i < 20; i++) {
      if (await page.getByRole('button', { name: 'Close battle' }).count()) break;
      const skill = page.getByRole('button', { name: 'Skill', exact: true });
      await expect(skill).toBeEnabled();
      await skill.click();
      await page.waitForTimeout(150);
    }
    await expect(page.getByRole('button', { name: 'Close battle' })).toBeVisible();
    const s = await state(page, chat.campaignId);
    expect(s.battle.status).toBe('won');
    expect(s.battle.log.some((l: any) => l.text === 'Bramble Wolf is broken!')).toBe(true);
    const summary = page.locator('section[aria-label="Battle summary"]');
    await expect(summary).toContainText('Damage dealt');
    await expect(summary).toContainText('Breaks');
    await page.getByRole('button', { name: 'Close battle' }).click();
    await expect.poll(async () => (await state(page, chat.campaignId)).battle).toBeNull();
    // Results persist: Wren (who fought) shares the XP; Iris sat it out in reserve.
    const after = await state(page, chat.campaignId);
    expect(after.party.pm_wren.xp).toBeGreaterThan(0);
    expect(after.party.pm_iris.xp ?? 0).toBe(0);
    expect(errors).toEqual([]);
  });
});
