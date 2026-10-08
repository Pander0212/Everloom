import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { mapExpressions } from '@everloom/engine';
import { blendTargets, fitProxy, parseHumanObj, parseProxy, parseTarget } from '../src/features/avatar3d/runtime/makehuman-data';
const root = path.resolve(import.meta.dirname, '../../../tests/fixtures/models/makehuman');
const base = parseHumanObj(readFileSync(path.join(root, '3dobjs/base.obj'), 'utf8'));

describe('native MakeHuman, using official CC0 data', () => {
  it('reads licensed facial actions on the original topology and maps blinks, emotions and visemes', () => {
    const paths = readdirSync(path.join(root, 'faceunits'));
    for (const file of paths) {
      const target = parseTarget(readFileSync(path.join(root, 'faceunits', file), 'utf8'), base.vertices.length / 3);
      expect(target.indices.length).toBeGreaterThan(0);
      expect(blendTargets(base.vertices, [{ target, value: 1 }]).every(Number.isFinite)).toBe(true);
    }
    const expressions = mapExpressions(paths.map(p => p.replace('.target', '')));
    expect(expressions.rig).toBe('arkit');
    expect(expressions.map.blink).toHaveLength(2);
    expect(expressions.map.joy?.some(p => p.morph === 'mouthSmileLeft')).toBe(true);
    expect(expressions.map.aa?.some(p => p.morph === 'jawOpen')).toBe(true);
  });
  it('keeps original topology and joint helpers for fitting and rig positions', () => {
    expect(base.vertices.length / 3).toBe(19158);
    expect(base.faces.filter(f => f.group === 'body').length).toBeGreaterThan(10000);
    expect(base.groups.get('joint-ground')?.size).toBeGreaterThan(0);
  });
  it('applies a real breast target without changing the rest mesh and can reset exactly', () => {
    const dir = path.join(root, 'targets/breast');
    const target = parseTarget(gunzipSync(readFileSync(path.join(dir, readdirSync(dir)[0]))).toString(), base.vertices.length / 3);
    const before = base.vertices.slice(), body = blendTargets(base.vertices, [{ target, value: 1 }]);
    expect(target.indices.length).toBeGreaterThan(20);
    const same = (a: Float32Array, b: Float32Array) => Buffer.from(a.buffer).equals(Buffer.from(b.buffer));
    expect(same(body, before)).toBe(false);
    expect(same(base.vertices, before)).toBe(true);
    expect(same(blendTargets(base.vertices, [{ target, value: 0 }]), before)).toBe(true);
  });
  it('refits a real suit from its body bindings and preserves finite geometry at a changed shape', () => {
    const proxy = parseProxy(readFileSync(path.join(root, 'clothes/female_casualsuit01/female_casualsuit01.mhclo'), 'utf8'), base.vertices.length / 3);
    const obj = parseHumanObj(readFileSync(path.join(root, 'clothes/female_casualsuit01/female_casualsuit01.obj'), 'utf8'));
    expect(proxy.bindings.length).toBe(obj.vertices.length / 3);
    expect(proxy.hidden.size).toBeGreaterThan(100);
    const fit = fitProxy(base.vertices, proxy), enlarged = fitProxy(base.vertices.map(v => v * 1.2), proxy);
    expect([...enlarged].every(Number.isFinite)).toBe(true);
    // All offset reference spans and weighted body points scale with the body.
    for (let i = 0; i < fit.length; i += 151) expect(enlarged[i]).toBeCloseTo(fit[i] * 1.2, 4);
  });
  it('rejects corrupt target and binding references before they can reach the viewport', () => {
    expect(() => parseTarget('999999 0 1 0', base.vertices.length / 3)).toThrow(/range/);
    expect(() => parseProxy('obj_file x.obj\nverts\n999999', base.vertices.length / 3)).toThrow(/binding/);
  });
  it('reads the official hair header which places material inside the verts section', () => {
    const proxy = parseProxy(readFileSync(path.join(root, 'hair/bob01/bob01.mhclo'), 'utf8'), base.vertices.length / 3);
    expect(proxy.material).toBe('bob01.mhmat');
    expect(proxy.bindings.length).toBeGreaterThan(100);
  });
});
