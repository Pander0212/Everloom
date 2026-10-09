import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { projectFromFiles, projectFromPackage } from '../src/unity/project';
import { readTar } from '../src/unity/tar';
import { planImport, summarize } from '../src/unity/plan';

const DIR = join(__dirname, '../../../tests/fixtures/unity');
const pkg = (name: string) => projectFromPackage(readTar(new Uint8Array(gunzipSync(readFileSync(join(DIR, name))))));
const folder = (name: string) => {
  const root = join(DIR, name);
  const files: { path: string; data: Uint8Array }[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else files.push({ path: relative(root, p).replace(/\\/g, '/'), data: new Uint8Array(readFileSync(p)) });
    }
  };
  walk(root);
  return projectFromFiles(files);
};

describe('importing Everloom’s Unity test packages', () => {
  it('finds the avatar in the avatar package and the outfit in the clothing package', () => {
    const s = summarize(pkg('Ava.unitypackage'));
    expect(s.avatars.map((a) => a.name)).toEqual(['Ava']);
    expect(s.avatars[0]!.reason).toMatch(/descriptor/);
    expect(s.exact).toBe(true);
    expect(s.license[0]?.path).toBe('Assets/Ava/README.txt');
    const j = summarize(pkg('AvaJacket.unitypackage'));
    expect(j.outfits.map((o) => o.name)).toEqual(['Jacket']);
    expect(j.outfits[0]!.reason).toMatch(/Merge Armature/);
  });

  it('plans the avatar: humanoid map, materials, presets, visemes, blink, physics, hidden hat, toggle', () => {
    const p = pkg('Ava.unitypackage');
    const plan = planImport(p, summarize(p).avatars[0]!.guid);
    expect(plan.models.map((m) => m.path)).toEqual(['Assets/Ava/Ava.fbx']);
    expect(plan.boneMap).toMatchObject({ hips: 'pelvis', spine: '上半身', neck: '首', head: 'head', leftThumbMetacarpal: 'thumb_01_l' });
    const body = plan.renderers.find((r) => r.path.at(-1) === 'Body')!;
    expect(body.blendShapes).toEqual({ 0: 40, 6: 25 });
    expect(body.materials).toEqual([]);
    expect(Object.values(plan.materials).map((m) => [m.name, m.family, m.alpha]).sort()).toEqual([
      ['Body', 'liltoon', 'opaque'],
      ['Hat', 'standard', 'opaque'],
    ]);
    expect(Object.values(plan.textures).map((t) => t.path)).toEqual(['Assets/Ava/Textures/Body.png']);
    expect(plan.descriptor?.mouth).toEqual({ aa: 'vrc.v_aa', ih: 'vrc.v_ih', ou: 'vrc.v_ou', ee: 'vrc.v_e', oh: 'vrc.v_oh' });
    expect(plan.descriptor?.eyelids.blink).toBe(17);
    expect(plan.descriptor?.eyelids.mesh?.at(-1)).toBe('Body');
    expect(plan.chains.map((c) => [c.path.at(-1), c.kind]).sort()).toEqual([
      ['Hair_Back_1', 'hair'],
      ['breast_l', 'chest'],
      ['breast_r', 'chest'],
    ]);
    expect(plan.hidden.map((h) => h.at(-1))).toEqual(['Hat']);
    expect(plan.toggles).toEqual([{ label: 'Hat', objects: [{ path: ['Ava', 'Hat'], active: true }] }]);
    // The report says what came in, what was approximated, and what was skipped.
    const lines = (l: { what: string; detail?: string }[]) => l.map((x) => `${x.what}: ${x.detail}`).join('\n');
    expect(lines(plan.report.imported)).toMatch(/VRChat avatar descriptor: 5 mouth shapes for lip-sync, blink/);
    expect(lines(plan.report.imported)).toMatch(/Physics: 3 PhysBones/);
    expect(lines(plan.report.imported)).toMatch(/Blendshape presets: 2 values/);
    expect(lines(plan.report.skipped)).toMatch(/1 scripts: Scripts \(C#, DLLs\)/);
    expect(plan.report.thirdParty).toBe(true);
  });

  it('plans the jacket as an outfit merged by bone names', () => {
    const p = pkg('AvaJacket.unitypackage');
    const plan = planImport(p, summarize(p).outfits[0]!.guid);
    expect(plan.merge).toEqual({ root: ['Jacket', 'Armature'], prefix: 'Outfit_', suffix: '' });
    expect(Object.values(plan.materials).map((m) => m.name)).toEqual(['Jacket']);
  });

  it('reads the same avatar from extracted files, with .meta files exactly', () => {
    const p = folder('Ava-extracted');
    expect(p.exact).toBe(true);
    const plan = planImport(p, summarize(p).avatars[0]!.guid);
    expect(plan.chains).toHaveLength(3);
    expect(plan.boneMap.spine).toBe('上半身');
  });

  it('without .meta files, says what it could and couldn’t link', () => {
    const p = folder('Ava-extracted-nometa');
    expect(p.exact).toBe(false);
    const s = summarize(p);
    // The prefab can't reach its model by GUID; the bare FBX is still offered.
    expect([...s.avatars, ...s.outfits].map((c) => c.path)).toContain('Assets/Ava/Ava.fbx');
  });
});
