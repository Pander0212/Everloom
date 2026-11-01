import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const blender = process.env.EVERLOOM_BLENDER;
it.skipIf(!blender || !existsSync(blender))('repairs flat constraint rigs, preserves rest binds and restores the source scene', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'everloom-export-core-'));
  try {
    const result = await promisify(execFile)(blender!, ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '3', '--python', resolve('tools/avatars/test-export-core.py'), '--', join(dir, 'rig.glb')], { timeout: 90_000 });
    expect(result.stdout).toContain('EXPORT_CONTRACT_OK');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 100_000);
