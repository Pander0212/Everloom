/** Browser entry for render-creator-thumbnails.mjs, served by the repository's Vite dev server. */
import * as THREE from 'three';
import { CharacterSpecSchema, HAIR_PRESETS, CLOTHING_TEMPLATES } from '../../packages/engine/src/avatar/character';
import { createCharacter } from '../../apps/web/src/features/avatar3d/creator/build';

export async function renderer() {
  const spec = CharacterSpecSchema.parse({});
  const model = await createCharacter(spec);
  const gl = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  gl.setSize(192, 192); gl.setPixelRatio(1); gl.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#ece8e2');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8078, 2));
  const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(1, 2, 3); scene.add(light);
  scene.add(model.root);
  const camera = new THREE.PerspectiveCamera(28, 1, .01, 20);
  const items = [...HAIR_PRESETS.map(p => ({ kind: 'hair', id: p.id })), ...CLOTHING_TEMPLATES.map(p => ({ kind: 'clothes', id: p.id }))];
  return { items, render(kind: string, id: string) {
    const next = CharacterSpecSchema.parse({});
    if (kind === 'hair') next.hair = { ...next.hair, ...HAIR_PRESETS.find(p => p.id === id)!.hair };
    else {
      next.hair = { ...next.hair, front: 'none', back: 'none', side: 'none' };
      next.clothes = [{ template: id as typeof next.clothes[number]['template'], color: '#506080', accent: '#dddddd', pattern: 'plain', texture: null }];
    }
    model.apply(next);
    // Clothing thumbnails show the garment alone on its form, without an exposed body.
    for (const [mesh] of model.sourceMaterials) mesh.visible = kind === 'hair' || mesh.name.startsWith('Clothes_');
    model.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    for (const [mesh] of model.sourceMaterials) if (mesh.visible) bounds.expandByObject(mesh);
    if (kind === 'hair') {
      const height = new THREE.Box3().setFromObject(model.body).max.y;
      camera.position.set(.08, height * .9, .95); camera.lookAt(0, height * .9, 0);
    } else {
      const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
      camera.position.set(center.x + .08, center.y, center.z + Math.max(size.x, size.y) * 2.3 + .15); camera.lookAt(center);
    }
    gl.render(scene, camera);
    return gl.domElement.toDataURL('image/png').split(',')[1]!;
  }, dispose() { model.dispose(); gl.dispose(); } };
}
