import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { clipToLayers, isClip } from '../src/services/puppets/clipfile.js';
import { makeClip } from './clip-fixture.js';

describe('Clip Studio .clip drawings', () => {
  it('reads visible layers bottom-first with folder names, offsets and masks', async () => {
    const clip = makeClip();
    expect(isClip(clip)).toBe(true);
    const { index, files } = await clipToLayers(clip);
    expect([index.width, index.height]).toEqual([300, 200]);
    // Paper and the hidden sketch are left out.
    expect(index.layers.map((l) => l.name)).toEqual(['Body/Shirt', 'Hair']);
    const [shirt, hair] = index.layers;
    // The mask cuts the shirt at x = 60.
    expect(shirt).toMatchObject({ left: 10, top: 20, width: 50, height: 50 });
    expect(hair).toMatchObject({ left: 25, top: 15, width: 40, height: 30 });
    const { data, info } = await sharp(files.get(shirt!.file)!).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([50, 50]);
    expect([...data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    const g = await sharp(files.get(hair!.file)!).raw().toBuffer();
    expect([...g.subarray(0, 4)]).toEqual([0, 255, 0, 255]);
  });

  it('refuses files that are not .clip drawings or are damaged', async () => {
    expect(isClip(Buffer.from('PK\x03\x04 a zip, not a drawing'))).toBe(false);
    const clip = makeClip();
    await expect(clipToLayers(clip.subarray(0, clip.length - 200))).rejects.toThrow(/could not be read|cut short/);
  });

  // Real Clip Studio files (not shipped): EVERLOOM_CLIP_DIR=<folder with .clip files>.
  const dir = process.env.EVERLOOM_CLIP_DIR;
  it.skipIf(!dir)('reads real Clip Studio files', async () => {
    for (const f of readdirSync(dir!).filter((n) => n.endsWith('.clip'))) {
      const r = await clipToLayers(readFileSync(path.join(dir!, f))).catch((e: Error) => e);
      // A blank drawing is refused with a clear message; anything else must come in.
      if (r instanceof Error) expect(r.message, f).toMatch(/no visible layers/);
      else expect(r.index.layers.length, f).toBeGreaterThan(0);
    }
  });
});
