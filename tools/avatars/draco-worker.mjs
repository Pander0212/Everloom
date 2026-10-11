// Generate a same-origin Draco worker with its own CSP, as with the Basis transcoder.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
const dir = 'apps/web/public/three/draco';
mkdirSync(dir, { recursive: true });
const source = readFileSync('node_modules/three/examples/jsm/loaders/DRACOLoader.js', 'utf8');
const start = source.indexOf('function DRACOWorker()');
const end = source.lastIndexOf('export {');
if (start < 0 || end < start) throw new Error('DRACOLoader changed: review the worker generator');
const fn = source.slice(start, end);
const body = fn.slice(fn.indexOf('{') + 1, fn.lastIndexOf('}'));
const decoder = readFileSync('node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js', 'utf8');
writeFileSync(`${dir}/draco-worker.js`, '/* Generated from three.js (MIT) and Draco (Apache-2.0); see CREDITS.md. */\n' + decoder + '\n' + body);
for (const file of ['draco_wasm_wrapper.js', 'draco_decoder.wasm']) copyFileSync(`node_modules/three/examples/jsm/libs/draco/gltf/${file}`, `${dir}/${file}`);
