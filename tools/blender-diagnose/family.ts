// Prints what the auto-mapper makes of GLBs: family, body parts, humanoid core, roles.
//   npx tsx tools/blender-diagnose/family.ts a.glb b.glb …
import { readFileSync } from 'node:fs';
import { automap, readGltfJson, skeletonFromGltf } from '../../packages/engine/src/index.js';

for (const f of process.argv.slice(2)) {
  const r = automap(skeletonFromGltf(readGltfJson(readFileSync(f))));
  const a = r.analysis;
  const limbs = (ls: { side: string; bones: string[] }[]) => ls.map((l) => `${l.side}:${l.bones[0]}…${l.bones.at(-1)}(${l.bones.length})`).join(', ');
  const roles: Record<string, number> = {};
  for (const x of r.rig.roles) roles[x.role] = (roles[x.role] ?? 0) + 1;
  console.log(`== ${f.split(/[\\/]/).at(-3)}  family=${r.rig.family} (${a.confidence}) — ${r.rig.familyWhy}`);
  console.log(`  humanoid: ${Object.keys(r.boneMap).length} slots, missing [${r.missing.join(',')}]  hips=${r.boneMap.hips} spine=${r.boneMap.spine} chest=${r.boneMap.chest} head=${r.boneMap.head} L arm=${r.boneMap.leftUpperArm}/${r.boneMap.leftLowerArm}/${r.boneMap.leftHand} L leg=${r.boneMap.leftUpperLeg}/${r.boneMap.leftLowerLeg}/${r.boneMap.leftFoot}`);
  console.log(`  pelvis=${a.pelvis} chest=${a.chest} head=${a.head} jaw=${a.jaw} spine=[${r.rig.spine.join(',')}] neck=[${a.neck.join(',')}] upright=${a.upright}`);
  console.log(`  front: ${limbs(a.frontLegs)} | hind: ${limbs(a.hindLegs)} | legs: ${limbs(a.legs)} | arms: ${limbs(a.arms)}`);
  console.log(`  wings: ${limbs(a.wings)} | tails: ${limbs(a.tails)} | ears: ${limbs(a.ears)} | eyes: ${a.eyes.join(',')}`);
  console.log(`  roles: ${JSON.stringify(roles)}  review: ${r.review.length}`);
}
