import { describe, expect, it } from 'vitest';
import { buildCharacter, type CharacterInput } from '../src/puppet2/build.js';
import { MOTIONS, compileMotions, mirrorMotion } from '../src/puppet2/motions.js';
import { buildSkeleton, CORE_BONES, mirrorName, proportions, type Keypoints } from '../src/puppet2/skeleton.js';
import { Rig } from '../src/puppet2/rev2d/rig.js';
import { validateModel } from '../src/puppet2/rev2d/validate.js';

type P = [number, number];
// An adult A-pose front view on a 400 × 800 canvas (the §1 test character's joints).
const FRONT: Keypoints = {
  view: 'front', headTop: [200, 90], neck: [200, 210], chest: [200, 300], pelvis: [200, 430],
  shoulder_L: [258, 268], elbow_L: [297, 376], wrist_L: [333, 475], hip_L: [234, 440], knee_L: [240, 605], ankle_L: [244, 765],
  shoulder_R: [142, 268], elbow_R: [103, 376], wrist_R: [67, 475], hip_R: [166, 440], knee_R: [160, 605], ankle_R: [156, 765],
  breast_L: [226, 300], breast_R: [174, 300], butt_L: [222, 452], butt_R: [178, 452],
};
// Profile, facing screen left: both legs nearly under the hip, the near side drawn.
const SIDE: Keypoints = {
  view: 'side', headTop: [200, 90], neck: [205, 210], chest: [200, 300], pelvis: [205, 430],
  shoulder_L: [205, 268], elbow_L: [210, 376], wrist_L: [205, 475], hip_L: [205, 440], knee_L: [200, 605], ankle_L: [208, 765],
  shoulder_R: [205, 268], elbow_R: [210, 376], wrist_R: [205, 475], hip_R: [205, 440], knee_R: [200, 605], ankle_R: [208, 765],
  breast_L: [180, 300], breast_R: [180, 300], butt_L: [230, 455], butt_R: [230, 455],
};

const layer = (id: string, role: string, rect: [number, number, number, number]) => ({ id, role, texture: id, rect }) as CharacterInput['layers'][number];
const LAYERS = [
  layer('legL', 'leg_L', [200, 420, 80, 370]), layer('legR', 'leg_R', [120, 420, 80, 370]),
  layer('torso', 'torso', [140, 200, 120, 260]), layer('head', 'head', [150, 80, 100, 140]),
  layer('bL', 'breast_L', [200, 280, 50, 44]), layer('bR', 'breast_R', [150, 280, 50, 44]),
  layer('armL', 'arm_L', [240, 250, 110, 240]), layer('armR', 'arm_R', [50, 250, 110, 240]),
  layer('handL', 'hand_L', [310, 460, 50, 70]), layer('handR', 'hand_R', [40, 460, 50, 70]),
];
const input = (kp: Keypoints, layers = LAYERS): CharacterInput => ({
  name: 'test', width: 400, height: 800, keypoints: kp, layers,
  textures: layers.map((l) => ({ id: l.texture, path: `${l.texture}.png`, width: 64, height: 64 })),
});
const angleAt = (a: P, b: P, c: P) => {
  const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]];
  return (Math.acos((u[0]! * v[0]! + u[1]! * v[1]!) / (Math.hypot(u[0]!, u[1]!) * Math.hypot(v[0]!, v[1]!))) * 180) / Math.PI;
};

describe('puppets v2 skeleton', () => {
  it('builds the standard bones and reproduces the art pose at rest', () => {
    const { bones, world } = buildSkeleton(FRONT);
    for (const id of CORE_BONES) expect(bones.some((b) => b.id === id), id).toBe(true);
    expect(world.upperarm_L!.x).toBeCloseTo(258);
    const rig = new Rig(buildCharacter(input(FRONT)));
    const pose = rig.pose({ physics: false });
    const tip = pose.bones.forearm_L!.tip;
    expect(tip[0]).toBeCloseTo(333, 0); expect(tip[1]).toBeCloseTo(475, 0);
    // Feet are IK-locked at rest: the shins end at the ankles.
    expect(pose.bones.shin_R!.tip[0]).toBeCloseTo(156, 0); expect(pose.bones.shin_R!.tip[1]).toBeCloseTo(765, 0);
  });
  it('mirrors names and measures proportions', () => {
    expect(mirrorName('upperarm_L')).toBe('upperarm_R');
    expect(mirrorName('ArmIk_R')).toBe('ArmIk_L');
    expect(mirrorName('wave_L')).toBe('wave_R');
    const p = proportions(buildSkeleton(FRONT).bones);
    expect(p.leg).toBeGreaterThan(300); expect(p.arm).toBeGreaterThan(200);
  });
});

describe('puppets v2 auto-rig', () => {
  const model = buildCharacter(input(FRONT));
  const rig = new Rig(model);
  it('produces a valid Rev2D model with skinned image meshes', () => {
    expect(validateModel(model).model).not.toBeNull();
    const arm = model.parts.find((p) => p.id === 'armL')!;
    expect(arm.skin?.bones).toEqual(['shoulder_L', 'upperarm_L', 'forearm_L']);
    expect(model.animations.map((a) => a.id)).toEqual(expect.arrayContaining(['idle', 'wave_L', 'wave_R', 'armsCrossed', 'walk', 'jump']));
  });

  it('waves with the elbow bent about 120° and the hand above the shoulder', () => {
    for (const t of [0.1, 0.5, 0.9, 1.3, 1.7]) {
      const b = rig.pose({ time: t, animations: ['wave_L'], physics: false }).bones;
      const elbow = angleAt([b.upperarm_L!.x, b.upperarm_L!.y], [b.forearm_L!.x, b.forearm_L!.y], b.forearm_L!.tip);
      expect(elbow).toBeGreaterThan(100); expect(elbow).toBeLessThan(140);
      expect(b.forearm_L!.tip[1]).toBeLessThan(b.upperarm_L!.y);
      expect(b.forearm_L!.tip[0]).toBeGreaterThan(200); // the left (screen-right) hand
    }
    const r = rig.pose({ time: 0.3, animations: ['wave_R'], physics: false }).bones;
    expect(r.forearm_R!.tip[1]).toBeLessThan(r.upperarm_R!.y);
    expect(r.forearm_R!.tip[0]).toBeLessThan(200);
  });

  it('bends the elbow without opening a hole in the arm mesh', () => {
    const pose = rig.pose({ time: 0.25, animations: ['wave_L'], physics: false });
    const bb = pose.parts.armL!.bounds!;
    // The skinned mesh stays one connected piece around the elbow: its bounds contain both joints.
    const el = [pose.bones.forearm_L!.x, pose.bones.forearm_L!.y];
    expect(el[0]).toBeGreaterThanOrEqual(bb[0]); expect(el[0]).toBeLessThanOrEqual(bb[0] + bb[2]);
    expect(el[1]).toBeGreaterThanOrEqual(bb[1]); expect(el[1]).toBeLessThanOrEqual(bb[1] + bb[3]);
  });

  it('raises both arms and crosses them with the right arm on top', () => {
    const up = rig.pose({ time: 0.4, animations: ['armsUp'], physics: false }).bones;
    for (const s of ['L', 'R']) expect(up[`forearm_${s}`]!.tip[1]).toBeLessThan(up.head!.y);
    const cross = rig.pose({ time: 1, animations: ['armsCrossed'], physics: false });
    expect(cross.drawOrder.indexOf('armR')).toBeGreaterThan(cross.drawOrder.indexOf('armL'));
    expect(cross.drawOrder.indexOf('armL')).toBeGreaterThan(cross.drawOrder.indexOf('torso'));
    // The forearms cross the midline.
    expect(cross.bones.forearm_L!.tip[0]).toBeLessThan(200);
    expect(cross.bones.forearm_R!.tip[0]).toBeGreaterThan(200);
    const back = rig.pose({ params: { ArmBack_L: 1 }, physics: false });
    expect(back.drawOrder.indexOf('armL')).toBeLessThan(back.drawOrder.indexOf('torso'));
  });

  it('keeps the planted foot locked while walking in place (front view)', () => {
    // The left leg is planted from t = 0.5 to 1 (LegIk_L = 1) while the body bobs.
    for (const t of [0.55, 0.65, 0.75, 0.85, 0.95]) {
      const b = rig.pose({ time: t, animations: ['walk'], physics: false }).bones;
      expect(Math.hypot(b.shin_L!.tip[0] - 244, b.shin_L!.tip[1] - 765)).toBeLessThan(1);
    }
    // The swing leg lifts.
    const mid = rig.pose({ time: 0.25, animations: ['walk'], physics: false }).bones;
    expect(mid.shin_L!.tip[1]).toBeLessThan(760);
  });

  it('bends the knees outward when the body crouches (front view)', () => {
    const b = rig.pose({ time: 0.2, animations: ['jump'], physics: false }).bones;
    expect(b.shin_L!.x).toBeGreaterThan(b.thigh_L!.x - 0.5);
    expect(b.shin_R!.x).toBeLessThan(b.thigh_R!.x + 0.5);
    expect(b.shin_L!.x - b.shin_R!.x).toBeGreaterThan(60);
  });

  it('settles the body physics after a jump', () => {
    const during = rig.pose({ time: 0.65, animations: ['jump'] });
    expect(Math.abs(during.params.BustY!)).toBeGreaterThan(0.05);
    const after = rig.pose({ time: 6, animations: ['jump'] });
    expect(Math.abs(after.params.BustY!)).toBeLessThan(0.02);
    expect(Math.abs(after.params.HairX!)).toBeLessThan(0.02);
  });

  it('switches draw order and IK by parameter only (no layer is duplicated)', () => {
    expect(new Set(model.parts.map((p) => p.id)).size).toBe(model.parts.length);
  });
});

describe('puppets v2 profile walk', () => {
  const model = buildCharacter(input(SIDE));
  const rig = new Rig(model);
  const walk = model.animations.find((a) => a.id === 'walk')!;
  const speed = (walk.events![0]!.data as { speed: number }).speed;
  it('locks the planted foot to the ground and bends the knees forward', () => {
    expect(speed).toBeGreaterThan(0);
    // Left foot planted from t = 0 to 0.6: with the stage moving the character left at `speed`,
    // the foot's ground position stays put.
    const ground = (t: number) => rig.pose({ time: t, animations: ['walk'], physics: false }).bones.shin_L!.tip[0] - speed * t;
    const g0 = ground(0.05);
    for (const t of [0.15, 0.3, 0.45, 0.55]) expect(Math.abs(ground(t) - g0)).toBeLessThan(1.5);
    for (const t of [0.1, 0.4, 0.7]) {
      const b = rig.pose({ time: t, animations: ['walk'], physics: false }).bones;
      const hip = [b.thigh_L!.x, b.thigh_L!.y], knee = [b.shin_L!.x, b.shin_L!.y], ank = b.shin_L!.tip;
      // Knee in front of (left of) the hip→ankle line.
      const cross = (ank[0] - hip[0]!) * (knee[1]! - hip[1]!) - (ank[1] - hip[1]!) * (knee[0]! - hip[0]!);
      expect(cross).toBeGreaterThanOrEqual(-1);
    }
    // The feet alternate: half a cycle apart.
    const b = rig.pose({ time: 0.1, animations: ['walk'], physics: false }).bones;
    expect(Math.abs(b.shin_L!.tip[0] - b.shin_R!.tip[0])).toBeGreaterThan(20);
  });
  it('front-only motions are not compiled for a profile', () => {
    expect(model.animations.some((a) => a.id === 'armsCrossed')).toBe(false);
  });
});

describe('puppets v2 retargeting', () => {
  it('scales locomotion with leg length and keeps gesture angles', () => {
    // A long-legged variant: everything below the pelvis stretched by 1.3.
    const stretch = (p: P): P => (p[1] > 430 ? [p[0], 430 + (p[1] - 430) * 1.3] : p);
    const tall = Object.fromEntries(Object.entries(SIDE).map(([k, v]) => [k, Array.isArray(v) ? stretch(v as P) : v])) as Keypoints;
    const a = buildSkeleton(SIDE).bones, b = buildSkeleton(tall).bones;
    const pa = proportions(a), pb = proportions(b);
    const wa = compileMotions(MOTIONS, a, pa, 'side').find((m) => m.id === 'walk')!;
    const wb = compileMotions(MOTIONS, b, pb, 'side').find((m) => m.id === 'walk')!;
    const span = (w: typeof wa) => { const k = w.tracks.find((t) => t.target === 'bone:footTarget_L.x')!.keys.map((x) => x.v as number); return Math.max(...k) - Math.min(...k); };
    expect(span(wb) / span(wa)).toBeCloseTo(pb.leg / pa.leg, 2);
    const fa = compileMotions(MOTIONS, buildSkeleton(FRONT).bones, proportions(buildSkeleton(FRONT).bones));
    const elbow = fa.find((m) => m.id === 'wave_L')!.tracks.find((t) => t.target === 'bone:forearm_L.rotation')!;
    expect(elbow.keys.map((k) => k.v)).toContain(-75);
  });
  it('mirrors a motion to the other side', () => {
    const wave = MOTIONS.find((m) => m.id === 'wave_L')!;
    const r = mirrorMotion(wave);
    expect(r.id).toBe('wave_R');
    const aim = r.tracks.find((t) => t.kind === 'aim')!;
    expect(aim.kind === 'aim' && aim.bone).toBe('upperarm_R');
    expect(aim.keys[0]![1]).toBeCloseTo(-140);
  });
});

describe('puppets v2 story cues', async () => {
  const { emoteCue, poseMotion, hiddenParts } = await import('../src/puppet2/story.js');
  it('maps story emotes and poses onto library motions, and nothing else', () => {
    const ids = new Set(MOTIONS.map((m) => m.id));
    expect(emoteCue('wave')).toEqual({ kind: 'gesture', motion: 'wave_L' });
    expect(emoteCue('dance')).toBeNull();
    for (const k of ['wave', 'nod', 'bow', 'cheer', 'surprised', 'point', 'angry']) { const c = emoteCue(k)!; expect(c.kind === 'walk' || ids.has(c.motion)).toBe(true); }
    expect(poseMotion('idle_confident')).toBe('handsOnHips');
    expect(poseMotion('sit')).toBe('idle');
  });
  it('wears one outfit at a time and shows adult layers only undressed', () => {
    const parts = [{ id: 'body' }, { id: 'nude', adult: true }, { id: 'top', outfit: 'casual' }, { id: 'dress', outfit: 'formal' }];
    expect([...hiddenParts(parts, null)].sort()).toEqual(['dress', 'nude']);
    expect([...hiddenParts(parts, 'formal')].sort()).toEqual(['nude', 'top']);
    expect([...hiddenParts(parts, 'none')].sort()).toEqual(['dress', 'top']);
  });
});
