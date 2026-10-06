import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { makeSeamless, seamScore } from '../src/services/avatars/textures.js';

describe('garment textures', () => {
  it('makes a tile seamless (edges meet when it repeats)', async () => {
    // A horizontal and vertical ramp: the worst case for tiling (black meets white at the wrap).
    const w = 256;
    const raw = Buffer.alloc(w * w * 3);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) raw.set([x, y, (x * 7 + y * 13) % 256], (y * w + x) * 3);
    const png = await sharp(raw, { raw: { width: w, height: w, channels: 3 } }).png().toBuffer();
    const before = await seamScore(png);
    const after = await seamScore(await makeSeamless(png, 256));
    expect(before).toBeGreaterThan(80);
    expect(after).toBeLessThan(before / 6);
    const meta = await sharp(await makeSeamless(png, 512)).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([512, 512, 'png']);
  });
});
