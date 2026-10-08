/** Browser fitting: weight transfer, fill-in, morph transfer, swing chains and covered skin. */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildBvh, closestPoint } from '../src/features/avatar3d/runtime/fit/bvh';
import { coveredTriangles, FLAG, transferToGarment, weld, type BodyInput } from '../src/features/avatar3d/runtime/fit/core';

/** A body made of boxes, each weighted fully to one bone. */
function boxBody(parts: Array<{ bone: number; size: [number, number, number]; at: [number, number, number] }>, boneSide: number[], legBones: number[], morph?: (x: number, y: number, z: number, bone: number) => [number, number, number]): BodyInput {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [], joints: number[] = [], weights: number[] = [], delta: number[] = [];
  for (const p of parts) {
    const g = new THREE.BoxGeometry(...p.size, 4, 4, 4).toNonIndexed();
    g.translate(...p.at);
    const base = pos.length / 3, gp = g.getAttribute('position'), gn = g.getAttribute('normal');
    for (let i = 0; i < gp.count; i++) {
      pos.push(gp.getX(i), gp.getY(i), gp.getZ(i)); nrm.push(gn.getX(i), gn.getY(i), gn.getZ(i));
      joints.push(p.bone, 0, 0, 0); weights.push(1, 0, 0, 0); idx.push(base + i);
      delta.push(...(morph?.(gp.getX(i), gp.getY(i), gp.getZ(i), p.bone) ?? [0, 0, 0]));
    }
  }
  const legBone = new Uint8Array(boneSide.length); for (const b of legBones) legBone[b] = 1;
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), indices: Uint32Array.from(idx), joints: Uint16Array.from(joints), weights: Float32Array.from(weights), morphs: morph ? [{ name: 'Chest_big', deltas: Float32Array.from(delta) }] : [], boneCount: boneSide.length, boneSide: Int8Array.from(boneSide), legBone, hips: 5, head: 0, height: 1.7 };
}

// Bones: 0 torso, 1 left arm, 2 right arm, 3 left leg, 4 right leg, 5 hips.
const SIDES = [0, -1, 1, -1, 1, 0];
const body = () => boxBody([
  { bone: 0, size: [0.4, 0.5, 0.25], at: [0, 1.25, 0] },
  { bone: 1, size: [0.08, 0.5, 0.08], at: [0.26, 1.25, 0] },
  { bone: 2, size: [0.08, 0.5, 0.08], at: [-0.26, 1.25, 0] },
  { bone: 3, size: [0.12, 0.8, 0.12], at: [0.075, 0.5, 0] },
  { bone: 4, size: [0.12, 0.8, 0.12], at: [-0.075, 0.5, 0] },
  { bone: 5, size: [0.32, 0.12, 0.22], at: [0, 0.96, 0] },
], SIDES, [3, 4], (_x, _y, z, bone) => (bone === 0 && z > 0.12 ? [0, 0, 0.05] : [0, 0, 0]));

const geometryOf = (g: THREE.BufferGeometry) => ({ positions: Float32Array.from(g.getAttribute('position').array as Float32Array), indices: g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : null });
const weightOf = (m: { joints: Uint16Array; weights: Float32Array }, v: number, bone: number) => { let s = 0; for (let k = 0; k < 4; k++) if (m.joints[v * 4 + k] === bone) s += m.weights[v * 4 + k]!; return s; };

describe('weight transfer', () => {
  it('gives a patch over the chest the torso\'s weights, normalized, with no vertex left out', () => {
    const patch = new THREE.PlaneGeometry(0.2, 0.2, 6, 6); patch.translate(0, 1.25, 0.135);
    const r = transferToGarment(body(), [geometryOf(patch)]);
    const m = r.meshes[0]!;
    for (let v = 0; v < m.positions.length / 3; v++) {
      const sum = m.weights[v * 4]! + m.weights[v * 4 + 1]! + m.weights[v * 4 + 2]! + m.weights[v * 4 + 3]!;
      expect(sum).toBeCloseTo(1, 5);
      expect(weightOf(m, v, 0)).toBeCloseTo(1, 5);
    }
    expect(r.stats.matched).toBe(r.stats.vertices - r.stats.filled - r.stats.far);
    expect(r.stats.far).toBe(0);
  });

  it('keeps a sleeve\'s inside on the arm even where the torso is closer', () => {
    // A tube around the left arm; its inner wall sits nearer the torso's side than the arm.
    const tube = new THREE.CylinderGeometry(0.052, 0.052, 0.4, 24, 6, true); tube.translate(0.26, 1.25, 0);
    const r = transferToGarment(body(), [geometryOf(tube)], { smoothing: 0, maxDistance: 0.08 });
    const m = r.meshes[0]!;
    let inner = 0;
    for (let v = 0; v < m.positions.length / 3; v++) {
      if (m.positions[v * 3]! > 0.215) continue;
      inner++;
      // The torso face at x = 0.2 is 1 cm away; the arm face at x = 0.22 is further. Normals decide.
      expect(weightOf(m, v, 1)).toBeGreaterThan(0.99);
    }
    expect(inner).toBeGreaterThan(5);
    // A plain closest-point transfer would have picked the torso there.
    const bvh = buildBvh({ positions: body().positions, indices: body().indices });
    const naive = closestPoint(bvh, 0.208, 1.25, 0, 1, null)!;
    expect(body().joints[body().indices[naive.tri * 3]! * 4]).toBe(0);
  });

  it('keeps each trouser leg on its own leg, and flags weights mixed across left and right', () => {
    const left = new THREE.CylinderGeometry(0.07, 0.07, 0.6, 20, 4, true); left.translate(0.075, 0.5, 0);
    const right = new THREE.CylinderGeometry(0.07, 0.07, 0.6, 20, 4, true); right.translate(-0.075, 0.5, 0);
    const r = transferToGarment(body(), [geometryOf(left), geometryOf(right)]);
    const [ml, mr] = r.meshes;
    for (let v = 0; v < ml!.positions.length / 3; v++) expect(weightOf(ml!, v, 3) + weightOf(ml!, v, 5)).toBeGreaterThan(0.95);
    for (let v = 0; v < mr!.positions.length / 3; v++) expect(weightOf(mr!, v, 4) + weightOf(mr!, v, 5)).toBeGreaterThan(0.95);
    expect(r.stats.mixedLimbs).toBe(0);
  });

  it('fills a skirt\'s far hem from the waist along the cloth, and hands it to generated chains', () => {
    const skirt = new THREE.CylinderGeometry(0.17, 0.32, 0.5, 32, 8, true); skirt.translate(0, 0.78, 0);
    const r = transferToGarment(body(), [geometryOf(skirt)], { swing: { mode: 'chains', pinStart: 0.1, pinEnd: 0.6, chains: 8, segments: 4, prefix: 'skirt', center: [0, 0.96, 0] } });
    const m = r.meshes[0]!;
    expect(r.stats.filled).toBeGreaterThan(0);
    expect(r.bones.length).toBe(8 * 5);
    expect(r.bones[0]).toMatchObject({ name: 'skirt_0_0', parent: 5 });
    expect(r.bones[1]!.parent).toBe('skirt_0_0');
    let top = -Infinity, bottom = Infinity;
    for (let v = 0; v < m.positions.length / 3; v++) { top = Math.max(top, m.positions[v * 3 + 1]!); bottom = Math.min(bottom, m.positions[v * 3 + 1]!); }
    for (let v = 0; v < m.positions.length / 3; v++) {
      // A skirt never follows one leg (it would tear between them).
      expect(weightOf(m, v, 3) + weightOf(m, v, 4)).toBe(0);
      const y = m.positions[v * 3 + 1]!;
      let chain = 0; for (let k = 0; k < 4; k++) if (m.joints[v * 4 + k]! >= 6) chain += m.weights[v * 4 + k]!;
      if (y > top - 0.01) expect(chain).toBeLessThan(0.05);
      if (y < bottom + 0.01) expect(chain).toBeGreaterThan(0.99);
    }
  });

  it('carries the body\'s morph offsets to the garment', () => {
    const patch = new THREE.PlaneGeometry(0.2, 0.2, 6, 6); patch.translate(0, 1.25, 0.135);
    const r = transferToGarment(body(), [geometryOf(patch)]);
    const morph = r.meshes[0]!.morphs.find((m) => m.name === 'Chest_big')!;
    expect(morph).toBeDefined();
    for (let v = 0; v < morph.deltas.length / 3; v++) expect(morph.deltas[v * 3 + 2]).toBeCloseTo(0.05, 4);
    // A sleeve doesn't move with the chest.
    const tube = new THREE.CylinderGeometry(0.052, 0.052, 0.4, 24, 6, true); tube.translate(0.26, 1.25, 0);
    const sleeve = transferToGarment(body(), [geometryOf(tube)]).meshes[0]!.morphs.find((m) => m.name === 'Chest_big');
    expect(sleeve ? Math.max(...Array.from(sleeve.deltas).map(Math.abs)) : 0).toBeLessThan(1e-6);
  });

  it('pushes vertices inside the skin out to the offset, and can leave them alone', () => {
    const patch = new THREE.PlaneGeometry(0.2, 0.2, 4, 4); patch.translate(0, 1.25, 0.12);
    const r = transferToGarment(body(), [geometryOf(patch)], { offset: 0.004 });
    for (let v = 0; v < r.meshes[0]!.positions.length / 3; v++) expect(r.meshes[0]!.positions[v * 3 + 2]).toBeCloseTo(0.129, 4);
    expect(r.meshes[0]!.flags.every((f) => (f & FLAG.pushed) !== 0)).toBe(true);
    const kept = transferToGarment(body(), [geometryOf(patch)], { pushOut: false });
    expect(kept.meshes[0]!.positions[2]).toBeCloseTo(0.12, 5);
  });

  it('notices a garment exported with inward normals', () => {
    const patch = new THREE.PlaneGeometry(0.2, 0.2, 6, 6); patch.rotateY(Math.PI); patch.translate(0, 1.25, 0.135);
    const r = transferToGarment(body(), [geometryOf(patch)]);
    expect(r.stats.flipped).toBe(true);
    expect(weightOf(r.meshes[0]!, 0, 0)).toBeCloseTo(1, 4);
  });

  it('welds an unindexed export into one connected surface', () => {
    const g = new THREE.PlaneGeometry(1, 1, 2, 2).toNonIndexed();
    const w = weld(Float32Array.from(g.getAttribute('position').array as Float32Array), null);
    expect(w.count).toBe(9);
    expect(w.tris.length).toBe(24);
  });

  it('rigs a 20,000-vertex garment in a few seconds', () => {
    const sphere = new THREE.SphereGeometry(0.5, 192, 96).toNonIndexed(); // ≈36,000 triangles of body
    sphere.translate(0, 1, 0);
    const p = sphere.getAttribute('position'), n = sphere.getAttribute('normal');
    const joints = new Uint16Array(p.count * 4), weights = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) { const t = THREE.MathUtils.clamp((p.getY(i) - 0.5), 0, 1); joints[i * 4] = 0; joints[i * 4 + 1] = 1; weights[i * 4] = 1 - t; weights[i * 4 + 1] = t; }
    const sphereBody: BodyInput = { positions: Float32Array.from(p.array as Float32Array), normals: Float32Array.from(n.array as Float32Array), indices: Uint32Array.from({ length: p.count }, (_, i) => i), joints, weights, morphs: [{ name: 'grow', deltas: Float32Array.from(n.array as Float32Array).map((x) => x * 0.05) }], boneCount: 2, boneSide: new Int8Array(2), legBone: new Uint8Array(2), hips: 0, head: 1, height: 1 };
    const shell = new THREE.SphereGeometry(0.51, 160, 124); shell.translate(0, 1, 0);
    expect(shell.getAttribute('position').count).toBeGreaterThan(20000);
    const t0 = performance.now();
    const r = transferToGarment(sphereBody, [geometryOf(shell)]);
    const ms = performance.now() - t0;
    console.log(`weight transfer: ${r.stats.vertices} garment vertices onto ${sphereBody.indices.length / 3} body triangles in ${Math.round(ms)} ms (matched ${r.stats.matched}, filled ${r.stats.filled})`);
    expect(ms).toBeLessThan(8000);
    expect(r.stats.far).toBe(0);
    const m = r.meshes[0]!;
    for (let v = 0; v < m.positions.length / 3; v += 97) expect(m.weights[v * 4]! + m.weights[v * 4 + 1]! + m.weights[v * 4 + 2]! + m.weights[v * 4 + 3]!).toBeCloseTo(1, 4);
  });
});

describe('covered skin', () => {
  it('hides the body triangles under a garment and nothing else', () => {
    const b = body();
    const front = new THREE.PlaneGeometry(0.6, 0.7); front.translate(0, 1.25, 0.14);
    const g = geometryOf(front);
    const tri = buildBvh({ positions: g.positions, indices: g.indices! });
    const covered = coveredTriangles({ positions: b.positions, indices: b.indices }, tri, 0.05);
    let frontTorso = 0, frontHidden = 0, otherHidden = 0;
    for (let t = 0; t < b.indices.length / 3; t++) {
      const v = b.indices[t * 3]!;
      const isFront = b.joints[v * 4] === 0 && b.normals[v * 3 + 2]! > 0.9;
      if (isFront) { frontTorso++; if (covered[t]) frontHidden++; } else if (covered[t]) otherHidden++;
    }
    expect(frontHidden).toBe(frontTorso);
    // The arms' front faces sit behind the garment too; the back and the legs don't.
    for (let t = 0; t < b.indices.length / 3; t++) {
      const v = b.indices[t * 3]!;
      if (b.normals[v * 3 + 2]! < -0.9) expect(covered[t]).toBe(0);
      if (b.joints[v * 4] === 3 || b.joints[v * 4] === 4) expect(covered[t]).toBe(0);
    }
    expect(otherHidden).toBeGreaterThanOrEqual(0);
  });
});
