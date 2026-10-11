#!/usr/bin/env node
// Converts a batch of .blend files on a rented CPU machine (RunPod) when the Everloom server can't
// run Blender itself. Same budget rules as the See-through worker (docs/3d-import/blend.md):
//
//   RUNPOD_API_KEY=… node tools/blender-worker/session.mjs status
//   RUNPOD_API_KEY=… node tools/blender-worker/session.mjs convert --out converted/ a.blend b.blend
//   RUNPOD_API_KEY=… node tools/blender-worker/session.mjs cleanup
//
// `convert` reads the balance first (refusing below $0.50 plus the session's worst case), starts a
// small CPU pod with no paid storage, installs Blender 4.2 LTS there (checked against blender.org's
// checksum), uploads the files with Everloom's own Blender worker script, converts them, downloads
// the GLBs and terminates the pod in a `finally` step, then checks that nothing is left running or
// stored. The pod also ends itself when idle or past its time limit. Every session goes in
// docs/art/GPU_LEDGER.md. The key comes from the environment and is never printed or stored.
//
// The converted GLBs are imported like any other GLB (they keep meshes, armature, weights, shape
// keys and materials). Files are sent to RunPod: don't use this for files that must stay private.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const LEDGER_JSON = path.join(root, 'docs/art/gpu-ledger.json');
const FLOOR = 0.5;
const NAME = 'everloom-blender-converter';
const IMAGE = 'ubuntu:22.04';
// Small CPU machines, cheapest first (RunPod CPU instance ids: generation, vCPUs, GB of memory).
const INSTANCES = ['cpu3c-2-4', 'cpu3g-2-8', 'cpu5c-2-4'];
const MAX_PRICE = 0.2; // $/h ceiling for a converter
const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, 'max-minutes': { type: 'string', default: '40' }, note: { type: 'string', default: '' } } });
const cmd = positionals.shift();
const key = process.env.RUNPOD_API_KEY;
if (!key) {
  console.error('RUNPOD_API_KEY is not set');
  process.exit(1);
}

async function gql(query, variables = {}) {
  const r = await fetch('https://api.runpod.io/graphql', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.errors) throw new Error(`RunPod API: ${r.status} ${JSON.stringify(j?.errors ?? j).slice(0, 300)}`);
  return j.data;
}
const account = () => gql('query { myself { clientBalance currentSpendPerHr pods { id name desiredStatus costPerHr } networkVolumes { id name size } } }').then((d) => d.myself);
const terminate = (id) => gql('mutation($id: String!) { podTerminate(input: { podId: $id }) }', { id });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loadLedger = () => (existsSync(LEDGER_JSON) ? JSON.parse(readFileSync(LEDGER_JSON, 'utf8')) : { sessions: [] });
const saveLedger = (L) => writeFileSync(LEDGER_JSON, JSON.stringify(L, null, 1));

/** Terminates any converter pod left over; returns the account. */
async function cleanup() {
  const me = await account();
  for (const p of me.pods ?? []) if (p.name === NAME) {
    await terminate(p.id);
    console.log(`terminated leftover ${p.id}`);
  }
  return me;
}

async function convert(files) {
  if (!a.out) throw new Error('--out <dir> is required');
  if (!files.length) throw new Error('no .blend files given');
  for (const f of files) if (!existsSync(f) || !/\.blend$/i.test(f)) throw new Error(`not a .blend file: ${f}`);
  const L = loadLedger();
  const before = await cleanup();
  const balance = Number(before.clientBalance);
  const maxMinutes = Math.min(Number(a['max-minutes']), 120);
  const worst = (MAX_PRICE * maxMinutes) / 60;
  if (!(balance - worst >= FLOOR)) throw new Error(`balance $${balance} can't cover a ${maxMinutes}-minute session and keep $${FLOOR} (worst case $${worst.toFixed(2)})`);
  const token = randomBytes(24).toString('hex');
  const b64 = (f) => readFileSync(path.join(here, f)).toString('base64');
  const entry = { date: new Date().toISOString().slice(0, 10), provider: 'RunPod (CPU, Blender converter)', gpu: null, pricePerHr: null, start: null, stop: null, seconds: null, costUsd: null, balanceBefore: balance, balanceAfter: null, images: files.map((f) => path.basename(f)), result: 'started', note: a.note };
  L.sessions.push(entry);
  saveLedger(L);
  let pod = null;
  const t0 = Date.now();
  const onSignal = async () => {
    if (pod?.id) await terminate(pod.id).catch(() => {});
    entry.result = 'stopped by a signal';
    saveLedger(L);
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    for (const instanceId of INSTANCES) {
      try {
        const d = await gql('mutation($input: deployCpuPodInput!) { deployCpuPod(input: $input) { id costPerHr } }', { input: {
          instanceId, cloudType: 'SECURE', name: NAME, imageName: IMAGE, containerDiskInGb: 10, ports: '8000/http', startSsh: false,
          dockerArgs: `bash -c 'mkdir -p /opt/worker && cd /opt/worker && echo $W_SERVER | base64 -d > server.py && echo $W_START | base64 -d > start.sh && bash start.sh'`,
          env: [{ key: 'WORKER_TOKEN', value: token }, { key: 'W_SERVER', value: b64('server.py') }, { key: 'W_START', value: b64('start.sh') }, { key: 'MAX_SECONDS', value: String(maxMinutes * 60) }, { key: 'IDLE_SECONDS', value: '600' }],
        } });
        pod = d.deployCpuPod;
        if (pod?.id && pod.costPerHr > MAX_PRICE) {
          console.log(`${instanceId}: $${pod.costPerHr}/h is over $${MAX_PRICE}, released`);
          await terminate(pod.id);
          pod = null;
          continue;
        }
        if (pod?.id) break;
      } catch (e) {
        console.log(`${instanceId}: ${String(e.message).slice(0, 120)}`);
      }
    }
    if (!pod?.id) throw new Error('no CPU machine was available');
    entry.gpu = 'CPU';
    entry.pricePerHr = pod.costPerHr;
    entry.start = new Date().toISOString();
    saveLedger(L);
    const base = `https://${pod.id}-8000.proxy.runpod.net`;
    const api = (p, init = {}) => fetch(base + p, { ...init, headers: { 'x-token': token, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(300_000) });
    const deadline = t0 + maxMinutes * 60_000;
    let health = null;
    while (Date.now() < Math.min(deadline, t0 + 20 * 60_000)) {
      await sleep(10_000);
      try {
        const r = await api('/health');
        if (r.ok && (health = await r.json()).ready) break;
      } catch { /* not up yet */ }
    }
    if (!health?.ready) throw new Error('the converter did not finish setting up in time');
    if (!(await api('/worker.py', { method: 'PUT', body: readFileSync(path.join(root, 'apps/server/src/blender/worker.py')) })).ok) throw new Error('could not send the worker script');
    for (const f of files) if (!(await api(`/files/${path.basename(f).replace(/[^A-Za-z0-9_.-]/g, '_')}`, { method: 'PUT', body: readFileSync(f) })).ok) throw new Error(`upload failed: ${f}`);
    if (!(await api('/run', { method: 'POST' })).ok) throw new Error('could not start the conversion');
    while (Date.now() < deadline - 2 * 60_000) {
      await sleep(10_000);
      const r = await api('/health').catch(() => null);
      if (r?.ok && !(health = await r.json()).busy) break;
    }
    mkdirSync(a.out, { recursive: true });
    for (const n of health.done ?? []) writeFileSync(path.join(a.out, `${n}.glb`), Buffer.from(await (await api(`/result/${n}.glb`)).arrayBuffer()));
    writeFileSync(path.join(a.out, 'converter.log'), await (await api('/log')).text());
    entry.result = `${(health.done ?? []).length}/${files.length} converted${Object.keys(health.failed ?? {}).length ? `; failed: ${Object.keys(health.failed).join(', ')}` : ''}`;
    console.log(entry.result);
  } catch (e) {
    entry.result = `failed: ${String(e.message).slice(0, 160)}`;
    throw e;
  } finally {
    if (pod?.id) for (let i = 0; i < 5; i++) { try { await terminate(pod.id); break; } catch { await sleep(5000); } }
    entry.stop = new Date().toISOString();
    entry.seconds = Math.round((Date.now() - t0) / 1000);
    if (entry.pricePerHr != null) entry.costUsd = Math.round(((entry.pricePerHr * entry.seconds) / 3600) * 1000) / 1000;
    const after = await cleanup().catch(() => null);
    entry.balanceAfter = after ? Number(after.clientBalance) : null;
    if (after && (after.pods ?? []).some((p) => p.name === NAME)) entry.result += ' — WARNING: a converter pod is still listed';
    if (after?.networkVolumes?.length) entry.result += ` — note: ${after.networkVolumes.length} network volume(s) on the account`;
    saveLedger(L);
  }
}

if (cmd === 'status') console.log(JSON.stringify(await account(), null, 1));
else if (cmd === 'cleanup') await cleanup();
else if (cmd === 'convert') await convert(positionals);
else {
  console.error('usage: session.mjs status | cleanup | convert --out <dir> <files.blend…>');
  process.exit(2);
}
