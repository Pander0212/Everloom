import { strToU8, zipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { api, expect, isPhone, test } from './fixtures';

const SERAPHINA = path.resolve('tests/fixtures/st/Seraphina.png');

test.describe('character library', () => {
  test('2,000 characters: fast, windowed, filterable', async ({ page, errors }) => {
    await page.goto('/characters');
    const have = (await api(page, 'GET', '/api/characters')).filter((c: any) => c.tags.includes('perf-fixture')).length;
    if (have < 2000) {
      await page.evaluate(async (start) => {
        const status = await (await fetch('/api/auth/status')).json();
        const one = (i: number) =>
          fetch('/api/characters', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': status.csrf },
            body: JSON.stringify({ card: { name: `Perf ${String(i).padStart(4, '0')}`, tags: ['perf-fixture', i % 2 ? 'odd' : 'even', `bucket${i % 20}`], creator: `maker${i % 7}`, description: `Fixture number ${i}. `.repeat(1 + (i % 5)) } }),
          });
        for (let i = start; i < 2000; i += 50) await Promise.all(Array.from({ length: Math.min(50, 2000 - i) }, (_, k) => one(i + k)));
      }, have);
    }
    const t0 = Date.now();
    await page.goto('/characters');
    await expect(page.getByRole('list', { name: 'Characters' })).toBeVisible();
    const openMs = Date.now() - t0;
    expect(openMs).toBeLessThan(5000);
    // Windowed: far fewer cards in the DOM than characters.
    const rendered = Number(await page.getByRole('list', { name: 'Characters' }).getAttribute('data-rendered'));
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(150);
    // Scroll to the end and the last cards are there.
    await page.getByLabel('Search characters').fill('tag:perf-fixture');
    await page.locator('main').evaluate((m) => m.scrollTo(0, m.scrollHeight));
    await expect(page.getByRole('button', { name: /^Perf 0000/ })).toBeVisible();
    // Filters narrow it down quickly.
    const t1 = Date.now();
    await page.getByLabel('Search characters').fill('tag:perf-fixture tag:bucket3 creator:maker1 -tag:even');
    await expect(page.getByText(/^\d+ of \d+/)).toBeVisible();
    expect(Date.now() - t1).toBeLessThan(2000);
    const shown = Number((await page.getByText(/^\d+ of \d+/).textContent())!.split(' ')[0]);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(100);
    expect(errors).toEqual([]);
  });

  test('creator notes render in a sandbox that runs no scripts', async ({ page, errors }) => {
    await page.goto('/characters');
    const name = `Sandbox ${Date.now().toString(36)}`;
    await api(page, 'POST', '/api/characters', { card: { name, creator_notes: `<h3>Hello</h3><script>parent.__pwned = 1</script><img src="x" onerror="parent.__pwned = 2"><a href="javascript:parent.__pwned=3">x</a><p style="color: rgb(200, 100, 50)">styled</p>` } });
    await page.getByLabel('Search characters').fill(name);
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    const frame = page.frameLocator('iframe[title="Creator notes"]');
    await expect(frame.getByText('styled')).toBeVisible();
    const sandbox = await page.locator('iframe[title="Creator notes"]').getAttribute('sandbox');
    expect(sandbox).not.toContain('allow-scripts');
    const src = await page.locator('iframe[title="Creator notes"]').getAttribute('srcdoc');
    expect(src).toContain("script-src 'none'");
    expect(src).not.toMatch(/<script|onerror|javascript:/i);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
    expect(errors.filter((e) => !/Content Security Policy|Blocked script/i.test(e))).toEqual([]);
    errors.length = 0;
  });

  test('select several, delete, undo; import a bundle with a preview', async ({ page, errors }) => {
    await page.goto('/characters');
    const tag = `batch${Date.now().toString(36)}`;
    for (const n of ['Alpha', 'Beta']) await api(page, 'POST', '/api/characters', { card: { name: `${n} ${tag}`, tags: [tag] } });
    await page.reload();
    await page.getByLabel('Search characters').fill(`tag:${tag}`);
    await expect(page.getByText(/^2 (of|characters)/)).toBeVisible();
    await page.getByRole('button', { name: 'Library tools' }).click();
    await page.getByRole('menuitem', { name: 'Select' }).click();
    await page.getByRole('button', { name: new RegExp(`^Alpha ${tag}`) }).click();
    await page.getByRole('button', { name: new RegExp(`^Beta ${tag}`) }).click();
    await expect(page.getByText('2 selected')).toBeVisible();
    await page.getByRole('button', { name: 'Delete selected' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('2 characters deleted')).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`^Alpha ${tag}`) })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText(/^2 (of|characters)/)).toBeVisible();

    // A plain SillyTavern zip: card + chat folder.
    const png = readFileSync(SERAPHINA);
    const jsonl = [JSON.stringify({ user_name: 'You', character_name: 'Seraphina', create_date: '2024-01-01' }), JSON.stringify({ name: 'You', is_user: true, mes: 'Where am I?', send_date: '2024-01-01' })].join('\n');
    const zip = Buffer.from(zipSync({ 'Seraphina.png': new Uint8Array(png), 'chats/Seraphina/one.jsonl': strToU8(jsonl) }));
    await page.locator('input[type=file]').first().setInputFiles({ name: 'bundle.zip', mimeType: 'application/zip', buffer: zip });
    await expect(page.getByRole('dialog').getByText('Seraphina')).toBeVisible();
    // Already imported by an earlier run: identical cards default to Skip.
    const keepBoth = page.getByRole('dialog').getByText('Keep both', { exact: true });
    if (await keepBoth.count()) await keepBoth.click();
    await page.getByRole('button', { name: /^Import \d/ }).click();
    await expect(page.getByText('Bundle imported')).toBeVisible();
    if (await isPhone(page)) expect(errors).toEqual([]);
  });

  test('what should I play: three picks with reasons; a pick opens the character', async ({ page, errors }) => {
    const name = `Wren ${Date.now().toString(36)}`;
    await page.goto('/characters');
    await api(page, 'POST', '/api/characters', { card: { name, tags: ['spooky'], description: 'A ghost haunting a lonely lighthouse.' } });
    await page.getByRole('button', { name: 'Library tools' }).click();
    await page.getByRole('menuitem', { name: 'What should I play?' }).click();
    await page.getByLabel('Mood').fill('a haunting ghost story');
    await page.getByRole('button', { name: 'Pick', exact: true }).click();
    const picks = page.getByRole('list', { name: 'Picks' }).getByRole('button');
    await expect(picks.first()).toBeVisible();
    expect(await picks.count()).toBeLessThanOrEqual(3);
    await expect(picks.first()).toContainText(name);
    await expect(picks.first()).toContainText('Fits:');
    await picks.first().click();
    await expect(page.getByRole('dialog').getByText(name).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});
