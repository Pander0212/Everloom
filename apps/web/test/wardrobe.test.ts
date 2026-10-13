import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AvatarConfigSchema, regionMask, resolveWardrobe } from '@everloom/engine';
import { loadModel } from '../src/features/avatar3d/runtime/loader';
import { Wardrobe } from '../src/features/avatar3d/runtime/wardrobe';
import { ROOT } from './helpers3d';

const buf = () => {
  const b = readFileSync(new URL('tests/fixtures/avatars/models/dressed.glb', ROOT));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const cfg = AvatarConfigSchema.parse({
  body: ['Mannequin_F'],
  parts: [
    { id: 'jacket', name: 'Jacket', meshes: ['Jacket'], hides: ['chest', 'belly', 'upperArms'] },
    { id: 'hat', name: 'Hat', meshes: ['Hat'], on: false, items: ['Red Hat'] },
  ],
});
/** Empty triangles over all the meshes under a node (a node with two materials holds two meshes). */
const degenerate = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((x) => {
    const m = x as THREE.Mesh;
    if (!m.isMesh || !m.geometry.index) return;
    const a = m.geometry.index.array;
    for (let i = 0; i < a.length; i += 3) if (a[i] === a[i + 1] && a[i] === a[i + 2]) n++;
  });
  return n;
};
const triangles = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((x) => (x as THREE.Mesh).isMesh && (n += ((x as THREE.Mesh).geometry.index?.count ?? 0) / 3));
  return n;
};

describe('wardrobe on a model', () => {
  it('shows parts, hides the skin they cover, and gives it back', async () => {
    const model = await loadModel(buf(), null);
    const body = model.scene.getObjectByName('Mannequin_F')!;
    const hat = model.scene.getObjectByName('Hat')!;
    const w = new Wardrobe(model, cfg.body);
    expect(w.hasBody).toBe(true);
    const total = triangles(body);

    const on = resolveWardrobe(cfg);
    w.apply(cfg, on, regionMask(on.hidden));
    expect(hat.visible).toBe(false);
    const hiddenWithJacket = degenerate(body);
    // The torso and upper arms are a real share of the body, but not most of it.
    expect(hiddenWithJacket / total).toBeGreaterThan(0.1);
    expect(hiddenWithJacket / total).toBeLessThan(0.6);

    // The hat item puts the hat on; taking the jacket off shows the skin again.
    const off = resolveWardrobe({ ...cfg, parts: cfg.parts.map((p) => (p.id === 'jacket' ? { ...p, on: false } : p)) }, { equipped: ['red hat'] });
    w.apply(cfg, off, regionMask(off.hidden));
    expect(hat.visible).toBe(true);
    expect(model.scene.getObjectByName('Jacket')!.visible).toBe(false);
    expect(degenerate(body)).toBe(0);

    w.apply(cfg, on, regionMask(on.hidden));
    w.dispose();
    expect(degenerate(body)).toBe(0);
  });
});

it('toggles a clothing material without hiding another mesh sharing that material, and restores it', async () => {
  const model = await loadModel(buf(), null);
  const jacket = model.scene.getObjectByName('Jacket')!;
  const meshes: THREE.Mesh[] = [];
  jacket.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const original = Array.isArray(meshes[0]!.material) ? meshes[0]!.material[0]! : meshes[0]!.material;
  original.name = 'JacketFabric';
  const other = new THREE.Mesh(new THREE.BoxGeometry(), original);
  other.name = 'OtherPiece'; model.scene.add(other);
  const config = AvatarConfigSchema.parse({ parts: [{ id: 'fabric', name: 'Fabric', meshes: ['Jacket'], materialSlots: [{ mesh: 'Jacket', slot: 0, material: 'JacketFabric' }] }] });
  const wardrobe = new Wardrobe(model, []);
  const on = resolveWardrobe(config), off = { ...on, parts: { fabric: false } };
  wardrobe.apply(config, off, 0);
  const material = Array.isArray(meshes[0]!.material) ? meshes[0]!.material[0]! : meshes[0]!.material;
  expect(material.visible).toBe(false);
  expect(other.material.visible).toBe(true);
  expect(jacket.visible).toBe(true);
  wardrobe.apply(config, on, 0);
  expect(material.visible).toBe(true);
  wardrobe.dispose();
});

it('body-hiding shapes follow message-bound parts and restore manual sliders on rollback', async () => {
  const { bodyWeights } = await import('../src/features/avatar3d/runtime/wardrobe');
  const config = AvatarConfigSchema.parse({ parts: [{ id: 'shirt', name: 'Shirt', meshes: ['shirt'], hideMorphs: [{ morph: 'Hide_Shirt', weight: 1 }] }] });
  expect(bodyWeights(config, { partState: { shirt: true } }).Hide_Shirt).toBe(1);
  expect(bodyWeights(config, { partState: { shirt: false } }).Hide_Shirt).toBe(0);
  expect(bodyWeights(config, { partState: { shirt: true } }).Hide_Shirt).toBe(1);
});
