import { describe, expect, it } from 'vitest';
import { mesh } from '../src/features/avatar3d/runtime/codemade/mesher';
import { ellipsoid, roundCone } from '../src/features/avatar3d/runtime/codemade/sdf';

describe('code-made mesher', () => {
  it('meshes a sphere: points on the surface, closed, facing out', () => {
    const m = mesh({ shapes: [ellipsoid([0, 0, 0], [0.1, 0.1, 0.1], 'hips')], blend: 0.01 }, 0.01);
    const n = m.positions.length / 3;
    expect(n).toBeGreaterThan(300);
    for (let i = 0; i < n; i++) expect(Math.abs(Math.hypot(m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!) - 0.1)).toBeLessThan(0.004);
    // Closed: every edge is shared by exactly two triangles.
    const edges = new Map<string, number>();
    for (let t = 0; t < m.indices.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = m.indices[t + e]!;
        const b = m.indices[t + ((e + 1) % 3)]!;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    expect([...edges.values()].every((c) => c === 2)).toBe(true);
    // Winding agrees with the outward normals.
    let out = 0;
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!].map((i) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!]);
      const u = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!];
      const v = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!];
      const nrm = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      if (nrm[0]! * a![0]! + nrm[1]! * a![1]! + nrm[2]! * a![2]! > 0) out++;
    }
    expect(out / (m.indices.length / 3)).toBeGreaterThan(0.98);
  });

  it('blends limbs smoothly', () => {
    const m = mesh({ shapes: [roundCone([0, 0, 0], [0, 0.3, 0], 0.05, 0.04, 'leftUpperLeg'), roundCone([0, 0.3, 0], [0.2, 0.4, 0], 0.04, 0.03, 'leftLowerLeg')], blend: 0.03 }, 0.008);
    expect(m.indices.length / 3).toBeGreaterThan(500);
    expect(m.normals.every(Number.isFinite)).toBe(true);
  });
});

describe('code-made characters', async () => {
  const { codeGeometry } = await import('../src/features/avatar3d/runtime/codemade/geometry');
  const { planBody } = await import('../src/features/avatar3d/runtime/codemade/body');
  const { AvatarRecipeSchema, REQUIRED_BONES } = await import('@everloom/engine');

  it('builds a skinned, budgeted character with a canonical skeleton', () => {
    const g = codeGeometry({ hair: { style: 'ponytail' }, extras: [{ kind: 'cape' }] });
    const names = g.bones.map((b) => b.name);
    for (const b of REQUIRED_BONES) expect(names).toContain(b);
    // Parents come before children.
    g.bones.forEach((b, i) => b.parent && expect(names.indexOf(b.parent)).toBeLessThan(i));
    expect(g.chains.length).toBe(2);
    let tris = g.face.indices.length / 3;
    for (const p of g.parts) {
      tris += p.indices.length / 3;
      for (let v = 0; v < p.skinWeight.length; v += 4) expect(Math.abs(p.skinWeight[v]! + p.skinWeight[v + 1]! + p.skinWeight[v + 2]! + p.skinWeight[v + 3]! - 1)).toBeLessThan(1e-4);
      for (const i of p.skinIndex) expect(i).toBeLessThan(g.bones.length);
    }
    expect(tris).toBeLessThan(60_000);
    expect(g.height).toBeGreaterThan(1.6);
    expect(g.height).toBeLessThan(1.9);
    const low = codeGeometry({ hair: { style: 'ponytail' } }, { low: true });
    expect(low.parts.reduce((a, p) => a + p.indices.length / 3, 0)).toBeLessThan(tris * 0.55);
  }, 30_000);

  it('gives every face morph a real change and children no chest shape', () => {
    const g = codeGeometry({});
    for (const [k, m] of Object.entries(g.face.morphs)) expect(m.some((v) => Math.abs(v) > 1e-4), k).toBe(true);
    const child = planBody(AvatarRecipeSchema.parse({ body: { age: 'child', height: 1.2, chest: 1 } }));
    const adult = planBody(AvatarRecipeSchema.parse({ body: { age: 'adult', chest: 1 } }));
    expect(adult.shapes.length - child.shapes.length).toBe(2);
  }, 30_000);
});

describe('code-made garments fit every body', async () => {
  const { planBody } = await import('../src/features/avatar3d/runtime/codemade/body');
  const { planOutfit } = await import('../src/features/avatar3d/runtime/codemade/outfit');
  const { evalField } = await import('../src/features/avatar3d/runtime/codemade/sdf');
  const { mesh: meshField } = await import('../src/features/avatar3d/runtime/codemade/mesher');
  const { AvatarRecipeSchema } = await import('@everloom/engine');
  const extremes = [
    { age: 'adult', build: 0, frame: 0, chest: 1, height: 2.1 },
    { age: 'adult', build: 1, frame: 1, chest: 0, height: 1.45 },
    { age: 'elder', build: 1, frame: 0, chest: 1, height: 1.5 },
    { age: 'teen', build: 0, frame: 1, chest: 1, height: 1.9 },
    { age: 'child', build: 1, frame: 0.5, chest: 1, height: 0.9 },
  ] as const;
  it.each(extremes)('skin stays under a fitted shirt and trousers: %o', (body) => {
    const r = AvatarRecipeSchema.parse({ body, top: { kind: 'shirt', sleeve: 1, looseness: 0 }, bottom: { kind: 'pants', looseness: 0 } });
    const plan = planBody(r);
    const skin = { shapes: plan.shapes, blend: plan.blend };
    for (const part of planOutfit(plan, r).parts.filter((p) => p.name === 'Top' || p.name === 'Bottom')) {
      const cell = part.cell * plan.H * 1.6;
      const m = meshField(part.field, cell);
      let checked = 0;
      for (let v = 0; v < m.positions.length; v += 3) {
        const [x, y, z] = [m.positions[v]!, m.positions[v + 1]!, m.positions[v + 2]!];
        // Away from the cut edges (sleeve ends, hems, neckline), the garment is outside the skin.
        if ((part.field.clips ?? []).some((c) => c(x, y, z) > -3 * cell)) continue;
        checked++;
        expect(evalField(skin, x, y, z)).toBeGreaterThan((part.field.offset ?? 0) * 0.4);
      }
      expect(checked).toBeGreaterThan(200);
    }
  }, 60_000);
});
