// What the server's inspectModel makes of a converted GLB (bone map, roles, warnings).
import { readFileSync } from 'node:fs';
import { inspectModel } from '../../apps/server/src/services/avatars/inspect.js';
const info = await inspectModel(readFileSync(process.argv[2]!));
const roles: Record<string, number> = {};
for (const c of info.rig.roles ?? []) roles[`${c.role}.${c.side}`] = (roles[`${c.role}.${c.side}`] ?? 0) + 1;
console.log(JSON.stringify({ joints: info.joints, triangles: info.triangles, height: info.height, unitScale: info.unitScale, boneMap: info.boneMap, missing: info.missingBones, convention: info.convention, roles, spine: info.rig.spine, review: info.rigReview.length, reviewSample: info.rigReview.slice(0, 8), morphs: info.morphs.length, faceRig: info.faceRig, expr: Object.keys(info.expressionMap), animations: info.animations, warnings: info.warnings.map((w) => `${w.level}:${w.code}: ${w.message}`) }, null, 1));
