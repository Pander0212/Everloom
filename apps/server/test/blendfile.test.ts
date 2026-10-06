import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { blendJobFiles, blendNotes, isBlend, safeRelPath, zipHasBlend } from '../src/services/avatars/blendfile.js';
import { sniffModel } from '../src/services/avatars/service.js';

const BLEND = Buffer.concat([Buffer.from('BLENDER-v402'), Buffer.alloc(64)]);
const zip = (files: Record<string, Buffer | string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new Uint8Array(Buffer.from(v))]))));

describe('.blend files', () => {
  it('knows a .blend by its header, or a compressed one by its name', () => {
    expect(isBlend(BLEND)).toBe(true);
    const zstd = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0, 0, 0, 0]);
    expect(isBlend(zstd, 'char.blend')).toBe(true);
    expect(isBlend(zstd, 'char.bin')).toBe(false);
    expect(sniffModel(BLEND, 'x.blend')).toBe('blend');
    expect(sniffModel(zip({ 'a/model.blend': BLEND }), 'pack.zip')).toBe('zip');
    expect(sniffModel(zip({ 'readme.txt': 'hi' }), 'pack.zip')).toBeNull();
    expect(zipHasBlend(Buffer.from('not a zip'))).toBe(false);
  });

  it('keeps a zip’s folders (for relative texture paths) and refuses paths that climb out', () => {
    expect(safeRelPath('My char/textures/skin.png')).toBe('My char/textures/skin.png');
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a\\b', 'a\u0000b']) expect(safeRelPath(bad)).toBeNull();
    const job = blendJobFiles(zip({ 'Char/sub/old.blend': BLEND, 'Char/model.blend': BLEND, 'Char/textures/skin.png': 'png', '../evil.txt': 'x', '__MACOSX/Char/._model.blend': 'x' }), 'c.zip');
    expect(job.input).toBe('blend/Char/model.blend');
    expect(Object.keys(job.files).sort()).toEqual(['blend/Char/model.blend', 'blend/Char/sub/old.blend', 'blend/Char/textures/skin.png']);
    expect(() => blendJobFiles(zip({ 'a.txt': 'x' }), 'c.zip')).toThrow(/No \.blend/);
    expect(blendJobFiles(BLEND, 'x.blend')).toEqual({ files: { 'input.blend': BLEND }, input: 'input.blend' });
  });

  it('turns what Blender found into notes for the import report', () => {
    const notes = blendNotes({ blend: { missingTextures: ['Skin', 'Eyes'], missingLibraries: 1, skipped: 2, subdivRemoved: 1, modifiersNotApplied: 0 } });
    expect(notes.map((n) => n.code)).toEqual(['blend_missing_textures', 'blend_missing_libraries', 'blend_skipped', 'blend_subdivision']);
    expect(notes[0]!.message).toMatch(/Pack Resources/);
    expect(blendNotes({})).toEqual([]);
  });
});
