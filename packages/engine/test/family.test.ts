import { describe, expect, it } from 'vitest';
import { automap, type AutomapBone } from '../src/rig/automap.js';
import { analyzeSkeleton } from '../src/rig/family.js';

/** Bones from Blender-style coordinates (Z up, facing -Y) into glTF's (Y up, facing +Z). */
type B = [name: string, parent: string | null, head: [number, number, number]];
const gl = (bones: B[], rename?: (n: string, i: number) => string): AutomapBone[] => {
  const map = new Map(bones.map(([n], i) => [n, rename ? rename(n, i) : n]));
  return bones.map(([n, p, [x, y, z]]) => ({ name: map.get(n)!, parent: p ? map.get(p)! : null, pos: [x, z, -y] }));
};

const quadruped = (wings = false): B[] => {
  const b: B[] = [['root', null, [0, 0, 0]], ['pelvis', 'root', [0, 0.4, 0.75]], ['spine', 'pelvis', [0, 0.15, 0.78]], ['chest', 'spine', [0, -0.1, 0.8]], ['neck', 'chest', [0, -0.3, 0.82]], ['head', 'neck', [0, -0.45, 1.0]], ['snout', 'head', [0, -0.65, 1.02]]];
  for (const [s, x] of [['L', 1], ['R', -1]] as const) {
    b.push([`thigh.${s}`, 'pelvis', [0.14 * x, 0.4, 0.7]], [`shin.${s}`, `thigh.${s}`, [0.14 * x, 0.42, 0.4]], [`hoof.${s}`, `shin.${s}`, [0.14 * x, 0.45, 0.1]], [`hooftip.${s}`, `hoof.${s}`, [0.14 * x, 0.42, 0.0]]);
    b.push([`front.${s}`, 'chest', [0.14 * x, -0.25, 0.72]], [`fore.${s}`, `front.${s}`, [0.14 * x, -0.26, 0.4]], [`fronthoof.${s}`, `fore.${s}`, [0.14 * x, -0.27, 0.1]], [`fronttip.${s}`, `fronthoof.${s}`, [0.14 * x, -0.3, 0.0]]);
    if (wings) b.push([`w1.${s}`, 'chest', [0.08 * x, -0.15, 0.88]], [`w2.${s}`, `w1.${s}`, [0.35 * x, -0.12, 0.95]], [`w3.${s}`, `w2.${s}`, [0.6 * x, -0.08, 0.98]], [`w4.${s}`, `w3.${s}`, [0.85 * x, -0.02, 0.96]]);
  }
  b.push(['tail1', 'pelvis', [0, 0.45, 0.8]], ['tail2', 'tail1', [0, 0.62, 0.75]], ['tail3', 'tail2', [0, 0.78, 0.65]], ['tail4', 'tail3', [0, 0.9, 0.5]]);
  return b;
};

const humanoid = (): B[] => {
  const b: B[] = [['Hips', null, [0, 0, 0.95]], ['Spine', 'Hips', [0, 0, 1.05]], ['Chest', 'Spine', [0, 0, 1.2]], ['Neck', 'Chest', [0, 0, 1.38]], ['Head', 'Neck', [0, 0, 1.48]], ['HeadTop', 'Head', [0, 0, 1.7]]];
  for (const [s, x] of [['L', 1], ['R', -1]] as const) {
    b.push([`Shoulder.${s}`, 'Chest', [0.04 * x, 0, 1.36]], [`UpperArm.${s}`, `Shoulder.${s}`, [0.17 * x, 0, 1.36]], [`LowerArm.${s}`, `UpperArm.${s}`, [0.42 * x, 0, 1.36]], [`Hand.${s}`, `LowerArm.${s}`, [0.66 * x, 0, 1.36]]);
    for (const f of ['Index', 'Middle', 'Ring']) b.push([`${f}.${s}`, `Hand.${s}`, [0.76 * x, (f === 'Index' ? -0.02 : f === 'Ring' ? 0.02 : 0), 1.36]]);
    b.push([`UpperLeg.${s}`, 'Hips', [0.1 * x, 0, 0.95]], [`LowerLeg.${s}`, `UpperLeg.${s}`, [0.1 * x, 0, 0.52]], [`Foot.${s}`, `LowerLeg.${s}`, [0.1 * x, 0.02, 0.09]], [`Toes.${s}`, `Foot.${s}`, [0.1 * x, -0.1, 0.02]], [`ToeEnd.${s}`, `Toes.${s}`, [0.1 * x, -0.16, 0.0]]);
  }
  return b;
};

describe('skeleton families', () => {
  it('a four-legged body: front and hind legs, pelvis, neck, head, tail', () => {
    const a = analyzeSkeleton(gl(quadruped()));
    expect(a.family).toBe('quadruped');
    expect(a.frontLegs.map((l) => l.bones[0]).sort()).toEqual(['front.L', 'front.R']);
    expect(a.hindLegs.map((l) => l.bones[0]).sort()).toEqual(['thigh.L', 'thigh.R']);
    expect(a.pelvis).toBe('pelvis');
    expect(a.head).toBe('head');
    expect(a.tails[0]?.bones[0]).toBe('tail1');
    expect(a.forward[2]).toBeGreaterThan(0.9);
  });

  it('the same body with names that say nothing: found from its shape alone', () => {
    const a = analyzeSkeleton(gl(quadruped(), (_n, i) => `Bone.${String(i).padStart(3, '0')}`));
    expect(a.family).toBe('quadruped');
    expect(a.frontLegs).toHaveLength(2);
    expect(a.hindLegs).toHaveLength(2);
    expect(a.tails).toHaveLength(1);
  });

  it('wings make it a winged four-legged body', () => {
    const a = analyzeSkeleton(gl(quadruped(true), (n, i) => (n.startsWith('w') ? `Bone.${i}` : n)));
    expect(a.family).toBe('wingedQuadruped');
    expect(a.wings.map((w) => w.side).sort()).toEqual(['L', 'R']);
  });

  it('a long legless chain is a serpent', () => {
    const b: B[] = [['s0', null, [0, 1.4, 0.08]]];
    for (let i = 1; i < 15; i++) b.push([`s${i}`, `s${i - 1}`, [0, 1.4 - 0.15 * i, 0.08]]);
    expect(analyzeSkeleton(gl(b)).family).toBe('serpent');
  });

  it('anything else is generic', () => {
    const b: B[] = [['trunk', null, [0, 0, 0]], ['trunk2', 'trunk', [0, 0, 0.6]], ['branchL', 'trunk2', [0, 0, 0.9]], ['branchR', 'trunk2', [0, 0, 0.9]], ['tipL', 'branchL', [0.4, 0, 1.3]], ['tipR', 'branchR', [-0.4, 0, 1.3]]];
    expect(analyzeSkeleton(gl(b)).family).toBe('generic');
  });

  it('a humanoid whose names say nothing gets its core from the shape', () => {
    const r = automap({ bones: gl(humanoid(), (_n, i) => `MBone${i}`) });
    expect(r.rig.family).toBe('humanoid');
    expect(r.missing).toEqual([]);
    expect(r.boneMap.hips).toBe('MBone0');
    expect(r.boneMap.head).toBe('MBone4');
  });

  it('a humanoid core with wings and a tail is a two-legged creature (human motions still fit)', () => {
    const b = humanoid();
    for (const [s, x] of [['L', 1], ['R', -1]] as const) b.push([`Wing1.${s}`, 'Chest', [0.06 * x, 0.08, 1.32]], [`Wing2.${s}`, `Wing1.${s}`, [0.4 * x, 0.15, 1.55]], [`Wing3.${s}`, `Wing2.${s}`, [0.8 * x, 0.2, 1.6]]);
    b.push(['Tail1', 'Hips', [0, 0.06, 0.95]], ['Tail2', 'Tail1', [0, 0.3, 0.8]], ['Tail3', 'Tail2', [0, 0.55, 0.55]]);
    const r = automap({ bones: gl(b) });
    expect(r.rig.family).toBe('bipedCreature');
    expect(r.missing).toEqual([]);
    expect(r.rig.roles.filter((x) => x.role === 'wings')).toHaveLength(2);
    expect(r.rig.roles.some((x) => x.role === 'tail')).toBe(true);
  });

  it("the owner's choice of family is kept", () => {
    const r = automap({ bones: gl(quadruped()), family: 'generic' });
    expect(r.rig.family).toBe('generic');
    expect(r.rig.familySource).toBe('owner');
  });

  it('a pony is not asked for arms', () => {
    const r = automap({ bones: gl(quadruped()) });
    expect(r.review.some((x) => /leftUpperArm/.test(x.bone))).toBe(false);
    expect(r.rig.roles.filter((x) => x.role === 'frontLeg')).toHaveLength(2);
  });

  it('thousands of face chains never fail the mapping', () => {
    const b = humanoid();
    for (let i = 0; i < 2500; i++) b.push([`face_${i}`, 'Head', [Math.sin(i) * 0.08, -0.08, 1.55 + (i % 10) * 0.01]]);
    const r = automap({ bones: gl(b) });
    expect(r.rig.roles.length).toBeLessThanOrEqual(2000);
    expect(r.review.some((x) => /more than 2000 chains/.test(x.why))).toBe(true);
  });
});
