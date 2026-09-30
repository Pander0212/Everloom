import { api, expect, mockControl, test } from './fixtures';

test.describe('lorebook AI', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('generate entries, pick some, add them; write one entry with AI and undo', async ({ page, errors }) => {
    await page.goto('/lore');
    const b = await api(page, 'POST', '/api/lorebooks', { name: `Harbor ${Date.now().toString(36)}` });
    await page.goto(`/lore/${b.id}`);
    await page.getByRole('button', { name: 'Generate entries' }).click();
    await page.getByLabel('Topic').fill('The factions of the harbor district');
    await page.getByRole('radio', { name: '3' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Generate', exact: true }).click();
    const proposed = page.getByRole('list', { name: 'Proposed entries' }).getByRole('listitem');
    await expect(proposed).toHaveCount(3);
    await page.getByRole('checkbox', { name: 'Add Night Market' }).click({ force: true });
    await page.getByRole('button', { name: 'Add 2 entries' }).click();
    await expect(page.getByText('2 entries added')).toBeVisible();
    const saved = await api(page, 'GET', `/api/lorebooks/${b.id}`);
    expect(Object.values(saved.book.entries).map((e: any) => e.comment).sort()).toEqual(['Harbor Guild', 'The Ravens']);

    // One entry, written by AI, then undone.
    await page.getByRole('button', { name: /^Entry$/ }).click();
    await page.getByLabel('Title').fill('The Tide Bell');
    await page.getByRole('button', { name: 'Write with AI' }).click();
    await expect(page.getByLabel('Content')).toHaveValue(/rings by itself when a ship is lost/);
    await expect(page.getByLabel('Keys', { exact: true })).toHaveValue('tide bell, bell');
    await page.getByRole('button', { name: 'Undo the AI’s change' }).click();
    await expect(page.getByLabel('Content')).toHaveValue('');
    await page.getByRole('button', { name: 'Write with AI' }).click();
    await expect(page.getByLabel('Content')).toHaveValue(/rings by itself/);
    await page.getByRole('button', { name: 'Save entry' }).click();
    await expect(page.getByRole('button', { name: 'Save entry' })).toHaveCount(0);
    const after = await api(page, 'GET', `/api/lorebooks/${b.id}`);
    expect(Object.values(after.book.entries).some((e: any) => e.comment === 'The Tide Bell' && /rings by itself/.test(e.content))).toBe(true);
    expect(errors).toEqual([]);
  });
});
