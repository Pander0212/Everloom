/**
 * npm run bones:automap -- <model.glb|model.vrm|skeleton.json> [--out mapping.json] [--meta model.fbx.meta]
 *
 * Maps every bone of a skeleton (docs/3d-import/bones.md), prints a report and writes the mapping
 * JSON (humanoid bone map + rig mapping) next to the file, or to --out. A Unity .fbx.meta given with
 * --meta supplies the author's humanoid map. A skeleton JSON is { bones: [{ name, parent, pos? }] }.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { automap, readGltfJson, skeletonFromGltf, type AutomapInput } from '../../packages/engine/src/rig/index';
import { gltfFile } from '../../packages/engine/src/rig/gltf';
import { parseYaml } from '../../packages/engine/src/unity/yaml';
import { readHumanoid } from '../../packages/engine/src/unity/humanoid';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out' && args[args.indexOf(a) - 1] !== '--meta');
if (!file) {
  console.error('usage: npm run bones:automap -- <model.glb|model.vrm|skeleton.json> [--out mapping.json] [--meta model.fbx.meta]');
  process.exit(2);
}
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const bytes = new Uint8Array(readFileSync(file));
let input: AutomapInput;
if (gltfFile(file)) input = skeletonFromGltf(readGltfJson(bytes));
else if (/\.json$/i.test(file)) input = JSON.parse(new TextDecoder().decode(bytes)) as AutomapInput;
else {
  console.error('Give a .glb, .vrm, .gltf or a skeleton .json. For FBX or .blend, import it into Everloom first (or export a GLB).');
  process.exit(2);
}
const meta = opt('--meta');
if (meta) {
  const h = readHumanoid(parseYaml(readFileSync(meta, 'utf8')));
  if (h && Object.keys(h.bones).length) {
    input.humanoid = h.bones;
    input.humanoidSource = 'Unity humanoid (.fbx.meta)';
  }
}
const r = automap(input);
const counts = new Map<string, number>();
for (const v of r.byBone.values()) {
  const k = v.kind === 'role' || v.kind === 'review' ? String(v.role) : v.kind;
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
console.log(`${file}: ${input.bones.length} bones${r.base ? ` · recognised as ${r.base.name}` : ''}`);
console.log(`Humanoid: ${Object.keys(r.boneMap).length} bones${r.missing.length ? ` · missing: ${r.missing.join(', ')}` : ' · all required bones found'}`);
console.log(`Spine chain: ${r.rig.spine.join(' → ') || '(none)'}`);
for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${n}`);
if (r.review.length) {
  console.log(`To review (${r.review.length}):`);
  for (const x of r.review.slice(0, 40)) console.log(`  ${x.bone}: ${x.why}`);
}
const out = opt('--out') ?? file.replace(/\.[^.]+$/, '') + '.mapping.json';
writeFileSync(out, JSON.stringify({ boneMap: r.boneMap, rig: r.rig, review: r.review }, null, 2) + '\n');
console.log(`Wrote ${out}`);
