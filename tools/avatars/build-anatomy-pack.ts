/** Neutral parametric anatomical geometry. Generated assets must remain outside the repository.
 * npx tsx tools/avatars/build-anatomy-pack.ts /workspace/everloom-cloud/anatomy-pack.zip [existing-pack.zip]
 * An existing pack can contribute its body-specific nipple shape keys and texture layers.
 */
import * as THREE from 'three';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGlb, type GlbMesh } from './glb-writer.js';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = process.argv[2] && path.resolve(process.argv[2]);
if (!output || output === repo || output.startsWith(repo + path.sep)) throw new Error('Choose an output ZIP outside the repository. Generated anatomy is never committed.');
const files = process.argv[3] ? unzipSync(readFileSync(process.argv[3])) : {};
const manifest = files['anatomy.json'] ? JSON.parse(new TextDecoder().decode(files['anatomy.json'])) : { format: 'everloom-anatomy', version: 1, name: 'Everloom parametric anatomy', license: 'CC0-1.0; generated from original mathematical primitives', bases: {} };
if (manifest.format !== 'everloom-anatomy' || manifest.version !== 1) throw new Error('Unsupported source pack');
const meshes: Record<string, GlbMesh[]> = { female: [], male: [], internal: [] };
function add(kind: string, name: string, geometry: THREE.BufferGeometry, morph: Record<string, (p: THREE.Vector3) => THREE.Vector3> = {}) {
  const pos = geometry.getAttribute('position'), n = pos.count;
  const targets: Record<string, Float32Array> = {};
  for (const [key, fn] of Object.entries(morph)) {
    const delta = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i), d = fn(p.clone()).sub(p);
      delta.set(d.toArray(), i * 3);
    }
    targets[key] = delta;
  }
  const weights = new Float32Array(n * 4); for (let i = 0; i < n; i++) weights[i * 4] = 1;
  meshes[kind]!.push({ name, positions: Float32Array.from(pos.array), normals: Float32Array.from(geometry.getAttribute('normal').array), indices: geometry.index ? Uint32Array.from(geometry.index.array) : Uint32Array.from({ length: n }, (_, i) => i), skinIndex: new Uint16Array(n * 4), skinWeight: weights, morphs: targets, color: kind === 'internal' ? '#c58387' : '#efcdb6' });
  geometry.dispose();
}
function ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number) {
  return new THREE.SphereGeometry(1, 24, 16).scale(rx, ry, rz).translate(x, y, z);
}
// Paired folds, with separately adjustable size and projection. No baked sexual pose or action.
for (const side of [-1, 1]) {
  add('female', `LabiaOuter_${side}`, ellipsoid(side * .010, -.006, 0, .008, .030, .008), {
    vulvaSize: p => p.multiplyScalar(1.35),
    labiaFullness: p => new THREE.Vector3(p.x * 1.2, p.y, p.z * 1.65),
  });
  add('female', `LabiaInner_${side}`, ellipsoid(side * .004, -.006, .005, .003, .022, .006), {
    vulvaSize: p => p.multiplyScalar(1.35),
    labiaFullness: p => new THREE.Vector3(p.x * 1.25, p.y, p.z * 1.4),
  });
}
add('female', 'ClitoralHood', ellipsoid(0, .016, .007, .004, .005, .004));
const shaft = new THREE.CylinderGeometry(.010, .012, .07, 24, 10).translate(0, -.035, .012);
const erect = (p: THREE.Vector3) => {
  const t = Math.max(0, Math.min(1, -p.y / .075));
  const a = t * Math.PI / 2;
  const y = p.y, z = p.z - .012;
  return new THREE.Vector3(p.x * 1.1, y * Math.cos(a) + z * Math.sin(a), .012 - y * Math.sin(a) + z * Math.cos(a));
};
const maleMorphs = { length: (p: THREE.Vector3) => new THREE.Vector3(p.x, p.y * 1.7, p.z), girth: (p: THREE.Vector3) => new THREE.Vector3(p.x * 1.45, p.y, .012 + (p.z - .012) * 1.45), erection: erect };
add('male', 'Shaft', shaft, maleMorphs);
add('male', 'Glans', ellipsoid(0, -.071, .012, .011, .012, .011), maleMorphs);
add('male', 'Foreskin', ellipsoid(0, -.064, .012, .012, .014, .012), { ...maleMorphs, circumcised: p => new THREE.Vector3(p.x * .25, -.048 + (p.y + .064) * .15, .012 + (p.z - .012) * .25) });
for (const side of [-1, 1]) add('male', `Testicle_${side}`, ellipsoid(side * .013, -.024, -.009, .012, .019, .014), { testicleSize: p => new THREE.Vector3(p.x * 1.35, p.y * 1.3, p.z * 1.3) });
const canal = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -.018, 0), new THREE.Vector3(0, .025, -.015), new THREE.Vector3(0, .075, -.028)]);
add('internal', 'VaginalCanal', new THREE.TubeGeometry(canal, 20, .010, 20, false));
add('internal', 'Cervix', ellipsoid(0, .080, -.028, .012, .010, .012));
add('internal', 'Uterus', ellipsoid(0, .114, -.028, .026, .030, .017));
for (const [kind, parts] of Object.entries(meshes)) files[`${kind}.glb`] = writeGlb([{ name: 'AnatomyAnchor', parent: null, at: [0, 0, 0] }], parts, { generator: 'Everloom parametric anatomical geometry', extras: { adult: true, license: 'CC0-1.0' } });
for (const base of ['anime-f', 'anime-m']) {
  const bytes = readFileSync(path.join(repo, `apps/web/public/avatar/bases/${base}.glb`));
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const body = json.meshes.find((m: any) => m.name === 'Body');
  if (!body) throw new Error(`Missing Body mesh in ${base}`);
  const vertices = json.accessors[body.primitives[0].attributes.POSITION].count;
  manifest.bases[base] ??= { vertices, shapeKeys: {}, layers: {} };
  if (manifest.bases[base].vertices !== vertices) throw new Error(`The existing pack has a different ${base} vertex count`);
  manifest.bases[base].models = { female: 'female.glb', male: 'male.glb', internal: 'internal.glb' };
}
files['anatomy.json'] = strToU8(JSON.stringify(manifest, null, 2));
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, zipSync(files));
console.log(`Wrote ${output}; ${Object.values(meshes).flat().reduce((n, m) => n + m.indices.length / 3, 0)} triangles. Inspect alignment before distribution.`);
