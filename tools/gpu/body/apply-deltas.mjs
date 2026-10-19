#!/usr/bin/env node
/**
 * Adds a wrap's per-vertex deltas (tools/gpu/body/wrap.py) to a creator base GLB: only the Body's
 * rest positions (and its normals) change. Shape keys stay relative, so every slider, the anatomy
 * pack (indexed by vertex) and clothing keep working. Output is meshopt-compressed like the bases.
 *
 *   node tools/gpu/body/apply-deltas.mjs <base.glb> <deltas.bin|-> <out.glb> [--strength 1] [--weights weights.json]
 *
 * --weights (from tools/gpu/body/reweight.py) replaces the Body's skin weights too ("-" = no deltas).
 *
 * The result is a generated derivative: it goes into a base-body pack (outside the repository),
 * never into apps/web/public.
 */
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [src, deltasFile, dst] = process.argv.slice(2);
const si = process.argv.indexOf('--strength');
const strength = si > 0 ? Number(process.argv[si + 1]) : 1;
if (!src || !deltasFile || !dst) { console.error('usage: apply-deltas.mjs <base.glb> <deltas.bin> <out.glb> [--strength 1]'); process.exit(2); }
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
const body = doc.getRoot().listMeshes().find((m) => m.getName() === 'Body');
if (!body) throw new Error('no Body mesh');
const wi = process.argv.indexOf('--weights');
const weights = wi > 0 ? JSON.parse(readFileSync(process.argv[wi + 1], 'utf8')).vertices : null;
const skin = doc.getRoot().listNodes().find((n) => n.getMesh() === body)?.getSkin();
const jointIndex = new Map((skin?.listJoints() ?? []).map((j, i) => [j.getName(), i]));
const buf = deltasFile === '-' ? null : readFileSync(deltasFile);
const delta = buf ? new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) : null;
let offset = 0;
for (const prim of body.listPrimitives()) {
  const pos = prim.getAttribute('POSITION');
  const n = pos.getCount();
  if (weights) {
    const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
    const ja = new (J.getArray().constructor)(n * 4), wa = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) (weights[offset / 3 + i] ?? []).forEach(([name, w], k) => {
      if (!jointIndex.has(name)) throw new Error(`no joint ${name} in the skin`);
      ja[i * 4 + k] = jointIndex.get(name); wa[i * 4 + k] = w;
    });
    J.setArray(ja); W.setArray(wa);
  }
  if (!delta) { offset += n * 3; continue; }
  if (offset + n * 3 > delta.length) throw new Error(`the deltas have ${delta.length / 3} vertices, the Body more`);
  const a = pos.getArray().slice();
  for (let i = 0; i < n * 3; i++) a[i] += delta[offset + i] * strength;
  offset += n * 3;
  pos.setArray(a);
  // Normals, welded across UV seams (same position → same normal) so seams don't show.
  const idx = prim.getIndices().getArray();
  const key = (i) => `${a[i * 3].toFixed(5)},${a[i * 3 + 1].toFixed(5)},${a[i * 3 + 2].toFixed(5)}`;
  const groups = new Map();
  for (let i = 0; i < n; i++) { const k = key(i); groups.set(k, [...(groups.get(k) ?? []), i]); }
  const nrm = new Float32Array(n * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const [i0, i1, i2] = [idx[t], idx[t + 1], idx[t + 2]];
    const ux = a[i1 * 3] - a[i0 * 3], uy = a[i1 * 3 + 1] - a[i0 * 3 + 1], uz = a[i1 * 3 + 2] - a[i0 * 3 + 2];
    const vx = a[i2 * 3] - a[i0 * 3], vy = a[i2 * 3 + 1] - a[i0 * 3 + 1], vz = a[i2 * 3 + 2] - a[i0 * 3 + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    for (const i of [i0, i1, i2]) { nrm[i * 3] += cx; nrm[i * 3 + 1] += cy; nrm[i * 3 + 2] += cz; }
  }
  for (const list of groups.values()) {
    let x = 0, y = 0, z = 0;
    for (const i of list) { x += nrm[i * 3]; y += nrm[i * 3 + 1]; z += nrm[i * 3 + 2]; }
    const l = Math.hypot(x, y, z) || 1;
    for (const i of list) { nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l; }
  }
  prim.getAttribute('NORMAL')?.setArray(nrm);
}
if (delta && offset !== delta.length) throw new Error(`the deltas have ${delta.length / 3} vertices, the Body ${offset / 3}`);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(dst, doc);
console.log(`${dst}: ${offset / 3} vertices${delta ? ` moved (strength ${strength})` : ''}${weights ? ', weights replaced' : ''}`);
