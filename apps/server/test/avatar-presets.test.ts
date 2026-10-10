import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createClient, type TestClient } from './helpers.js';
import { avatarSettled } from '../src/services/avatars/service.js';
let client: TestClient | null = null;
afterEach(async () => { await client?.close(); client = null; });
it('round-trips protected rig and character presets and refuses adult or incompatible presets', async () => {
  client = await createClient();
  const bytes = readFileSync(path.resolve(import.meta.dirname, '../../../tests/fixtures/avatars/models/mannequin-m.glb'));
  const created = await client.req('POST', '/api/avatars?filename=preset.glb', bytes); const id = created.json.id; await avatarSettled(id);
  const detail = (await client.req('GET', `/api/avatars/${id}`)).json;
  for (const kind of ['rig', 'character']) {
    const exported = await client.req('POST', `/api/avatars/${id}/preset-export`, { kind, config: detail.config }, { 'x-export-password': 'export pass 123' });
    expect(exported.status).toBe(200); expect(exported.headers['content-disposition']).toContain('.evlt');
    expect((await client.req('POST', `/api/avatars/${id}/preset-import`, exported.raw)).json.code).toBe('password_required');
    const imported = await client.req('POST', `/api/avatars/${id}/preset-import`, exported.raw, { 'x-import-password': 'export pass 123' });
    expect(imported.status).toBe(200); expect(imported.json.version).toBe(1);
  }
  const incompatible = { format: 'everloom-character-preset', version: 1, family: 'different', config: detail.config };
  expect((await client.req('POST', `/api/avatars/${id}/preset-import`, incompatible)).status).toBe(400);
  const adult = { ...detail.config, content: { adult: true, age: 20, confirmedAdult: false, description: '' }, morphs: { sliders: [{ id: 'anatomy', label: 'Anatomy', group: 'other', plus: ['anatomy'], minus: [], adult: true }], values: { anatomy: 0.5 }, base: null } };
  // An explicit preset exports without any setting; a minor's never does (the minor guard).
  expect((await client.req('POST', `/api/avatars/${id}/preset-export`, { kind: 'character', config: adult })).status).toBe(200);
  expect((await client.req('POST', `/api/avatars/${id}/preset-export`, { kind: 'character', config: { ...adult, content: { ...adult.content, age: 16 } } })).status).toBe(400);
}, 30000);
