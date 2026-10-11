/** Paired animations: two-bone IK reaches, keeps lengths and blends; contact timing; placement by height. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PAIRED, PairedClipSchema } from '@everloom/engine';
import { solveTwoBone } from '../src/features/avatar3d/runtime/ik';
import { contactWeight, PairedDirector, placements } from '../src/features/avatar3d/runtime/paired';

/** Shoulder at the origin, a 0.3 upper arm and 0.25 forearm along +X, elbow slightly bent. */
function arm() {
  const scene = new THREE.Group();
  const root = new THREE.Bone(), mid = new THREE.Bone(), end = new THREE.Bone();
  scene.add(root); root.add(mid); mid.add(end);
  mid.position.set(0.3, 0, 0);
  end.position.set(0.25, 0, 0);
  mid.rotation.y = -0.2;
  scene.updateMatrixWorld(true);
  return { scene, root, mid, end };
}
const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

describe('two-bone IK', () => {
  it('puts the hand on a reachable target and keeps both bone lengths', () => {
    const { root, mid, end } = arm();
    for (const target of [new THREE.Vector3(0.2, -0.3, 0.2), new THREE.Vector3(0.1, 0.35, -0.1), new THREE.Vector3(0.45, 0, 0.1)]) {
      const miss = solveTwoBone(root, mid, end, target, 1);
      expect(miss).toBeLessThan(1e-3);
      expect(world(root).distanceTo(world(mid))).toBeCloseTo(0.3, 5);
      expect(world(mid).distanceTo(world(end))).toBeCloseTo(0.25, 5);
    }
  });

  it('reaches straight toward a target that is too far, without stretching', () => {
    const { root, mid, end } = arm();
    const target = new THREE.Vector3(0, 0, 2);
    solveTwoBone(root, mid, end, target, 1);
    const hand = world(end);
    expect(hand.length()).toBeLessThanOrEqual(0.55 + 1e-6);
    expect(hand.clone().normalize().dot(new THREE.Vector3(0, 0, 1))).toBeGreaterThan(0.99);
  });

  it('swings the elbow toward a pole without moving the hand off the target', () => {
    for (const poleY of [1, -1]) {
      const { root, mid, end } = arm();
      const target = new THREE.Vector3(0.35, 0, 0.15);
      const miss = solveTwoBone(root, mid, end, target, 1, new THREE.Vector3(0.2, poleY, 0));
      expect(miss).toBeLessThan(1e-3);
      expect(Math.sign(world(mid).y)).toBe(poleY);
    }
  });

  it('weight 0 leaves the pose alone and half weight lands in between', () => {
    const { root, mid, end } = arm();
    const before = world(end);
    const target = new THREE.Vector3(0.1, -0.4, 0.2);
    solveTwoBone(root, mid, end, target, 0);
    expect(world(end).distanceTo(before)).toBeLessThan(1e-9);
    const half = solveTwoBone(root, mid, end, target, 0.5);
    expect(half).toBeGreaterThan(0.01);
    expect(half).toBeLessThan(before.distanceTo(target));
  });
});

/** A T-posed stick figure facing +Z in its group (left is +X), turned by yaw and standing at x. */
function figure(x: number, yaw: number) {
  const group = new THREE.Group();
  group.position.x = x; group.rotation.y = yaw;
  const bone = (parent: THREE.Object3D, p: [number, number, number]) => { const b = new THREE.Bone(); b.position.set(...p); parent.add(b); return b; };
  const hips = bone(group, [0, 1, 0]), spine = bone(hips, [0, 0.1, 0]), chest = bone(spine, [0, 0.2, 0]);
  const bones: Record<string, THREE.Object3D> = { hips, spine, chest };
  for (const [side, s] of [['left', 1], ['right', -1]] as const) {
    const upper = bone(chest, [0.18 * s, 0.1, 0]), lower = bone(upper, [0.27 * s, 0, 0]), hand = bone(lower, [0.25 * s, 0, 0]);
    lower.rotation.y = -0.4 * s; // elbows a little bent forward
    Object.assign(bones, { [`${side}UpperArm`]: upper, [`${side}LowerArm`]: lower, [`${side}Hand`]: hand });
  }
  group.updateMatrixWorld(true);
  return { group, rig: { bones }, height: 1.7 };
}

describe('paired contacts', () => {
  const director = (avatars: ReturnType<typeof figure>[], clip: object) => {
    const stage = { pairs: null, tickers: new Set(), get: () => undefined, slotX: () => 0, pin() {}, kick() {} };
    const d = new PairedDirector(stage as never);
    (d as unknown as { run: object }).run = { clip, ids: ['a', 'b'], avatars, before: [], time: 1, started: true, spots: [], center: 0, squeeze: 0, approach: 0 };
    return d as unknown as { solveContacts(dt: number): void; contactGap: number };
  };

  it('brings two hands together between the partners', () => {
    const a = figure(-0.35, Math.PI / 2), b = figure(0.35, -Math.PI / 2);
    const d = director([a, b], { loop: false, roles: [{}, {}], contacts: [{ a: { role: 0, bone: 'rightHand' }, b: { role: 1, bone: 'rightHand' }, from: 0, to: 2 }] });
    d.solveContacts(0);
    expect(d.contactGap).toBeLessThan(0.1);
    expect(d.contactGap).toBeGreaterThan(0.05);
  });

  it('wraps hugging arms round to the partner\'s back, elbows outside', () => {
    const a = figure(-0.15, Math.PI / 2), b = figure(0.15, -Math.PI / 2);
    const contacts = (['leftHand', 'rightHand'] as const).flatMap((h) => [{ a: { role: 0, bone: h }, b: { role: 1, bone: 'upperChest' }, from: 0, to: 2 }, { a: { role: 1, bone: h }, b: { role: 0, bone: 'spine' }, from: 0, to: 2 }]);
    director([a, b], { loop: false, roles: [{}, {}], contacts }).solveContacts(0);
    for (const [me, other] of [[a, b], [b, a]] as const) {
      const back = new THREE.Vector3(0, 0, -1).applyQuaternion(other.group.quaternion);
      const otherX = other.group.position.clone();
      for (const side of ['left', 'right']) {
        // Behind the partner's front (past their middle, toward their back).
        expect(world(me.rig.bones[`${side}Hand`]!).sub(otherX).dot(back)).toBeGreaterThan(0);
        // Elbows out to the side, not across the partner's chest.
        const elbow = world(me.rig.bones[`${side}LowerArm`]!), shoulder = world(me.rig.bones[`${side}UpperArm`]!);
        const lateral = new THREE.Vector3(1, 0, 0).applyQuaternion(me.group.quaternion);
        expect(Math.sign(elbow.clone().sub(otherX).dot(lateral))).toBe(Math.sign(shoulder.clone().sub(otherX).dot(lateral)));
      }
    }
  });
});

describe('shared clock', () => {
  it('keeps every participant on the same moment through uneven frames, then hands back their own pose', () => {
    const clip = (n: number) => ({ v: 1, id: 'x', fps: 30, frames: n, loop: false, tracks: {} });
    const made = [0, 1].map((i) => ({ basePoseId: `paired_greet_${i}`, baseTime: 0, height: 1.7, group: new THREE.Group(), rig: { bones: {} }, setBase(id: string) { this.basePoseId = id; } }));
    const stage = { pairs: null as null | ((dt: number) => void), tickers: new Set(), get: (id: string) => made[Number(id)], slotX: () => 0, pin() {}, kick() {} };
    const d = new PairedDirector(stage as never);
    let ended = '';
    d.onEnd = (id) => (ended = id);
    (d as unknown as { run: object }).run = { clip: { id: 'greet', loop: false, roles: [{ clip: clip(61) }, { clip: clip(46) }], contacts: [] }, ids: ['0', '1'], avatars: made, before: ['idle', 'sit'], time: 0, started: true, spots: [{ x: 0, z: 0, yaw: 0 }, { x: 0, z: 0, yaw: 0 }], center: 0, squeeze: 0, approach: 0 };
    for (const dt of [0.016, 0.1, 0.033, 0.25, 0.016, 0.4]) {
      stage.pairs!(dt);
      expect(made[0]!.baseTime).toBe(made[1]!.baseTime);
    }
    expect(made[0]!.baseTime).toBeCloseTo(0.815, 6);
    // The longer role sets the length (2 s): it ends there, and each goes back to what it was doing.
    for (let i = 0; i < 20; i++) stage.pairs!(0.1);
    expect(ended).toBe('greet');
    expect(made.map((a) => a.basePoseId)).toEqual(['idle', 'sit']);
    expect(d.playing).toBeNull();
  });
});

describe('paired timing and placement', () => {
  it('eases contacts in and out around their window', () => {
    expect(contactWeight(0, 1, 2)).toBe(0);
    expect(contactWeight(0.85, 1, 2)).toBeGreaterThan(0);
    expect(contactWeight(0.85, 1, 2)).toBeLessThan(1);
    expect(contactWeight(1.5, 1, 2)).toBe(1);
    expect(contactWeight(2.4, 1, 2)).toBe(0);
  });

  it('spaces taller pairs further apart, centred where they stood', () => {
    const roles = [{ offset: [-0.34, 0] as [number, number], yaw: 80 }, { offset: [0.34, 0] as [number, number], yaw: -80 }];
    const short = placements({ roles } as never, [1.5, 1.5], 0.2);
    const tall = placements({ roles } as never, [1.9, 1.9], 0.2);
    expect(short[0]!.x + short[1]!.x).toBeCloseTo(0.4, 6);
    expect(tall[1]!.x - tall[0]!.x).toBeGreaterThan(short[1]!.x - short[0]!.x);
    expect(short[0]!.yaw).toBeCloseTo((80 * Math.PI) / 180, 6);
  });

  it('ships a valid file for every built-in paired clip', () => {
    for (const p of BUILTIN_PAIRED) {
      const file = PairedClipSchema.parse(JSON.parse(readFileSync(path.resolve(__dirname, `../public/avatar/clips/paired/${p.id}.json`), 'utf8')));
      expect(file.roles.length).toBe(p.participants);
      expect(file.loop).toBe(p.loop);
      expect(file.adult).toBe(false);
    }
  });
});
