/** Browser-built geometry returns through the normal authenticated/password-protected export. */
import { AvatarConfigSchema, REQUIRED_BONES } from '@everloom/engine';
import { HttpError, type AppContext } from '../../context.js';
import { readMedia } from '../media.js';
import { parseGlb, writeGlb } from './glb.js';
import { inspectModel } from './inspect.js';
import { checkAvatarContent, getAvatarRow, parseConfig } from './service.js';

export async function exportBrowserModel(ctx: AppContext, owner: string, id: string, bytes: Buffer, format: 'glb' | 'vrm') {
  const row = getAvatarRow(ctx, owner, id), saved = parseConfig(row.config), glb = parseGlb(bytes);
  const input = (glb.json.nodes ?? []).map(node => (node as { extras?: { everloom?: { config?: unknown } } }).extras?.everloom?.config).find(Boolean);
  const parsed = AvatarConfigSchema.safeParse(input ?? saved);
  if (!parsed.success) throw new HttpError(400, 'Invalid character settings in the browser export.');
  const config = parsed.data;
  checkAvatarContent(ctx, owner, saved, id); checkAvatarContent(ctx, owner, config, id);
  glb.json.extras = { everloom: { adult: saved.content.adult || config.content.adult, age: config.content.age, formatVersion: 1 } };
  const info = await inspectModel(bytes, glb);
  if (format === 'vrm') {
    if (REQUIRED_BONES.some(b => !(config.boneMap[b] || info.boneMap[b]))) throw new HttpError(400, 'Map all required humanoid bones before exporting VRM.');
    let originalMeta: Record<string, unknown> | undefined;
    let originalVrm0: Record<string, unknown> | undefined;
    if (row.source_media) { const original = parseGlb(readMedia(ctx, owner, row.source_media).bytes).json; originalMeta = original.extensions?.VRMC_vrm?.meta; originalVrm0 = original.extensions?.VRM?.meta; }
    const nodes = glb.json.nodes ?? [];
    const humanBones: Record<string, { node: number }> = {};
    for (const [bone, name] of Object.entries({ ...info.boneMap, ...config.boneMap })) {
      const node = nodes.findIndex(n => n.name === name); if (node >= 0) humanBones[bone] = { node };
    }
    if (REQUIRED_BONES.some(b => !humanBones[b])) throw new HttpError(400, 'The saved mapping contains bone names missing from the exported mesh. Fix the mapping before exporting VRM.');
    if (originalVrm0) {
      glb.json.extensionsUsed = [...new Set([...(glb.json.extensionsUsed ?? []), 'VRM'])];
      const { texture: _thumbnail, ...meta } = originalVrm0;
      glb.json.extensions = { ...glb.json.extensions, VRM: { exporterVersion: 'Everloom', specVersion: '0.0', meta, humanoid: { humanBones: Object.entries(humanBones).map(([bone, joint]) => ({ bone, node: joint.node, useDefaultValues: true })) } } };
    } else {
      glb.json.extensionsUsed = [...new Set([...(glb.json.extensionsUsed ?? []), 'VRMC_vrm'])];
      glb.json.extensions = { ...glb.json.extensions, VRMC_vrm: { specVersion: '1.0', meta: originalMeta ?? { name: row.name, authors: ['Everloom owner'], licenseUrl: 'https://vrm.dev/licenses/1.0/', avatarPermission: 'onlyAuthor', commercialUsage: 'personalNonProfit', allowRedistribution: false, modification: 'prohibited', violentUsage: false, sexualUsage: config.content.adult, creditNotation: 'required' }, humanoid: { humanBones } } };
    }
  }
  return writeGlb(glb);
}
