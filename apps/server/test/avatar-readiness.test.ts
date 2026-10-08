import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
const held = vi.hoisted(() => ({ workers: [] as EventEmitter[] }));
vi.mock('node:worker_threads', async () => { const { EventEmitter } = await import('node:events'); return { Worker: class extends EventEmitter {
  constructor() { super(); held.workers.push(this); }
  postMessage() {}
  terminate() { return Promise.resolve(0); }
} }; });
import { createClient, waitFor, type TestClient } from './helpers.js';
import { avatarSettled } from '../src/services/avatars/service.js';
let client: TestClient | null = null;
afterEach(async () => { for (const worker of held.workers) worker.emit('message', { ok: false, error: 'Controlled encoder shutdown' }); await client?.close(); client = null; });
it('opens a valid model while its optional encoder is stalled, and keeps it when encoding fails', async () => {
  client = await createClient();
  const source = readFileSync(path.resolve(import.meta.dirname, '../../../tests/fixtures/avatars/models/mannequin-m.glb'));
  const created = await client.req('POST', '/api/avatars?filename=test.glb', source);
  const id = created.json.id;
  await waitFor(async () => { const detail = (await client!.req('GET', `/api/avatars/${id}`)).json; return detail.status === 'ready' && detail.processingStage && detail.model ? detail : false; }, 15000);
  expect(held.workers).toHaveLength(1);
  held.workers[0].emit('message', { ok: false, error: 'Deliberate encoder failure' });
  await avatarSettled(id);
  const final = (await client.req('GET', `/api/avatars/${id}`)).json;
  expect(final.status).toBe('ready');
  expect(final.info.warnings.some((warning: { code: string }) => warning.code === 'optimization_skipped')).toBe(true);
  expect(final.processingStage).toBeFalsy();
  expect((await client.req('GET', final.model)).raw.subarray(0, 4).toString()).toBe('glTF');
}, 30000);
