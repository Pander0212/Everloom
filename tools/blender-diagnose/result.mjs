// Prints the useful parts of a worker result.json.
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!r.ok) { console.log('FAILED', r.error, '\n', r.trace); process.exit(1); }
const v = r.validation;
console.log(JSON.stringify({ joints: v.exportedJoints, check: v.check, skeleton: v.skeleton, weights: v.weights, rigid: v.rigidSkinned, applied: v.modifiersApplied, notApplied: v.modifiersNotApplied, dropped: (v.modifiersDropped || []).length, materials: v.materialsSimplified, converted: v.converted, notConverted: v.notConverted, packed: v.texturesPacked, missing: v.texturesMissing, actions: r.actions, sourceActions: r.sourceActions }, null, 1));
