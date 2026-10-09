import { readFileSync, mkdirSync, copyFileSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import path from 'node:path';
import { api, expect, test } from './fixtures';

const models = ['cesium-man.glb', 'rigged-figure.glb', 'robot-expressive.glb', 'robot-vrm0.vrm', 'seed.vrm', 'twist-vrm1.vrm', 'knight.fbx', 'robot.pmx'];
for (const model of models) for (const flow of ['picker', 'drop'] as const) {
  test(`${model}: ${flow}, editor, body controls and stage emote`, async ({ page, errors }, info) => {
    const file = path.resolve('tests/fixtures/models', model);
    await page.goto('/characters/avatars');
    if (flow === 'picker') {
      const chooser = page.waitForEvent('filechooser');
      await page.getByTestId('avatar-import').click();
      await (await chooser).setFiles(file);
    } else {
      const bytes = readFileSync(file).toString('base64');
      const transfer = await page.evaluateHandle(({ bytes, name }) => { const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(atob(bytes), character => character.charCodeAt(0))], name)); return data; }, { bytes, name: model });
      await page.getByTestId('avatar-drop').dispatchEvent('drop', { dataTransfer: transfer });
      await transfer.dispose();
    }
    await expect(page).toHaveURL(/\/characters\/avatars\/av_/, { timeout: 120_000 });
    await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready', { timeout: 120_000 });
    await page.getByLabel('Emote', { exact: true }).selectOption('wave');
    await page.getByRole('radio', { name: 'Right hand up' }).click();
    await page.screenshot({ path: info.outputPath('editor-wave.png') });
    const evidence = path.resolve('docs/3d-fix-evidence', `${info.project.name}-${model}-${flow}`);
    mkdirSync(evidence, { recursive: true });
    copyFileSync(info.outputPath('editor-wave.png'), path.join(evidence, 'editor-wave.png'));
    await page.getByRole('tab', { name: 'Body', exact: true }).click();
    if (model === 'knight.fbx') await expect.poll(async () => await page.getByLabel('Butt size value').isVisible() || await page.getByText('This model has too many vertices for live body adjusters.', { exact: false }).isVisible()).toBe(true);
    else await expect(page.getByLabel('Butt size value')).toBeVisible();
    const avatarId = page.url().split('/').pop()!;
    const who = `Fixture ${model} ${flow} ${info.project.name}`;
    const character = await api(page, 'POST', '/api/characters', { card: { name: who, first_mes: 'Hello.' } });
    await api(page, 'PATCH', `/api/characters/${character.id}`, { game: { avatar3d: avatarId, display: 'auto' } });
    const chat = await api(page, 'POST', '/api/chats', { characterId: character.id });
    // Match the app's client routing. Hard navigation interrupts the live SSE
    // request and Firefox emits a browser-generated cancellation diagnostic.
    await page.evaluate(url => { history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')); }, `/chat/${chat.id}`);
    await page.getByRole('button', { name: 'Switch to stage view' }).click();
    await expect(page.getByTestId('stage-3d')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('stage-3d')).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    const result = await api(page, 'POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'avatar.emote', who, emote: 'wave' }] });
    expect(result.errors).toEqual([]);
    await expect(page.getByTestId('stage-3d')).toHaveAttribute('data-emote', /:wave$/, { timeout: 30_000 });
    // Capture the raised arm after the clip has advanced, rather than its first idle frame.
    await page.waitForTimeout(900);
    await expect.poll(async () => Object.values((await api(page, 'GET', `/api/campaigns/${chat.campaignId}`)).state.stage.avatars).some(value => (value as { emote?: { id: string } }).emote?.id === 'wave')).toBe(true);
    await page.screenshot({ path: info.outputPath('stage-wave.png') });
    copyFileSync(info.outputPath('stage-wave.png'), path.join(evidence, 'stage-wave.png'));
    await info.attach('stage', { path: info.outputPath('stage-wave.png'), contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
}

test('unsupported and broken files explain the correction', async ({ page }) => {
  await page.goto('/characters/avatars');
  for (const [name, buffer, message] of [
    ['unexported.blend', Buffer.from('BLENDER'), /has to be exported/],
    ['project.vroid', Buffer.from('PK'), /export a .vrm/],
    ['broken.glb', Buffer.from('not a model'.repeat(8)), /glTF|GLB|magic|model/i],
  ] as const) {
    const chooser = page.waitForEvent('filechooser'); await page.getByTestId('avatar-import').click();
    await (await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer });
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('button', { name: 'Copy details' })).toBeVisible();
  }
});

test('oversized model is refused before upload', async ({ page }, info) => {
  await page.goto('/characters/avatars');
  const file = info.outputPath('too-large.glb');
  const descriptor = openSync(file, 'w');
  try { ftruncateSync(descriptor, 200 * 1024 * 1024 + 1); } finally { closeSync(descriptor); }
  let uploads = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/avatars\/upload/.test(request.url())) uploads++; });
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('avatar-import').click(); await (await chooser).setFiles(file);
  await expect(page.getByRole('alert')).toContainText('larger than 200 MB');
  await expect(page.getByRole('button', { name: 'Copy details' })).toBeVisible();
  expect(uploads).toBe(0);
  const evidence = path.resolve('docs/3d-fix-evidence', info.project.name); mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, 'oversized-import.png') });
});

test('import self-test renders and plays its emote', async ({ page, errors }, info) => {
  await page.goto('/settings/3d');
  await page.getByRole('button', { name: 'Open import diagnostics' }).click();
  await page.getByTestId('import-self-test').click();
  await expect(page.getByTestId('import-diagnostics').getByRole('status')).toContainText('Passed: upload', { timeout: 180_000 });
  await expect(page.getByTestId('avatar-preview')).toHaveAttribute('data-state', 'ready');
  expect(errors).toEqual([]);
  const evidence = path.resolve('docs/3d-fix-evidence', info.project.name); mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, 'diagnostics-pass.png') });
});

test('import self-test reports a deliberately missing fixture', async ({ page }, info) => {
  const diagnostics: string[] = [];
  page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
  await page.route('**/avatar/mannequin.glb', route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Deliberately removed diagnostic fixture' }));
  await page.goto('/settings/3d');
  await page.getByRole('button', { name: 'Open import diagnostics' }).click();
  await page.getByTestId('import-self-test').click();
  await expect(page.getByRole('alert')).toContainText('Bundled fixture download: HTTP 404');
  await expect(page.getByRole('button', { name: 'Copy details' })).toBeVisible();
  await expect(page.getByTestId('import-diagnostics').getByRole('status')).toHaveCount(0);
  const evidence = path.resolve('docs/3d-fix-evidence', info.project.name); mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, 'diagnostics-missing-fixture.png') });
  await info.attach('expected-network-failure', { body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json' });
});
