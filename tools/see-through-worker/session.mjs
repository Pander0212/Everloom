#!/usr/bin/env node
// One See-through session on a rented GPU (RunPod), with the budget guards from docs/puppets.md:
//
//   RUNPOD_API_KEY=… node tools/see-through-worker/session.mjs status
//   RUNPOD_API_KEY=… node tools/see-through-worker/session.mjs run --out .puppets-work/seethrough img1.png img2.png …
//   RUNPOD_API_KEY=… node tools/see-through-worker/session.mjs cleanup
//
// `run` reads the balance first (refusing below $0.50 plus the session's worst case), starts the
// cheapest available 24 GB community GPU with no paid storage, waits for the worker to set up,
// uploads every image, runs them in one batch, downloads the result and terminates the pod in a
// `finally` step; then checks the provider's lists that nothing is left running or stored. The pod
// also ends itself (idle or time limit). Every session goes in docs/art/GPU_LEDGER.md.
// The key comes from the environment and is never printed or stored.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const LEDGER_JSON = path.join(root, 'docs/art/gpu-ledger.json');
const LEDGER_MD = path.join(root, 'docs/art/GPU_LEDGER.md');
const FLOOR = 0.5;
const IMAGE = 'runpod/pytorch:1.4.0-cu1281-torch280-ubuntu2204';
// Cheapest first; all 24 GB or more.
const GPUS = ['NVIDIA RTX A5000', 'NVIDIA GeForce RTX 3090', 'NVIDIA GeForce RTX 3090 Ti', 'NVIDIA RTX A6000', 'NVIDIA A40', 'NVIDIA GeForce RTX 4090'];
const NAME = 'everloom-see-through';
// Secure-cloud prices per hour (October 2026), to skip the dear ones.
const PRICES = { 'NVIDIA RTX A5000': 0.27, 'NVIDIA GeForce RTX 3090': 0.5, 'NVIDIA GeForce RTX 3090 Ti': 0.46, 'NVIDIA RTX A6000': 0.59, 'NVIDIA A40': 0.59, 'NVIDIA GeForce RTX 4090': 0.89 };

const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, 'max-minutes': { type: 'string', default: '60' }, note: { type: 'string', default: '' }, budget: { type: 'string' }, gpus: { type: 'string' }, 'wait-dir': { type: 'string' }, expect: { type: 'string' }, 'wait-community': { type: 'string' } } });
// --wait-community N: retry the community cards every two minutes for up to N minutes before
// taking a (dearer) secure one.
// --wait-dir/--expect: the inputs are still being made; once the worker is ready, wait (at most
// 45 minutes, with the worker kept awake) until the folder holds that many PNGs, then upload them
// all. Lets the pod's setup overlap the image generation.
// --budget caps what this one session may cost (USD): the pod's time limit becomes budget ÷ its
// hourly price (and never more than --max-minutes, at most 300). --gpus orders the cards to try.
const gpuOrder = a.gpus ? a.gpus.split(',').map((g) => g.trim()).filter(Boolean) : GPUS;
const cmd = positionals.shift();
const key = process.env.RUNPOD_API_KEY;
if (!key) { console.error('RUNPOD_API_KEY is not set'); process.exit(1); }

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
function saveLedger(L) {
  writeFileSync(LEDGER_JSON, JSON.stringify(L, null, 1));
  const rows = L.sessions.map((s) => `| ${s.date} | ${s.provider} | ${s.gpu ?? '—'} | ${s.pricePerHr != null ? `$${s.pricePerHr.toFixed(3)}` : '—'} | ${s.start?.slice(11, 19) ?? '—'} | ${s.stop?.slice(11, 19) ?? '—'} | ${s.seconds != null ? `${Math.round(s.seconds / 60)} min` : '—'} | ${s.costUsd != null ? `$${s.costUsd.toFixed(3)}` : '—'} | ${s.balanceBefore != null ? `$${s.balanceBefore.toFixed(2)} → ${s.balanceAfter != null ? `$${s.balanceAfter.toFixed(2)}` : '?'}` : '—'} | ${(s.images ?? []).join(', ')} | ${s.result ?? ''} |`);
  writeFileSync(LEDGER_MD, `# GPU ledger

Every rented-GPU session (See-through layering), written by \`tools/see-through-worker/session.mjs\`;
the source of truth is \`gpu-ledger.json\`. Rules: read the balance first, stop with $${FLOOR.toFixed(2)} left
on RunPod, no paid storage kept, every pod terminated (checked through the API at the end).

| Date (UTC) | Provider | GPU | Price/h | Start | Stop | Time | Cost | Balance | Images | Result |
|---|---|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`);
}

async function cleanup(log = console.log) {
  const me = await account();
  for (const p of me.pods ?? []) {
    log(`terminating leftover pod ${p.name} (${p.id})`);
    await terminate(p.id);
  }
  for (const v of me.networkVolumes ?? []) log(`note: a network volume exists (${v.name}, ${v.size} GB); delete it in the console if it isn't needed`);
  return me;
}

async function status() {
  const me = await account();
  console.log(JSON.stringify({ balance: me.clientBalance, spendPerHr: me.currentSpendPerHr, pods: me.pods, volumes: me.networkVolumes }, null, 1));
}

async function run(images) {
  if (!a.out) throw new Error('--out <dir> is required');
  if (!images.length && !a['wait-dir']) throw new Error('no images given');
  for (const f of images) if (!existsSync(f)) throw new Error(`no such image: ${f}`);
  const L = loadLedger();
  const before = await cleanup();
  const balance = Number(before.clientBalance);
  // Worst case: the price of the dearest GPU we'd take, for the whole time limit.
  const maxMinutes = Math.min(Number(a['max-minutes']), 300);
  const budget = a.budget ? Number(a.budget) : Infinity;
  // Worst case: the dearest card we'd take (0.60/h) for the whole limit, or the budget if smaller.
  const worst = Math.min((0.6 * maxMinutes) / 60, budget);
  if (!(balance - worst >= FLOOR)) throw new Error(`balance $${balance} can't cover a ${maxMinutes}-minute session and keep $${FLOOR} (worst case $${worst.toFixed(2)})`);
  let limitMinutes = maxMinutes;
  const token = randomBytes(24).toString('hex');
  const b64 = (f) => readFileSync(path.join(here, f)).toString('base64');
  const entry = { date: new Date().toISOString().slice(0, 10), provider: 'RunPod', gpu: null, pricePerHr: null, start: null, stop: null, seconds: null, costUsd: null, balanceBefore: balance, balanceAfter: null, images: images.map((f) => path.basename(f)), result: 'started', note: a.note };
  L.sessions.push(entry);
  saveLedger(L);
  let pod = null;
  const t0 = Date.now();
  // Stopped from outside (Ctrl-C, kill): still give the pod back before exiting.
  const onSignal = async () => { if (pod?.id) { try { await terminate(pod.id); console.log(`terminated ${pod.id} on a stop signal`); } catch { /* the pod's own watchdog ends it */ } } entry.result = 'stopped by a signal'; entry.stop = new Date().toISOString(); entry.seconds = Math.round((Date.now() - t0) / 1000); if (entry.pricePerHr != null) entry.costUsd = Math.round(((entry.pricePerHr * entry.seconds) / 3600) * 1000) / 1000; saveLedger(L); process.exit(130); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    // Community first (cheaper), then secure; as small a machine as See-through needs.
    const waitCommunity = Date.now() + Number(a['wait-community'] ?? 0) * 60_000;
    const tries = () => [...gpuOrder.map((g) => ['COMMUNITY', g]), ...(Date.now() >= waitCommunity ? gpuOrder.map((g) => ['SECURE', g]) : [])];
    for (let round = 0; !pod?.id; round++) {
    if (round > 0) { if (Date.now() >= waitCommunity) break; console.log('no community card free; trying again in 2 minutes'); await sleep(120_000); }
    for (const [cloud, gpu] of tries()) {
      if (cloud === 'SECURE' && (PRICES[gpu] ?? 1) > 0.6) continue;
      try {
        const d = await gql(`mutation($input: PodFindAndDeployOnDemandInput) { podFindAndDeployOnDemand(input: $input) { id costPerHr machine { gpuDisplayName } } }`, { input: {
          cloudType: cloud, gpuCount: 1, gpuTypeId: gpu, name: NAME, imageName: IMAGE,
          containerDiskInGb: 60, volumeInGb: 0, ports: '8000/http', minVcpuCount: 2, minMemoryInGb: 16,
          dockerArgs: `bash -c 'mkdir -p /opt/worker && echo $W_SERVER | base64 -d > /opt/worker/server.py && echo $W_START | base64 -d > /opt/worker/start.sh && bash /opt/worker/start.sh'`,
          env: [{ key: 'WORKER_TOKEN', value: token }, { key: 'W_SERVER', value: b64('server.py') }, { key: 'W_START', value: b64('start.sh') }, { key: 'MAX_SECONDS', value: String(Math.floor(Math.min(maxMinutes, (budget / Math.min(0.6, cloud === 'SECURE' ? PRICES[gpu] ?? 0.6 : 0.6)) * 60) * 60)) }, { key: 'IDLE_SECONDS', value: '600' }],
        } });
        pod = d.podFindAndDeployOnDemand;
        // Over the ceiling the time limit was set for: give it back at once and try the next card.
        if (pod?.id && pod.costPerHr > 0.6) { console.log(`${cloud} ${gpu}: $${pod.costPerHr}/h is over $0.60, released`); await terminate(pod.id); pod = null; continue; }
        if (pod?.id) break;
      } catch (e) { console.log(`${cloud} ${gpu}: ${/no longer any instances/.test(e.message) ? 'none available' : String(e.message).slice(0, 120)}`); }
    }
    }
    if (!pod?.id) throw new Error('no 24 GB GPU was available');
    entry.gpu = pod.machine?.gpuDisplayName ?? '?';
    entry.pricePerHr = pod.costPerHr;
    entry.start = new Date().toISOString();
    saveLedger(L);
    // With a budget, the session's own time limit follows the price actually paid.
    if (Number.isFinite(budget) && pod.costPerHr > 0) limitMinutes = Math.min(maxMinutes, Math.floor((budget / pod.costPerHr) * 60) - 2);
    console.log(`pod ${pod.id} on ${entry.gpu} at $${pod.costPerHr}/h; time limit ${limitMinutes} min`);
    const base = `https://${pod.id}-8000.proxy.runpod.net`;
    const api = async (p, init = {}) => fetch(base + p, { ...init, headers: { 'x-token': token, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(90_000) });
    const deadline = t0 + limitMinutes * 60_000;
    let health = null, lastStage = '';
    // A host that isn't ready in this long is stuck (a slow mirror, a broken image): give it back.
    const setupDeadline = Math.min(deadline, Date.now() + 35 * 60_000);
    while (Date.now() < setupDeadline) {
      await sleep(15_000);
      try {
        const r = await api('/health');
        if (r.ok) { health = await r.json(); if (/failed/.test(health.stage)) throw new Error(`setup failed: ${health.stage}`); if (health.stage !== lastStage) { console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${health.stage}`); lastStage = health.stage; } if (health.ready) break; }
      } catch { /* the proxy answers once the pod is up */ }
    }
    if (!health?.ready) throw new Error(`the worker did not finish setting up in time (last stage: ${health?.stage ?? 'no answer'})`);
    if (a['wait-dir']) {
      const want = Number(a.expect ?? 1), until = Math.min(deadline, Date.now() + 45 * 60_000);
      const list = () => readdirSync(a['wait-dir']).filter((f) => f.endsWith('.png')).map((f) => path.join(a['wait-dir'], f));
      while (list().length < want && Date.now() < until) { await sleep(20_000); await api('/health').catch(() => null); }
      const got = list();
      console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${got.length} of ${want} inputs ready`);
      for (const f of got) if (!images.includes(f)) images.push(f);
      entry.images = images.map((f) => path.basename(f));
    }
    for (const f of images) {
      const r = await api(`/images/${path.basename(f).replace(/[^A-Za-z0-9_.-]/g, '_')}`, { method: 'PUT', body: readFileSync(f) });
      if (!r.ok) throw new Error(`upload ${f}: ${r.status}`);
    }
    const started = await api('/run', { method: 'POST' });
    if (!started.ok) throw new Error(`run: ${started.status} ${await started.text()}`);
    // Stop waiting a few minutes before the limit: what is finished is still downloaded.
    const stopWaiting = deadline - 6 * 60_000;
    let done = -1;
    while (Date.now() < stopWaiting) {
      await sleep(20_000);
      const r = await api('/health').catch(() => null);
      if (!r?.ok) continue;
      health = await r.json();
      if (health.done.length !== done) { done = health.done.length; console.log(`[${Math.round((Date.now() - t0) / 1000)} s] ${done} of ${images.length} layered`); }
      if (!health.busy) break;
    }
    const log = await (await api('/log')).text();
    mkdirSync(a.out, { recursive: true });
    writeFileSync(path.join(a.out, 'worker.log'), log);
    if (health.busy) console.log('time is nearly up: downloading what is finished');
    if (health.error) console.log(`worker error: ${health.error}`);
    const zip = await api('/result.zip');
    if (!zip.ok) throw new Error(`download: ${zip.status}`);
    const buf = Buffer.from(await zip.arrayBuffer());
    writeFileSync(path.join(a.out, 'result.zip'), buf);
    entry.result = `${health.done.length}/${images.length} layered${health.error ? ` (${health.error})` : ''}; ${Math.round(buf.length / 1e6)} MB`;
    console.log(entry.result);
  } catch (e) {
    entry.result = `failed: ${String(e.message).slice(0, 160)}`;
    throw e;
  } finally {
    if (pod?.id) {
      for (let i = 0; i < 5; i++) { try { await terminate(pod.id); break; } catch (e) { console.log(`terminate retry: ${e.message}`); await sleep(5000); } }
    }
    entry.stop = new Date().toISOString();
    entry.seconds = Math.round((Date.now() - t0) / 1000);
    if (entry.pricePerHr != null) entry.costUsd = Math.round(((entry.pricePerHr * entry.seconds) / 3600) * 1000) / 1000;
    await sleep(5000);
    const after = await cleanup().catch(() => null);
    entry.balanceAfter = after ? Number(after.clientBalance) : null;
    if (after?.pods?.length) entry.result += ' — WARNING: pods were still listed and were terminated';
    saveLedger(L);
    console.log(`stopped; ${entry.seconds} s, ~$${entry.costUsd ?? '?'}; balance now ${entry.balanceAfter ?? 'unknown'}`);
  }
}

try {
  if (cmd === 'status') await status();
  else if (cmd === 'cleanup') { await cleanup(); console.log('nothing left running'); }
  else if (cmd === 'run') await run(positionals);
  else { console.error('usage: session.mjs status | cleanup | run --out <dir> <images…>'); process.exit(2); }
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
}
