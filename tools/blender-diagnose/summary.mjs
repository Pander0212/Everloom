// One line per conversion: validation, skeleton, weights, what was applied or left out.
import { existsSync, readFileSync } from 'node:fs';
const p = process.argv[2];
if (!existsSync(p)) { console.log('  NO RESULT'); process.exit(0); }
const r = JSON.parse(readFileSync(p, 'utf8'));
if (!r.ok) { console.log('  FAILED:', r.error); process.exit(0); }
const v = r.validation, c = v.check ?? {};
console.log(`  ok=${c.ok} joints=${v.exportedJoints} reparented=${v.skeleton?.reparented} boneErr=${c.worstBoneError} bounds=${c.boundsError} h=${c.height} unweighted=${c.unweightedVertices} maxInf=${c.maxInfluences} filled=${v.weights?.filled} clips=${JSON.stringify(v.skeleton?.clips ?? [])} objects=${(v.objects ?? []).length}`);
for (const k of ['objectsOff', 'parentMismatches', 'missingBones']) if (c[k]?.length) console.log(`  ${k}:`, c[k].join(' | '));
for (const k of ['modifiersNotApplied', 'notConverted', 'converted', 'rigidSkinned', 'materialsSimplified', 'texturesMissing', 'clipsSkipped']) if (v[k]?.length) console.log(`  ${k}:`, v[k].slice(0, 8).join(' | '));
