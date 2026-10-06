import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { blenderJobs, findBlender, runBlenderJob } from '../src/services/blender.js';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

describe('Blender worker time limit', () => {
  it('kills a stuck job and reports it', async () => {
    // A stand-in "Blender": answers the start-up probe, then hangs on any real job.
    const dir = mkdtempSync(path.join(os.tmpdir(), 'everloom-fake-blender-'));
    const exe = path.join(dir, 'blender');
    writeFileSync(exe, '#!/bin/bash\njob="${@: -1}"\nif grep -q \'"op": *"info"\' "$job"; then echo \'{"ok":true,"version":"4.2.0","mmd":false}\' > "$(dirname "$job")/result.json"; exit 0; fi\nsleep 60\n');
    chmodSync(exe, 0o755);
    const prev = process.env.EVERLOOM_BLENDER;
    process.env.EVERLOOM_BLENDER = exe;
    try {
      c = await createClient();
      const ctx = c.built.ctx;
      const info = await findBlender(ctx, 'owner-x', { refresh: true });
      if (info.source !== 'env') return; // a Blender path set elsewhere wins; nothing to test here
      const started = Date.now();
      await expect(runBlenderJob(ctx, 'owner-x', { op: 'convert', files: { 'a.obj': Buffer.from('o x') }, input: 'a.obj', output: 'out.glb', timeoutMs: 1500 })).rejects.toThrow(/too long/);
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(blenderJobs('owner-x')[0]).toMatchObject({ op: 'convert', state: 'failed', error: expect.stringMatching(/too long/) });
    } finally {
      if (prev === undefined) delete process.env.EVERLOOM_BLENDER;
      else process.env.EVERLOOM_BLENDER = prev;
      if (c) await findBlender(c.built.ctx, 'owner-x', { refresh: true });
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
