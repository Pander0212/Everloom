import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GarmentSchema } from '@everloom/engine';
import { bindGarment, Garments } from '../src/features/avatar3d/runtime/garments';
import * as loader from '../src/features/avatar3d/runtime/loader';
import type { Avatar } from '../src/features/avatar3d/runtime/avatar';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bonesOf, loadGlb } from './helpers3d';

describe('garments', () => {
  for (const action of ['remove', 'dispose'] as const) it(`does not restore a pending garment after ${action}`, async () => {
    const body = (await loadGlb('tests/fixtures/avatars/models/mannequin-f.glb')).scene;
    const garmentModel = await loadGlb('tests/fixtures/avatars/models/garment-jacket.glb');
    let finish!: (model: typeof garmentModel) => void;
    const request = new Promise<typeof garmentModel>(resolve => { finish = resolve; });
    const mock = vi.spyOn(loader, 'loaderFor').mockReturnValue({ loadAsync: () => request } as unknown as GLTFLoader);
    const dispose = vi.fn(); garmentModel.scene.traverse(object => { if ((object as THREE.Mesh).isMesh) (object as THREE.Mesh).geometry.addEventListener('dispose', dispose); });
    try {
      const garments = new Garments({ model: { scene: body }, options: { physics: false } } as unknown as Avatar, null);
      const garment = GarmentSchema.parse({ id: 'jacket', name: 'Jacket', model: 'test-jacket', slot: 'outer' });
      const loading = garments.set([{ garment, variant: null }], 'pbr', false, false);
      if (action === 'remove') await garments.set([], 'pbr', false, false); else garments.dispose();
      finish(garmentModel); await loading;
      expect(body.getObjectByName('garment:jacket')).toBeUndefined();
      expect(dispose).toHaveBeenCalled();
    } finally { mock.mockRestore(); }
  });
  it('bind to the avatar skeleton: same place at rest, follow its pose, extra bones hang from it', async () => {
    const avatar = (await loadGlb('tests/fixtures/avatars/models/mannequin-f.glb')).scene as THREE.Object3D;
    const original = (await loadGlb('tests/fixtures/avatars/models/garment-jacket.glb')).scene as THREE.Object3D;
    const garment = (await loadGlb('tests/fixtures/avatars/models/garment-jacket.glb')).scene as THREE.Object3D;
    avatar.updateMatrixWorld(true);
    original.updateMatrixWorld(true);
    const { root, adopted } = bindGarment(garment, avatar, 2);
    avatar.add(root);
    avatar.updateMatrixWorld(true);
    const mesh = (m: THREE.Object3D) => {
      let out: THREE.SkinnedMesh | null = null;
      m.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && !out && (out = o as THREE.SkinnedMesh));
      return out!;
    };
    const bound = mesh(root);
    const ref = mesh(original);
    for (const s of [bound.skeleton, ref.skeleton]) s.update();
    const at = (m: THREE.SkinnedMesh, i: number) => m.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(m.matrixWorld);
    const n = bound.geometry.getAttribute('position').count;
    for (let i = 0; i < n; i += Math.ceil(n / 40)) expect(at(bound, i).distanceTo(at(ref, i))).toBeLessThan(1e-3);
    // Raise the avatar's left arm: the jacket's sleeve goes with it.
    const arm = bonesOf(avatar).leftUpperArm!;
    const sleeve = [...Array(n).keys()].reduce((best, i) => (at(ref, i).x > at(ref, best).x ? i : best), 0);
    const before = at(bound, sleeve);
    arm.rotateZ(0.8);
    avatar.updateMatrixWorld(true);
    bound.skeleton.update();
    expect(at(bound, sleeve).distanceTo(before)).toBeGreaterThan(0.05);
    expect(bound.material).toMatchObject({ polygonOffset: true, polygonOffsetFactor: -2 });
    // The garment's own bones (a tail flap) now hang from the avatar's pelvis.
    const tail = [...adopted.keys()].find((b) => /Tail_01/.test(b.name));
    if (tail) expect(tail.parent?.name).toMatch(/pelvis/i);
  });
});
