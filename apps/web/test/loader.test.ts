import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseGlb, writeGlb } from '../../server/src/services/avatars/glb';
import { loadModel } from '../src/features/avatar3d/runtime/loader';
import { ROOT } from './helpers3d';

/** The mannequin with Mixamo-style names ("mixamorig:Hips"), which three.js rewrites on load. */
function renamed(): ArrayBuffer {
  const g = parseGlb(readFileSync(new URL('tests/fixtures/avatars/models/mannequin-m.glb', ROOT)));
  for (const n of g.json.nodes ?? []) if (n.name) n.name = `rig:${n.name}`;
  const b = writeGlb(g);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

describe('model loader', () => {
  it('finds saved bones by their names in the file, even when three.js renames them', async () => {
    const buf = renamed();
    const auto = await loadModel(buf, null);
    expect(auto.missing).toEqual([]);
    expect(auto.bones.hips?.name).toBe('rigDEF-hips');
    // A saved map uses the file's names (from the server's inspection). Swap the hands to see it applied.
    const left = `rig:${auto.bones.leftHand!.name.slice(3)}`;
    const right = `rig:${auto.bones.rightHand!.name.slice(3)}`;
    const saved = await loadModel(renamed(), null, { boneMap: { hips: 'rig:DEF-hips', leftHand: right, rightHand: left } });
    expect(saved.bones.hips?.name).toBe('rigDEF-hips');
    expect(saved.bones.leftHand?.name).toBe(auto.bones.rightHand!.name);
    expect(saved.bones.rightHand?.name).toBe(auto.bones.leftHand!.name);
  });

  it('applies the saved size and fits models in odd units', async () => {
    const m = await loadModel(renamed(), null, { scale: 0.5 });
    expect(m.height).toBeGreaterThan(0.8);
    expect(m.height).toBeLessThan(1);
    const huge = await loadModel(renamed(), null, { scale: 100 });
    expect(huge.autoFit).toBe(true);
    expect(huge.height).toBeCloseTo(1.65, 1);
  });
});
