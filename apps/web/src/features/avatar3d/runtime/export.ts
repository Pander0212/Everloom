/**
 * Exports what the preview shows (body and worn parts, one skeleton) as a single GLB, or a VRM 1.0:
 * the same file with the humanoid bone map and its metadata, for use outside Everloom.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { PreviewHandle } from '../Preview3D';

export async function exportCharacter(h: PreviewHandle, opts: { format: 'glb' | 'vrm'; name: string }): Promise<Blob> {
  const { avatar, model } = h;
  const look = avatar.options.look;
  // Plain materials (toon materials are Everloom's own shader) and the rest pose, then back.
  avatar.setLook('pbr');
  const saved: Array<[THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3]> = [];
  model.scene.traverse((o) => saved.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  const rot = model.scene.rotation.clone();
  model.scene.rotation.set(0, 0, 0);
  model.scene.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).skeleton.pose());
  let glb: ArrayBuffer;
  try {
    glb = (await new GLTFExporter().parseAsync(model.scene, { binary: true, onlyVisible: true })) as ArrayBuffer;
  } finally {
    for (const [o, p, q, s] of saved) (o.position.copy(p), o.quaternion.copy(q), o.scale.copy(s));
    model.scene.rotation.copy(rot);
    avatar.setLook(look);
  }
  if (opts.format === 'glb') return new Blob([glb], { type: 'model/gltf-binary' });

  // VRM 1.0: the humanoid bones by node index, and metadata (the owner decides any license).
  const view = new DataView(glb);
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen)));
  const bin = new Uint8Array(glb, 20 + jsonLen + 8);
  const byName = new Map<string, number>((json.nodes as Array<{ name?: string }>).map((n, i) => [n.name ?? '', i]));
  const humanBones: Record<string, { node: number }> = {};
  for (const [bone, obj] of Object.entries(model.bones)) {
    const i = obj ? byName.get(obj.name) : undefined;
    if (i !== undefined) humanBones[bone] = { node: i };
  }
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'VRMC_vrm'])];
  json.extensions = {
    ...(json.extensions ?? {}),
    VRMC_vrm: {
      specVersion: '1.0',
      meta: { name: opts.name, version: '1', authors: ['Made with Everloom'], licenseUrl: 'https://vrm.dev/licenses/1.0/', avatarPermission: 'onlyAuthor', commercialUsage: 'personalNonProfit', allowRedistribution: false, modification: 'prohibited', creditNotation: 'required' },
      humanoid: { humanBones },
      expressions: { preset: {} },
    },
  };
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (enc.length % 4)) % 4;
  const jsonChunk = new Uint8Array(enc.length + pad).fill(0x20);
  jsonChunk.set(enc);
  const out = new Uint8Array(12 + 8 + jsonChunk.length + 8 + bin.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonChunk.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  dv.setUint32(20 + jsonChunk.length, bin.length, true);
  dv.setUint32(24 + jsonChunk.length, 0x004e4942, true);
  out.set(bin, 28 + jsonChunk.length);
  return new Blob([out], { type: 'model/gltf-binary' });
}
