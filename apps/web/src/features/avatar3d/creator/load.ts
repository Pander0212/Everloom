import type { CharacterSpec } from '@everloom/engine';
import type { WebGLRenderer } from 'three';
import { createCharacter } from './build';
import { loadModel } from '../runtime/loader';
export async function loadCreatorModel(spec: CharacterSpec, renderer: WebGLRenderer) {
  const model = await createCharacter(spec, new Map(), null);
  let url: string | undefined;
  try {
    const glb = await model.exportGlb({ character: spec, look: 'toon' });
    url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
    return await loadModel(url, renderer);
  } finally { if (url) URL.revokeObjectURL(url); model.dispose(); }
}
