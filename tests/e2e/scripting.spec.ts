import { api, expect, mockControl, test } from './fixtures';

// Interactive messages, the review flow, the sandbox's isolation, slash commands, quick replies,
// script buttons and the loop guard.
const PROBE = `\`\`\`html
<div class="ev-card"><p id="out">waiting</p><button class="ev-btn primary" id="go">Count</button></div>
<script>
  const out = document.getElementById('out');
  const tries = [];
  try { document.cookie; tries.push('cookie'); } catch (e) {}
  try { localStorage.length; tries.push('storage'); } catch (e) {}
  try { parent.document.title; tries.push('parent'); } catch (e) {}
  fetch('/api/settings').then(() => tries.push('fetch')).catch(() => {}).finally(() => {
    out.textContent = tries.length ? 'leaked: ' + tries.join(',') : 'sealed';
  });
  let n = 0;
  document.getElementById('go').addEventListener('click', async () => {
    n++;
    await everloom.vars.set('clicks', n);
    out.textContent = 'clicked ' + n;
  });
</script>
\`\`\``;

test.describe('scripting', () => {
  test.afterEach(async ({ page }) => {
    // Leave the chat first, so turning scripts back on doesn't start its frames again.
    await page.goto('/settings/about');
    await api(page, 'PATCH', '/api/settings', { scripts: { enabled: true, messageJs: 'approved' } });
    for (const kind of ['script', 'qr']) for (const it of await api(page, 'GET', `/api/scripts/library?kind=${kind}`)) await api(page, 'DELETE', `/api/scripts/library/${it.id}?kind=${kind}`);
  });

  test('interactive message: off until reviewed, then runs sealed with only its permissions', async ({ page, errors }) => {
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Widget Wren', first_mes: `Here is a counter.\n${PROBE}`, creator: 'Tester', extensions: { everloom_scripts: { messagePermissions: ['variables'] } } } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, features: 'classic' });
    await page.goto(`/chat/${chat.id}`);
    await expect(page.getByText('Here is a counter.')).toBeVisible();
    // Not approved: the HTML shows, its script doesn't run, and there's a way to review it.
    await expect(page.getByText('has scripts that are off')).toBeVisible();
    await page.getByRole('button', { name: 'Scripts off · Review' }).click();
    const sheet = page.getByRole('dialog', { name: /Widget Wren contains scripts/ });
    await expect(sheet.getByText('Variables', { exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: 'Show the code' }).click();
    await expect(sheet.locator('.ev-code')).toContainText("document.getElementById('go')");
    await sheet.getByRole('button', { name: 'Enable', exact: true }).click();
    await expect(sheet).toBeHidden();
    // Approved: it runs in its frame, can't reach anything, and its one permission works.
    const frame = page.frameLocator('iframe[title="Interactive content from Widget Wren"]');
    await expect(frame.locator('#out')).toHaveText('sealed', { timeout: 15_000 });
    await expect(frame.locator('#out')).toHaveCount(1);
    await frame.locator('#go').click();
    await expect(frame.locator('#out')).toHaveText('clicked 1');
    await expect.poll(async () => (await api(page, 'GET', `/api/chats/${chat.id}`)).metadata.vars.clicks).toBe(1);
    // Show as code, and back.
    await page.getByRole('button', { name: 'Show as code' }).click();
    await expect(page.locator('.ev-interactive .ev-code')).toContainText('ev-card');
    await page.getByRole('button', { name: 'Show as content' }).click();
    // The kill switch: the frame goes back to inert HTML.
    await api(page, 'PATCH', '/api/settings', { scripts: { enabled: false } });
    await page.reload();
    await expect(page.getByText('Here is a counter.')).toBeVisible();
    await expect(page.locator('iframe[title="Interactive content from Widget Wren"]')).toHaveCount(0);
    // The probe's fetch is refused by the frame's policy: that refusal is the expected console noise.
    expect(errors.filter((e) => !/Content Security Policy/.test(e))).toEqual([]);
    errors.length = 0;
  });

  test('slash commands, quick replies, a script button, and the loop guard', async ({ page, errors }) => {
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Command Cass', first_mes: 'Ready.' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, features: 'classic' });
    await api(page, 'POST', '/api/scripts/library', { kind: 'qr', data: { id: 'q1', name: 'Mine', items: [{ id: 'a', label: 'Note it', message: '/sys The bell rings.' }] } });
    await api(page, 'POST', '/api/scripts/library', {
      kind: 'script',
      data: {
        id: 'hello',
        name: 'Greeter',
        code: "everloom.on('button', async (e) => { if (e.button === 'b0') await everloom.ui.toast('Hello from a script'); if (e.button === 'b1') { while (true) {} } });",
        permissions: ['ui.panel'],
        triggers: ['chatOpen', 'button'],
        buttons: [{ id: 'b0', label: 'Wave' }, { id: 'b1', label: 'Spin' }],
      },
    });
    await page.goto(`/chat/${chat.id}`);
    const box = page.getByLabel('Message', { exact: true });
    // Autocomplete, then a command with a pipe.
    await box.fill('/ro');
    await expect(page.getByRole('listbox', { name: 'Commands' })).toContainText('/roll');
    await box.fill('/setvar key=mood bright | /echo mood is {{pipe}}');
    await box.press('Control+Enter');
    await expect(page.getByText('mood is bright')).toBeVisible();
    await expect.poll(async () => (await api(page, 'GET', `/api/chats/${chat.id}`)).metadata.vars.mood).toBe('bright');
    // A quick reply that runs a command.
    await page.getByRole('toolbar', { name: 'Quick replies and script buttons' }).getByRole('button', { name: 'Note it' }).click();
    await expect(page.getByText('The bell rings.')).toBeVisible();
    // The script's button (its frame is hidden; it answers through the bridge).
    await page.getByRole('button', { name: 'Wave' }).click();
    await expect(page.getByText('Hello from a script')).toBeVisible({ timeout: 10_000 });
    // An endless loop is stopped and reported; the app stays responsive.
    await page.getByRole('button', { name: 'Spin' }).click();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByLabel('Search tools, settings and the story').fill('Scripts in this chat');
    await page.getByRole('button', { name: 'Scripts in this chat', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Scripts' });
    await expect(sheet.getByRole('list', { name: 'Console of Greeter' })).toContainText(/Stopped/, { timeout: 15_000 });
    // The stopped loop's own error is reported by the frame: expected.
    expect(errors.filter((e) => !/Stopped: a loop ran/.test(e))).toEqual([]);
    errors.length = 0;
  });

  test('a script without a permission is refused, and ?safe=1 turns everything off', async ({ page, errors }) => {
    const probe = "```html\n<p id=\"r\">…</p>\n<script>\neverloom.chat.messages().then(() => r('read chat'), (e) => r('refused: ' + e.message));\nfunction r(t) { document.getElementById('r').textContent = t; }\n</script>\n```";
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Nosy Nell', first_mes: probe, extensions: { everloom_scripts: { messagePermissions: ['variables'] } } } });
    const r = await api(page, 'GET', `/api/scripts/review?kind=character&id=${ch.id}`);
    await api(page, 'POST', '/api/scripts/review', { kind: 'character', id: ch.id, approve: r.items.map((i: any) => i.key) });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, features: 'classic' });
    await page.goto(`/chat/${chat.id}`);
    await expect(page.frameLocator('iframe[title="Interactive content from Nosy Nell"]').locator('#r')).toHaveText(/^refused: .*Read this chat/, { timeout: 15_000 });
    // Safe mode: no frames at all, and the scripts sheet says why.
    await page.goto(`/chat/${chat.id}?safe=1`);
    await expect(page.locator('.ev-message-text')).toBeVisible();
    await expect(page.locator('iframe[title="Interactive content from Nosy Nell"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByLabel('Search tools, settings and the story').fill('Scripts in this chat');
    await page.getByRole('button', { name: 'Scripts in this chat', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Scripts' })).toContainText('Safe mode');
    await page.goto(`/chat/${chat.id}?safe=0`);
    expect(errors.filter((e) => !/Read this chat/.test(e))).toEqual([]);
    errors.length = 0;
  });

  test('a lorebook script runs when its entry activates', async ({ page, errors }) => {
    const book = await api(page, 'POST', '/api/lorebooks', {
      name: 'Lantern lore',
      scope: 'global',
      book: {
        entries: { 0: { uid: 0, key: ['lantern'], content: 'The lantern never goes out.', comment: 'Lantern' } },
        extensions: { everloom_scripts: { scripts: [{ id: 'lit', name: 'Lantern watcher', code: "everloom.on('entryActivated', (e) => everloom.ui.toast('The lantern stirs (' + e.entries.map((x) => x.uid).join(',') + ')'));", permissions: ['ui.panel'], triggers: ['entryActivated'], entries: ['0'] }] } },
      },
    });
    const r = await api(page, 'GET', `/api/scripts/review?kind=lorebook&id=${book.id}`);
    expect(r.items).toHaveLength(1);
    await api(page, 'POST', '/api/scripts/review', { kind: 'lorebook', id: book.id, approve: [r.items[0].key] });
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Keeper Kai', first_mes: 'The room is dark.' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, features: 'classic' });
    await mockControl({ story: 'Kai nods.' });
    await page.goto(`/chat/${chat.id}`);
    await page.getByLabel('Message', { exact: true }).fill('I light the lantern.');
    await page.getByLabel('Message', { exact: true }).press('Control+Enter');
    await expect(page.getByText('The lantern stirs (0)')).toBeVisible({ timeout: 15_000 });
    await api(page, 'DELETE', `/api/lorebooks/${book.id}`);
    await mockControl({ story: null });
    expect(errors).toEqual([]);
  });

  test('50 interactive messages: frames mount near the screen only', async ({ page, errors }) => {
    const card = (n: number) => "```html\n<div class=\"ev-card\">Card " + n + "</div>\n```";
    const ch = await api(page, 'POST', '/api/characters', { card: { name: 'Many Mo', first_mes: card(0) } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: ch.id, features: 'classic' });
    for (let i = 1; i < 50; i++) await api(page, 'POST', `/api/chats/${chat.id}/messages`, { role: 'assistant', name: 'Many Mo', text: card(i), characterId: ch.id });
    await page.goto(`/chat/${chat.id}`);
    await expect.poll(async () => page.locator('.ev-interactive iframe').count()).toBeGreaterThan(0);
    const mounted = await page.locator('.ev-interactive iframe').count();
    expect(mounted).toBeLessThan(25);
    // Scrolling to the top mounts those and lets the far ones go.
    await page.locator('.ev-interactive').first().scrollIntoViewIfNeeded();
    await expect.poll(async () => page.locator('.ev-interactive').first().locator('iframe').count()).toBe(1);
    expect(await page.locator('.ev-interactive iframe').count()).toBeLessThan(25);
    expect(errors).toEqual([]);
  });
});
