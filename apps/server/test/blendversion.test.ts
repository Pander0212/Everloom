import { zstdCompressSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { blendNotes, blendVersion, newerThan } from '../src/services/avatars/blendfile.js';

describe('.blend versions', () => {
  it('reads the saving version from the header, plain, gzip, zstd and Blender 5', () => {
    const head = (s: string) => Buffer.concat([Buffer.from(s, 'latin1'), Buffer.alloc(64)]);
    expect(blendVersion(head('BLENDER-v402REND'))).toBe('4.2');
    expect(blendVersion(head('BLENDER_v293REND'))).toBe('2.93');
    expect(blendVersion(gzipSync(head('BLENDER-v279')))).toBe('2.79');
    expect(blendVersion(zstdCompressSync(head('BLENDER-v361')))).toBe('3.61');
    expect(blendVersion(head('BLENDER17-01v0500'))).toBe('5.0');
    expect(blendVersion(Buffer.from('not a blend'))).toBeNull();
    expect(newerThan('5.0', '4.2')).toBe(true);
    expect(newerThan('3.6', '4.2')).toBe(false);
  });
  it('says which converter ran, flags a newer file, lists animations', () => {
    const notes = blendNotes({ blender: '3.6.15', actions: ['Wave'] }, '4.2').map((n) => n.code);
    expect(notes).toEqual(['blend_converter', 'blend_newer', 'blend_actions']);
  });
});
