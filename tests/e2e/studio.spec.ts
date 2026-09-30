import { api, expect, mockControl, test } from './fixtures';

test.describe('character studio', () => {
  test.beforeEach(async () => {
    await mockControl({ reset: true });
  });

  test('brainstorm, write, refine, rewrite a field, revise a selection, undo, save; then overwrite with a snapshot', async ({ page, errors }) => {
    await page.goto('/characters');
    await page.evaluate(() => localStorage.removeItem('everloom.studio'));
    await page.goto('/characters/studio');
    await page.getByLabel('Describe the character you want').fill('A coastal mystery with a lighthouse');
    await page.getByRole('button', { name: 'Brainstorm', exact: true }).click();
    const ideas = page.getByRole('list', { name: 'Ideas' }).getByRole('button');
    await expect(ideas).toHaveCount(5);
    await ideas.first().click();
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Maren Holt');
    await expect(page.getByRole('textbox', { name: 'First message' })).toHaveValue(/not on my list/);
    await expect(page.getByRole('textbox', { name: 'Tags' })).toHaveValue('mystery, coastal');

    // Whole-card refine.
    await page.getByLabel('Ask for changes').fill('Make her warmer');
    await page.getByRole('button', { name: 'Refine' }).click();
    await expect(page.getByRole('textbox', { name: 'Personality' })).toHaveValue('Dry, patient, openly warm with strangers.');
    await expect(page.getByText('Made her warmer.')).toBeVisible();

    // Select a passage and revise just that.
    const desc = page.getByRole('textbox', { name: 'Description' });
    await desc.evaluate((el: HTMLTextAreaElement) => {
      const s = el.value.indexOf('She logs');
      el.focus();
      el.setSelectionRange(s, el.value.length);
      el.dispatchEvent(new Event('select', { bubbles: true }));
    });
    const bar = page.getByRole('group', { name: 'Revise the selected description text' });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'More vivid' }).click();
    await expect(desc).toHaveValue('Maren keeps the lighthouse on Gull Rock. She records every vessel the sea keeps.');

    // One field, then undo it.
    await page.getByRole('button', { name: 'Write tags with AI' }).click();
    await expect(page.getByRole('textbox', { name: 'Tags' })).toHaveValue('lighthouse, mystery, slow burn');
    await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
    await expect(page.getByRole('textbox', { name: 'Tags' })).toHaveValue('mystery, coastal');

    // Save as a new character.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).toHaveURL(/\/characters\/(?!studio)[\w-]+$/);
    const id = page.url().split('/').pop()!;
    const saved = await api(page, 'GET', `/api/characters/${id}`);
    expect(saved.card).toMatchObject({ name: 'Maren Holt', personality: 'Dry, patient, openly warm with strangers.', tags: ['mystery', 'coastal'] });
    expect(saved.card.description).toContain('She records every vessel');

    // Open it in the studio and overwrite: the old version is kept.
    await page.goto(`/characters/studio?base=${id}`);
    await expect(page.getByRole('button', { name: 'Based on Maren Holt' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('Maren the Keeper');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Overwrite Maren Holt' }).click();
    await page.getByRole('button', { name: 'Overwrite', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/characters/${id}$`));
    expect((await api(page, 'GET', `/api/characters/${id}`)).card.name).toBe('Maren the Keeper');
    const versions = await api(page, 'GET', `/api/characters/${id}/versions`);
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});
