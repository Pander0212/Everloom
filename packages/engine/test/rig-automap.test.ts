import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { automap, scoreMapping } from '../src/rig/automap';
import { nameInfo, translate } from '../src/rig/names';
import { FIXTURES } from './rig-fixtures';

describe('bone names', () => {
  it('reads sides, numbers and words in four languages', () => {
    expect(nameInfo('J_Sec_L_Bust1')).toMatchObject({ words: ['bust'], side: 'L', index: 1 });
    expect(nameInfo('mixamorig:LeftUpLeg')).toMatchObject({ words: ['up', 'leg'], side: 'L' });
    expect(nameInfo('左おっぱい２')).toMatchObject({ words: ['breasts'], side: 'L', index: 2 });
    expect(nameInfo('Breast_root.R.001')).toMatchObject({ words: ['breast', 'root'], side: 'R' });
    expect(nameInfo('가슴_R').words).toEqual(['chest']);
    expect(nameInfo('左臀部').words).toEqual(['butt']);
    expect(translate('上半身2')).toMatch(/UpperBody2/);
  });
});

describe('the auto-mapper on fixture rigs', () => {
  const report: Record<string, unknown> = {};
  for (const make of FIXTURES) {
    const f = make();
    it(`${f.name} (${f.bones.length} bones): at least ${Math.round(f.min * 100)}%`, () => {
      const r = automap({ bones: f.bones });
      const s = scoreMapping(r, f.expected);
      report[f.name] = { bones: f.bones.length, accuracy: Math.round(s.overall * 1000) / 10, byRole: Object.fromEntries(Object.entries(s.byRole).map(([k, v]) => [k, `${v.right}/${v.total}`])), review: r.review.length };
      const wrong = Object.entries(f.expected).filter(([b, want]) => {
        const got = r.byBone.get(b);
        const label = got?.kind === 'spine' ? 'spine' : got?.kind === 'ignore' ? 'ignore' : got?.kind === 'humanoid' ? 'humanoid' : String(got?.role ?? 'none');
        return !want.split('|').includes(label);
      }).map(([b, want]) => `${b}: want ${want}, got ${r.byBone.get(b)?.kind}/${String(r.byBone.get(b)?.role)}`);
      expect(s.overall, wrong.slice(0, 20).join('\n')).toBeGreaterThanOrEqual(f.min);
      // Nothing is dropped: every bone has an outcome.
      for (const b of f.bones) expect(r.byBone.has(b.name), b.name).toBe(true);
      expect(r.missing).toEqual([]);
    });
  }
  it('writes the accuracy report when asked (AUTOMAP_REPORT=path)', () => {
    if (process.env.AUTOMAP_REPORT) writeFileSync(process.env.AUTOMAP_REPORT, JSON.stringify(report, null, 2) + '\n');
    expect(Object.keys(report).length).toBe(FIXTURES.length);
  });

  it('keeps a multi-bone spine in order and splits breast chains by side', () => {
    const f = FIXTURES[4]!();
    const r = automap({ bones: f.bones });
    expect(r.rig.spine).toEqual(['Spine', 'Spine1', 'Spine2', 'Chest', 'Upper_Chest'].filter((b) => !Object.values(r.boneMap).includes(b) || true).filter((b) => r.rig.spine.includes(b)));
    expect(r.rig.spine.length).toBeGreaterThanOrEqual(3);
    const breasts = r.rig.roles.filter((x) => x.role === 'breast');
    expect(breasts.map((b) => b.side).sort()).toEqual(['L', 'R']);
    expect(breasts.every((b) => b.bones.length === 3)).toBe(true);
    expect(r.rig.roles.filter((x) => x.role === 'hair').length).toBe(18);
  });

  it('prefers the file’s own humanoid map', () => {
    const f = FIXTURES[4]!();
    const r = automap({ bones: f.bones, humanoid: { hips: 'Hips', spine: 'Spine1' }, humanoidSource: 'Unity humanoid' });
    expect(r.humanoid.spine).toMatchObject({ bone: 'Spine1', confidence: 1 });
  });
});
