/** Spring chains: bone length held, colliders respected, fixed steps, strength and rest. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { closestOnSegment, makeCollider, pushOut, SpringSolver } from '../src/features/avatar3d/runtime/physics/solver';

/** A chain of bones hanging from a root, pointing +X at rest (like hair blown sideways). */
function chain(n: number, length = 0.1) {
  const root = new THREE.Bone(); root.name = 'root';
  const scene = new THREE.Group(); scene.add(root);
  const bones: THREE.Bone[] = [];
  let parent: THREE.Object3D = root;
  for (let i = 0; i < n; i++) {
    const b = new THREE.Bone(); b.name = `b${i}`;
    b.position.set(i === 0 ? 0 : length, 0, 0);
    parent.add(b); bones.push(b); parent = b;
  }
  const tip = new THREE.Bone(); tip.name = 'tip'; tip.position.set(length, 0, 0); parent.add(tip); bones.push(tip);
  scene.updateMatrixWorld(true);
  return { scene, root, bones };
}
const world = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

describe('spring solver', () => {
  it('keeps every bone its length while gravity pulls the chain down', () => {
    const { bones, scene } = chain(4);
    const s = new SpringSolver();
    s.addChain(bones, { stiffness: 0, gravity: 3, drag: 0.4 }, []);
    for (let i = 0; i < 240; i++) s.update(1 / 60);
    scene.updateMatrixWorld(true);
    for (let i = 0; i < bones.length - 1; i++) expect(world(bones[i]!).distanceTo(world(bones[i + 1]!))).toBeCloseTo(0.1, 4);
    // It has swung down.
    expect(world(bones[bones.length - 1]!).y).toBeLessThan(-0.25);
  });

  it('springs back toward rest when stiff and nothing pulls', () => {
    const { bones, scene } = chain(2);
    const s = new SpringSolver();
    s.addChain(bones, { stiffness: 6, gravity: 0, drag: 0.5 }, []);
    // Knock it, then let it settle.
    bones[0]!.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.8);
    scene.updateMatrixWorld(true);
    s.reset();
    for (let i = 0; i < 600; i++) s.update(1 / 60);
    scene.updateMatrixWorld(true);
    expect(world(bones[2]!).y).toBeCloseTo(0, 2);
  });

  it('never lets a tail into a sphere or a capsule, and slides it round instead', () => {
    const { bones, scene, root } = chain(3);
    const ball = makeCollider(root, 0.08, new THREE.Vector3(0.15, -0.1, 0));
    const bar = makeCollider(root, 0.03, new THREE.Vector3(0.05, -0.22, -0.2), new THREE.Vector3(0.05, -0.22, 0.2));
    const s = new SpringSolver();
    s.addChain(bones, { stiffness: 0, gravity: 3, drag: 0.3, radius: 0.01 }, [ball, bar]);
    for (let i = 0; i < 300; i++) {
      s.update(1 / 60);
      for (const t of s.tails()) {
        expect(t.distanceTo(ball.worldA)).toBeGreaterThan(0.08 + 0.01 - 1e-4);
        expect(t.distanceTo(closestOnSegment(t, bar.worldA, bar.worldB, new THREE.Vector3()))).toBeGreaterThan(0.03 + 0.01 - 1e-4);
      }
    }
    scene.updateMatrixWorld(true);
    for (let i = 0; i < bones.length - 1; i++) expect(world(bones[i]!).distanceTo(world(bones[i + 1]!))).toBeCloseTo(0.1, 3);
  });

  it('steps at a fixed rate: the same result at 30 and 144 frames a second', () => {
    const run = (fps: number) => {
      const { bones, scene } = chain(3);
      const s = new SpringSolver();
      s.addChain(bones, { stiffness: 0.5, gravity: 1, drag: 0.4 }, []);
      for (let t = 0; t < 2; t += 1 / fps) s.update(1 / fps);
      scene.updateMatrixWorld(true);
      return world(bones[3]!);
    };
    expect(run(30).distanceTo(run(144))).toBeLessThan(0.01);
  });

  it('caps simulated points and leaves the rest as animated', () => {
    const { bones } = chain(6);
    const s = new SpringSolver();
    s.maxPoints = 3;
    s.addChain(bones, {}, []);
    expect(s.size).toBe(3);
    // Six bones and the tip: the last four stay as animated.
    expect(s.dropped).toBe(4);
  });

  it('strength 0 holds the rest pose (the chest off switch); rest() resets everything', () => {
    const { bones, scene } = chain(1);
    const s = new SpringSolver();
    const id = s.addChain(bones, { stiffness: 0, gravity: 5, strength: 0 }, []);
    for (let i = 0; i < 60; i++) s.update(1 / 60);
    expect(bones[0]!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    s.setChainSettings(id, { strength: 1 });
    for (let i = 0; i < 60; i++) s.update(1 / 60);
    expect(bones[0]!.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.3);
    s.rest();
    scene.updateMatrixWorld(true);
    expect(bones[0]!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  });

  it('limits how far a joint may turn', () => {
    const { bones } = chain(1);
    const s = new SpringSolver();
    s.addChain(bones, { stiffness: 0, gravity: 5, maxAngle: THREE.MathUtils.degToRad(15) }, []);
    for (let i = 0; i < 120; i++) s.update(1 / 60);
    expect(THREE.MathUtils.radToDeg(bones[0]!.quaternion.angleTo(new THREE.Quaternion()))).toBeLessThan(15.5);
  });

  it('keeps contact a chain starts in (hair on the shoulders) instead of flinging it out, and stops it going deeper', () => {
    // A strand hanging straight down whose middle rests 2 cm inside a shoulder capsule.
    const root = new THREE.Bone(); const scene = new THREE.Group(); scene.add(root);
    const bones: THREE.Bone[] = [];
    let parent: THREE.Object3D = root;
    for (let i = 0; i < 4; i++) { const b = new THREE.Bone(); b.position.set(0, i === 0 ? 0 : -0.1, 0); parent.add(b); bones.push(b); parent = b; }
    const shoulder = makeCollider(root, 0.05, new THREE.Vector3(0.04, -0.1, -0.2), new THREE.Vector3(0.04, -0.1, 0.2));
    scene.updateMatrixWorld(true);
    const s = new SpringSolver();
    s.addChain(bones, { stiffness: 1, gravity: 0.15, drag: 0.4, radius: 0.01 }, [shoulder]);
    const restDeep = 0.05 + 0.01 - 0.04;
    for (let i = 0; i < 240; i++) {
      s.update(1 / 60);
      for (const t of s.tails()) expect(t.distanceTo(closestOnSegment(t, shoulder.worldA, shoulder.worldB, new THREE.Vector3()))).toBeGreaterThan(0.05 + 0.01 - restDeep - 1e-3);
    }
    // It hangs as it was made: no bone has turned away from the shoulder.
    for (const b of bones) expect(THREE.MathUtils.radToDeg(b.quaternion.angleTo(new THREE.Quaternion()))).toBeLessThan(2);
    // A strand that starts clear is still pushed out fully when something moves into it.
    const free = chain(3);
    const ball = makeCollider(free.root, 0.08, new THREE.Vector3(0.15, -0.1, 0));
    const s2 = new SpringSolver();
    s2.addChain(free.bones, { stiffness: 0, gravity: 3, drag: 0.3, radius: 0.01 }, [ball]);
    for (let i = 0; i < 200; i++) { s2.update(1 / 60); for (const t of s2.tails()) expect(t.distanceTo(ball.worldA)).toBeGreaterThan(0.09 - 1e-4); }
  });

  it('pushes a point out of a capsule along the shortest way', () => {
    const root = new THREE.Bone();
    const c = makeCollider(root, 0.1, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    c.worldA.set(0, 0, 0); c.worldB.set(0, 1, 0);
    const p = new THREE.Vector3(0.05, 0.5, 0);
    expect(pushOut(p, c, 0)).toBe(true);
    expect(p.x).toBeCloseTo(0.1, 6);
    expect(p.y).toBeCloseTo(0.5, 6);
    expect(pushOut(p.set(0.3, 0.5, 0), c, 0)).toBe(false);
  });
});

describe('skirt chains between legs', () => {
  it('slide around leg capsules that move apart instead of passing through them', () => {
    // Two chains hanging from the hips at the front-left and front-right; legs swing out sideways.
    const hips = new THREE.Bone(); hips.name = 'hips';
    const scene = new THREE.Group(); scene.add(hips);
    const legL = new THREE.Bone(); legL.position.set(0.09, 0, 0); hips.add(legL);
    const legR = new THREE.Bone(); legR.position.set(-0.09, 0, 0); hips.add(legR);
    const make = (x: number) => {
      const a = new THREE.Bone(); a.position.set(x, 0, 0.12); hips.add(a);
      const b = new THREE.Bone(); b.position.set(0, -0.2, 0); a.add(b);
      const c = new THREE.Bone(); c.position.set(0, -0.2, 0); b.add(c);
      return [a, b, c];
    };
    const left = make(0.07), right = make(-0.07);
    const capL = makeCollider(legL, 0.07, new THREE.Vector3(), new THREE.Vector3(0, -0.45, 0), 'leftUpperLeg');
    const capR = makeCollider(legR, 0.07, new THREE.Vector3(), new THREE.Vector3(0, -0.45, 0), 'rightUpperLeg');
    scene.updateMatrixWorld(true);
    const s = new SpringSolver();
    s.addChain(left, { stiffness: 1, gravity: 0.4, drag: 0.5, radius: 0.01 }, [capL, capR]);
    s.addChain(right, { stiffness: 1, gravity: 0.4, drag: 0.5, radius: 0.01 }, [capL, capR]);
    for (let i = 0; i < 120; i++) {
      // A stride: legs swing forward and apart.
      const t = i / 60;
      legL.rotation.set(-0.6 * Math.sin(t * 3), 0, 0.3 * Math.sin(t * 2));
      legR.rotation.set(0.6 * Math.sin(t * 3), 0, -0.3 * Math.sin(t * 2));
      scene.updateMatrixWorld(true);
      s.update(1 / 60);
      for (const p of s.tails()) {
        for (const c of [capL, capR]) expect(p.distanceTo(closestOnSegment(p, c.worldA, c.worldB, new THREE.Vector3()))).toBeGreaterThan(0.07 + 0.01 - 1e-3);
      }
    }
    // The cloth between the chains is interpolated, never weighted to a leg: the chains' bone lengths stay put.
    scene.updateMatrixWorld(true);
    for (const ch of [left, right]) for (let i = 0; i < 2; i++) expect(world(ch[i]!).distanceTo(world(ch[i + 1]!))).toBeCloseTo(0.2, 3);
  });
});
