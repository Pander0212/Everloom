/**
 * Real .blend files through the Blender worker (runs when EVERLOOM_BLENDER points at a Blender).
 * The files come from tools/avatars/blend-fixtures.py: one compressed file is in the repo, more can
 * be made with any Blender version into EVERLOOM_BLEND_DIR (see docs/3d-import/blend.md).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { avatarSettled } from '../src/services/avatars/service.js';
import { createClient, type TestClient } from './helpers.js';

const BLENDER = process.env.EVERLOOM_BLENDER;
const dirs = [path.resolve(__dirname, '../../../tests/fixtures/blend'), process.env.EVERLOOM_BLEND_DIR].filter((d): d is string => !!d && existsSync(d));
const files = [...new Set(dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.blend')).map((f) => path.join(d, f))))];
const oct = { 'content-type': 'application/octet-stream' };

let c: TestClient | null = null;
afterEach(async () => {
  await c?.close();
  c = null;
});

describe.skipIf(!BLENDER || !existsSync(BLENDER))('.blend through Blender', () => {
  for (const file of files) {
    it(`${path.basename(file)}: meshes, armature, shape keys, materials come through`, async () => {
      c = await createClient();
      const up = await c.req('POST', `/api/avatars?filename=${encodeURIComponent(path.basename(file))}`, readFileSync(file), oct);
      expect(up.status, JSON.stringify(up.json)).toBe(200);
      await avatarSettled(up.json.id);
      const a = (await c.req('GET', `/api/avatars/${up.json.id}`)).json;
      const info = a.info;
      // What the newer file holds may not open in an older Blender: then the reason must be clear.
      if (a.status === 'failed') {
        expect(a.error).toMatch(/newer Blender|Blender \d/);
        return;
      }
      expect(a.status, a.error).toBe('ready');
      expect(info.meshNames).toEqual(expect.arrayContaining(['Body']));
      expect(info.bones.length).toBeGreaterThanOrEqual(50);
      expect(info.morphs).toEqual(expect.arrayContaining(['Breast_Large', 'eyeBlinkLeft']));
      expect(info.materialNames).toEqual(expect.arrayContaining(['Body', 'Body_Lower']));
      expect(info.missingBones).toEqual([]);
      // Which converter ran is in the report.
      expect(JSON.stringify(info.warnings ?? [])).toMatch(/Blender/);
      // Animations inside are listed (they import as motions); the model itself carries none.
      if (/extras/.test(file)) expect(JSON.stringify(info.warnings)).toMatch(/1 animation in the file \(Wave\)/);
    }, 400_000);
  }
});
