#!/usr/bin/env node
/**
 * Packs wrapped base bodies (tools/gpu/body/wrap.py + apply-deltas.mjs) as a base-body pack
 * (format: apps/server/src/services/avatars/base-bodies.ts), installed in Settings › 3D characters.
 *
 *   node tools/gpu/body/build-pack.mjs --out <zip> --f <anime-f.glb> --m <anime-m.glb> [--all-ages] [--name "…"]
 *
 * --all-ages makes the pack keep underwear on (the creator then can't remove it and hides the
 * anatomy tab); without it, the bodies are the plain base under all clothing, for the 18+ download
 * together with the anatomy pack. Generated assets: the pack is written outside the repository only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { strToU8, zipSync } from 'fflate';

const { values: a } = parseArgs({ options: { out: { type: 'string' }, f: { type: 'string' }, m: { type: 'string' }, 'all-ages': { type: 'boolean', default: false }, name: { type: 'string' } } });
if (!a.out || (!a.f && !a.m)) { console.error('usage: build-pack.mjs --out <zip> --f <glb> --m <glb> [--all-ages]'); process.exit(2); }
const out = path.resolve(a.out);
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
if ((out + path.sep).startsWith(repo + path.sep) && !out.startsWith(path.join(repo, 'samples', 'gen') + path.sep)) throw new Error('Write the pack outside the repository (or under the git-ignored samples/gen/).');
const files = {};
const bases = {};
for (const [id, file] of [['anime-f', a.f], ['anime-m', a.m]]) {
  if (!file) continue;
  const bytes = readFileSync(file);
  if (bytes.subarray(0, 4).toString('latin1') !== 'glTF') throw new Error(`${file} is not a GLB`);
  files[`${id}.glb`] = new Uint8Array(bytes);
  bases[id] = `${id}.glb`;
}
const allAges = a['all-ages'];
const manifest = {
  format: 'everloom-base-bodies',
  version: 1,
  name: a.name ?? (allAges ? 'Everloom bodies (all ages, underwear on)' : 'Everloom bodies'),
  license: "Made for the owner by Everloom's 3D generation from its CC0 MakeHuman-based bases; private use, don't redistribute",
  underwearFixed: allAges,
  bases,
};
files['bodies.json'] = strToU8(JSON.stringify(manifest, null, 1));
files['README.txt'] = strToU8(`${manifest.name}\n\nInstall in Everloom: Settings > 3D characters > Base-body pack.\nThe character creator then builds new characters on these bodies.\n${manifest.license}.\n`);
writeFileSync(out, zipSync(files, { level: 6 }));
console.log(`${out}: ${Object.keys(bases).join(', ')}${allAges ? ' (all ages)' : ''}`);
