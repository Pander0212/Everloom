import type { AvatarConfig } from '@everloom/engine';
import { useState } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AvatarDetail } from '@/features/avatars/api';
import { apiFetch, exportHeaders } from '@/lib/api';
import { toastError } from '@/lib/store';
import { Button } from '@/ui';
import type { PreviewHandle } from '../Preview3D';
import { buildHuman } from '../runtime/makehuman';
import { configureMaterials } from '../runtime/materials';

export function ExportStep({ avatar, config, handle }: { avatar: AvatarDetail; config: AvatarConfig; handle: PreviewHandle | null }) {
  const [busy, setBusy] = useState(false);
  const run = async (format: 'glb' | 'vrm') => {
    if (!handle) return;
    const headers = await exportHeaders(); if (!headers) return;
    setBusy(true);
    try {
      const scene = config.makehuman ? await buildHuman(config.makehuman, undefined, config.content) : clone(handle.model.scene);
      scene.userData = { ...scene.userData, everloom: { config } };
      await configureMaterials(scene, config.materialOverrides);
      scene.traverse(o => {
        const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const kept = list.map((material, index) => ({ material, index })).filter(x => !(x.material as THREE.Material & { isOutline?: boolean }).isOutline);
        const geometry = mesh.geometry.clone(), groups = geometry.groups.map(g => ({ ...g })); geometry.clearGroups();
        for (const group of groups) { const mapped = kept.findIndex(x => x.index === (group.materialIndex ?? 0)); if (mapped >= 0) geometry.addGroup(group.start, group.count, mapped); }
        mesh.geometry = geometry;
        const portable = (material: THREE.Material) => {
          if (!(material as THREE.ShaderMaterial).isShaderMaterial) return material;
          const s = material as THREE.MeshStandardMaterial;
          return new THREE.MeshStandardMaterial({ name: material.name, color: s.color ?? 0xffffff, map: s.map ?? null, normalMap: s.normalMap ?? null, transparent: s.transparent, opacity: s.opacity, alphaTest: s.alphaTest, side: s.side, roughness: 0.7 });
        };
        mesh.material = kept.length === 1 ? portable(kept[0].material) : kept.map(x => portable(x.material));
      });
      const bytes = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true, animations: handle.model.gltf?.animations ?? [] });
      const response = await apiFetch(`/api/avatars/${avatar.id}/browser-export`, { raw: bytes as ArrayBuffer, query: { format }, headers });
      const url = URL.createObjectURL(await response.blob()), a = document.createElement('a');
      a.href = url; a.download = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? `character.${format}`;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  return <div className="flex flex-col gap-3"><p className="text-sm text-fg-2">Export the current geometry, fitted clothes, rig and textures. Native MakeHuman is exported in its rest pose. Imported models use the preview pose. VRM export requires a mapped humanoid; original VRM 1.0 author and license metadata is kept.</p><div className="flex gap-2"><Button loading={busy} disabled={!handle} onClick={() => void run('glb')}>Export GLB</Button><Button loading={busy} disabled={!handle} variant="secondary" onClick={() => void run('vrm')}>Export VRM</Button></div></div>;
}
