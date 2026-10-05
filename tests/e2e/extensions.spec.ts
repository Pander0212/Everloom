import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { api, expect, test } from './fixtures';

// The example extensions, installed the way a player would; and a Tavern Helper style card.
const EX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../examples/extensions');
function zipOf(name: string): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (const f of readdirSync(path.join(EX, name))) files[`${name}-main/${f}`] = new Uint8Array(readFileSync(path.join(EX, name, f)));
  return Buffer.from(zipSync(files));
}

test.describe('extensions', () => {
  test.afterEach(async ({ page }) => {
    await page.goto('/settings/about');
    for (const e of (await api(page, 'GET', '/api/extensions')).items) await api(page, 'DELETE', `/api/extensions/${e.id}`);
  });

  test('install the dice roller from a zip, use its panel and its command', async ({ page, errors }) => {
    await page.goto('/settings/extensions');
    await page.locator('input[type=file]').first().setInputFiles({ name: 'dice-roller.zip', mimeType: 'application/zip', buffer: zipOf('dice-roller') });
    const sheet = page.getByRole('dialog', { name: 'Install Dice roller?' });
    await expect(sheet.getByText('Show panels and buttons', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Write in this chat', { exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: 'Install' }).click();
    await expect(page.getByRole('list', { name: 'Installed extensions' })).toContainText('Dice roller');

    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Dicey Dot', first_mes: 'Roll for it.' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, features: 'classic' });
    await page.goto(`/chat/${chat.id}`);
    // The panel, from the command menu.
    await page.getByRole('button', { name: 'Actions and tools' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Dice roller', exact: true }).click();
    const panel = page.frameLocator('iframe[title="Dice roller"]');
    await panel.getByRole('button', { name: '4d6kh3' }).click();
    await expect(panel.locator('#total')).toHaveText(/^\d+$/);
    await panel.getByRole('button', { name: 'Add to the chat' }).click();
    await expect(page.getByText(/4d6kh3 = \d+/).first()).toBeVisible();
    // Keys pressed inside the sandbox stay there, so the panel closes with its button.
    await page.getByRole('dialog', { name: 'Dice roller' }).getByRole('button', { name: 'Close' }).click();
    // Its slash command (registered by its background frame) and its composer button.
    const box = page.getByLabel('Message', { exact: true });
    await box.fill('/dice 2d10!+3');
    await box.press('Control+Enter');
    await expect(page.getByText(/2d10!\+3 = \d+/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Roll d20' }).click();
    await expect(page.getByText(/d20 = \d+/)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('town reputation: a custom game op that rolls back with its message', async ({ page, errors }) => {
    await page.goto('/settings/about');
    const prev = await page.evaluate(async (b64) => {
      const status = await (await fetch('/api/auth/status')).json();
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const r = await fetch('/api/extensions/preview', { method: 'POST', headers: { 'content-type': 'application/zip', 'x-csrf-token': status.csrf }, body: bytes });
      return r.json();
    }, zipOf('town-reputation').toString('base64'));
    await api(page, 'POST', '/api/extensions/install', { token: prev.token });
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Mayor Mel', first_mes: 'Welcome to Eastport.' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, features: 'full' });
    await page.goto(`/chat/${chat.id}`);
    const box = page.getByLabel('Message', { exact: true });
    await box.fill('/rep Eastport +12');
    await box.press('Control+Enter');
    await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.ext?.['town-reputation']?.towns?.Eastport, { timeout: 10_000 }).toBe(12);
    // The prompt carries it (through the macro the extension keeps current).
    await expect.poll(async () => JSON.stringify((await api(page, 'POST', `/api/chats/${chat.id}/prompt/preview`, {})).parts)).toContain('Eastport: known (12)');
    // Deleting the message it was anchored to rolls it back.
    const msgs = await api(page, 'GET', `/api/chats/${chat.id}/messages`);
    await api(page, 'DELETE', `/api/messages/${msgs[msgs.length - 1].id}`);
    await expect.poll(async () => (await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.ext?.['town-reputation']?.towns?.Eastport ?? null).toBeNull();
    expect(errors).toEqual([]);
  });

  test('a Tavern Helper style card works through the compatibility layer', async ({ page, errors }) => {
    // Written for this test in the style of public cards: variables, events, jQuery-ish DOM, toastr.
    const html = `\`\`\`html
<div class="ev-card"><span id="hp">…</span> <button id="hurt" class="ev-btn">Ouch</button></div>
<script>
  const show = () => { const v = getVariables({ type: 'chat' }); $('#hp').text('HP ' + _.get(v, 'stats.hp', '?')).addClass('ev-chip'); };
  eventOn(tavern_events.MESSAGE_RECEIVED, show);
  $('#hurt').on('click', () => {
    updateVariablesWith((v) => _.set(v, 'stats.hp', _.get(v, 'stats.hp', 10) - 1), { type: 'chat' });
    show();
    toastr.info('Hit for 1');
  });
  insertOrAssignVariables({ stats: { hp: 10 } }, { type: 'chat' });
  show();
</script>
\`\`\``;
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Helper Hale', first_mes: html, extensions: { everloom_scripts: { messagePermissions: ['variables', 'ui.panel'] } } } });
    const r = await api(page, 'GET', `/api/scripts/review?kind=character&id=${ch.id}`);
    await api(page, 'POST', '/api/scripts/review', { kind: 'character', id: ch.id, approve: r.items.map((i: any) => i.key) });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, features: 'classic' });
    await page.goto(`/chat/${chat.id}`);
    const frame = page.frameLocator('iframe[title="Interactive content from Helper Hale"]');
    await expect(frame.locator('#hp')).toHaveText('HP 10', { timeout: 15_000 });
    await expect(frame.locator('#hp')).toHaveClass(/ev-chip/);
    await frame.locator('#hurt').click();
    await expect(frame.locator('#hp')).toHaveText('HP 9');
    await expect(page.getByText('Hit for 1')).toBeVisible();
    await expect.poll(async () => (await api(page, 'GET', `/api/chats/${chat.id}`)).metadata.vars.stats?.hp).toBe(9);
    expect(errors).toEqual([]);
  });
});
