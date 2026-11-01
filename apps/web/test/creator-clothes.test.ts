import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { expect, it } from 'vitest';
import { buildClothes } from '../src/features/avatar3d/creator/clothes';
import { ROOT } from './helpers3d';
import { parseGlb, writeGlb } from '../../server/src/services/avatars/glb';

it('transfers body shape changes to a dress skirt as well as its fitted bodice', async () => {
  const fixture = parseGlb(readFileSync(new URL('apps/web/public/avatar/bases/anime-f.glb', ROOT)));
  // Geometry-only regression: avoid the browser image decoder in this Node test.
  fixture.json.materials = [{}];
  for (const mesh of fixture.json.meshes ?? []) for (const primitive of mesh.primitives) primitive.material = 0;
  const bytes = writeGlb(fixture);
  const scene = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
  const body = scene.getObjectByName('Body') as THREE.SkinnedMesh;
  const count = body.geometry.getAttribute('position').count;
  // A uniform shape change must transfer exactly regardless of triangle tessellation.
  const delta = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) delta.set([.1, .2, .3], i * 3);
  body.geometry.morphAttributes.position = [new THREE.BufferAttribute(delta, 3)];
  body.morphTargetDictionary = { shift: 0 };
  body.morphTargetInfluences = [.75];
  const clothes = buildClothes(body, [{ template: 'dress', color: '#506080', accent: '#ffffff', pattern: 'plain', texture: null }], new Map());
  expect(clothes).toHaveLength(2);
  for (const mesh of clothes) {
    expect(mesh.morphTargetInfluences).toEqual([.75]);
    expect(mesh.morphTargetDictionary).toEqual({ shift: 0 });
    const morph = mesh.geometry.morphAttributes.position![0]!;
    expect(morph.count).toBe(mesh.geometry.getAttribute('position').count);
    for (let i = 0; i < morph.count; i++) {
      expect(morph.getX(i)).toBeCloseTo(.1);
      expect(morph.getY(i)).toBeCloseTo(.2);
      expect(morph.getZ(i)).toBeCloseTo(.3);
    }
  }
});
