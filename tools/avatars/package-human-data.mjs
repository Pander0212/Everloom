/** Rebuild the redistributable CC0 data pack. Never includes upstream program code. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strToU8 } from 'fflate';
const source = readFileSync(process.argv[2]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (sha(source) !== 'b50c69cea33cce250ca49d838079904da7fb84a21943f3cb7fc5a9bb3e0165f8') throw new Error('Unexpected MPFB source archive');
const commit = 'd6fc027ced5c17b6b0775dee944096ade7a9ef80';
const files = unzipSync(source, { filter: f => /\/src\/mpfb\/data\/(3dobjs\/base\.obj$|rigs\/standard\/|targets\/)/.test(f.name) && /\.(obj|json|target|gz)$/.test(f.name) && !/genital|penis|vagina|nipple|anus|explicit|_images/i.test(f.name) });
// All-ages facial actions only. Vertex numbering is the original MakeHuman topology.
const names = ['eyeBlinkLeft', 'eyeBlinkRight', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight', 'browDownLeft', 'browDownRight', 'browInnerUp', 'eyeWideLeft', 'eyeWideRight', 'jawOpen', 'mouthPucker', 'mouthFunnel', 'mouthStretchLeft', 'mouthStretchRight'];
const prefix = 'everloom/src/mpfb/data/faceunits/';
for (const name of names) {
  const url = `https://raw.githubusercontent.com/naver/anny/${commit}/src/anny/data/faceunits01/targets/faceunits/${name}.target`;
  const response = await fetch(url); if (!response.ok) throw new Error(`Face target download failed: ${name}`);
  files[prefix + name + '.target'] = new Uint8Array(await response.arrayBuffer());
}
const license = await fetch(`https://raw.githubusercontent.com/naver/anny/${commit}/src/anny/data/mpfb2/LICENSE.md`);
if (!license.ok) throw new Error('CC0 license download failed');
files['LICENSE-CC0.txt'] = new Uint8Array(await license.arrayBuffer());
files['PROVENANCE.json'] = strToU8(JSON.stringify({ license: 'CC0-1.0', mpfb: { commit: 'd0a32e57a7f915cb2f2b95410e2117648c7bbb7e', sourceSha256: sha(source) }, faceunits: { author: 'Mika Suominen', annyCommit: commit, targets: names }, exclusions: 'Program code, UI images and explicit anatomy targets' }, null, 2));
const entries = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([name, bytes]) => [name, [bytes, { mtime: new Date('2020-01-01T00:00:00Z') }]]));
const packed = zipSync(entries, { level: 6 });
writeFileSync('apps/web/public/avatar/makehuman-core.zip', packed);
console.log(JSON.stringify({ sha256: sha(packed), bytes: packed.length, files: Object.keys(files).length }));
