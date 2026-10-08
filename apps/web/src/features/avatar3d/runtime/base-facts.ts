/** What a loaded model has, for the base-model check (see `baseReport` in the engine). */
import * as THREE from 'three';
import type { BaseFacts, HumanBone } from '@everloom/engine';
import type { LoadedModel } from './loader';

const CHAIN = /hair|skirt|tail|ribbon|cape|breast|bust|boob|booty|butt|sec_|ponytail|braid|bang|chain|髪|胸/i;

/** Morph names that come from the file (not the generated adjusters, not VRM expression ids). */
export const fileMorphs = (model: LoadedModel) => model.morphNames.filter((n) => !n.startsWith('EverloomBody_') && !n.startsWith('vrm:'));

export function baseFacts(model: LoadedModel): BaseFacts {
  const mapped: Partial<Record<HumanBone, string>> = {};
  for (const [k, o] of Object.entries(model.bones)) if (o) mapped[k as HumanBone] = o.name;
  const mappedSet = new Set(Object.values(model.bones));
  const extraBones = (model.rigBones ?? []).map((b) => b.name).filter((n) => CHAIN.test(n));
  let vertices = 0, triangles = 0, skinned = 0, hasUv = false;
  const unskinned: string[] = [];
  const textures = new Map<string, { name: string; width: number; height: number }>();
  for (const m of model.meshes) {
    if (/^garment:/.test(m.parent?.name ?? '')) continue;
    const g = m.geometry;
    const n = g.getAttribute('position')?.count ?? 0;
    vertices += n;
    triangles += (g.index?.count ?? n) / 3;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh && g.getAttribute('skinWeight')) skinned++;
    else unskinned.push(m.name || 'unnamed');
    if (g.getAttribute('uv')) hasUv = true;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      // Toon materials keep their maps behind accessors, which Object.values doesn't list.
      const named = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'shadeMultiplyTexture'].map((k) => (mat as unknown as Record<string, unknown>)[k]);
      for (const value of [...Object.values(mat), ...named]) {
        const t = value as THREE.Texture | null;
        if (!t?.isTexture || textures.has(t.uuid)) continue;
        const img = t.image as { width?: number; height?: number } | undefined;
        const mip = (t as THREE.CompressedTexture).mipmaps?.[0] as { width?: number; height?: number } | undefined;
        textures.set(t.uuid, { name: t.name || mat.name, width: img?.width ?? mip?.width ?? 0, height: img?.height ?? mip?.height ?? 0 });
      }
    }
  }
  return { mapped, boneCount: (model.rigBones ?? []).length || mappedSet.size, extraBones, morphs: fileMorphs(model), meshes: model.meshes.length, skinnedMeshes: skinned, unskinned, vertices, triangles: Math.round(triangles), textures: [...textures.values()], hasUv, height: model.height, autoFit: model.autoFit };
}
