import type { AvatarConfig } from '@everloom/engine';
import { useState } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AvatarDetail } from '@/features/avatars/api';
import { apiFetch, exportHeaders } from '@/lib/api';
import { toastError } from '@/lib/store';
import { Button, ToggleRow } from '@/ui';
import { ImportReportView } from '@/features/avatars/ImportReportView';
import type { PreviewHandle } from '../Preview3D';
import { buildHuman } from '../runtime/makehuman';
import { configureMaterials } from '../runtime/materials';
import { VrmLicenseForm, VrmLicensePanel } from './VrmLicense';

export function ExportStep({ avatar, config, set, handle }: { avatar: AvatarDetail; config: AvatarConfig; set?: (patch: Partial<AvatarConfig>) => void; handle: PreviewHandle | null }) {
  const origin = config.importReport;
  const [busy, setBusy] = useState(false);
  const run = async (format: 'glb' | 'vrm') => {
    if (!handle) return;
    const headers = await exportHeaders(); if (!headers) return;
    setBusy(true);
    try {
      const scene = config.makehuman && !config.character ? await buildHuman(config.makehuman, undefined, config.content) : clone(handle.model.scene);
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
  return <div className="flex flex-col gap-3">{origin?.thirdParty ? (
    <div role="note" className="rounded-md border border-warning/50 bg-surface-2 p-3 text-sm" data-testid="third-party">
      <p className="font-medium">Third-party asset, personal use</p>
      <p className="mt-1 text-fg-2">This avatar came from a {origin.source.toLowerCase()} you bought or downloaded. An export keeps its original license; sharing it may not be allowed. It stays out of bundles, library exports and packs unless you confirm below.</p>
      {origin.license.length ? <details className="mt-2"><summary className="cursor-pointer">The package’s license</summary>{origin.license.map(l => <pre key={l.path} className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-fg-2">{l.text}</pre>)}</details> : null}
      {set ? <ToggleRow label="I have the right to share this avatar" description="Lets it go into bundles, library exports and packs." checked={origin.rightsConfirmed} onChange={v => set({ importReport: { ...origin, rightsConfirmed: v } })} /> : null}
    </div>
  ) : null}
  {handle?.model.vrm?.meta ? <VrmLicensePanel meta={handle.model.vrm.meta} exporting /> : set ? <VrmLicenseForm value={config.vrmMeta} onChange={(vrmMeta) => set({ vrmMeta })} /> : null}
  {origin ? <details className="rounded-md border border-line p-3"><summary className="cursor-pointer text-sm font-medium">Import report</summary><div className="mt-2"><ImportReportView report={origin} /></div></details> : null}
  <p className="text-sm text-fg-2">Export the current geometry, fitted clothes, rig and textures. Native MakeHuman is exported in its rest pose. Imported models use the preview pose. VRM export requires a mapped humanoid; a VRM's original author and license metadata is kept; your own characters carry the license set above.</p><div className="flex gap-2"><Button loading={busy} disabled={!handle} onClick={() => void run('glb')}>Export GLB</Button><Button loading={busy} disabled={!handle} variant="secondary" onClick={() => void run('vrm')}>Export VRM</Button></div></div>;
}
