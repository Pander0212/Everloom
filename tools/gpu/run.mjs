#!/usr/bin/env node
/**
 * Runs a GPU job on RunPod: pod create → set up the models → upload inputs → run → download outputs
 * → terminate. The owner starts paid jobs; nothing here runs on its own.
 *
 *   RUNPOD_API_KEY=… node tools/gpu/run.mjs status            balance, own pods, spending vs cap
 *   RUNPOD_API_KEY=… node tools/gpu/run.mjs cleanup           terminate any leftover everloom-gen- pod
 *   RUNPOD_API_KEY=… node tools/gpu/run.mjs estimate job.json  what the job may cost at most
 *   RUNPOD_API_KEY=… node tools/gpu/run.mjs run job.json       run it
 *
 * A job (JSON): { "job": "bench", "models": ["trellis2", "hunyuan3d"], "inputs": ["samples/gen/refs/a.png"],
 *   "out": "samples/gen/bench", "minVramGb": 48, "allowGpus": ["NVIDIA A40"], "maxMinutes": 120,
 *   "setupMinutes": 50, "opts": { "trellis2": { "texture": 2048 } } }
 * Optional "env": extra (non-secret) environment for the pod's model setup, e.g. the LoRAs to fetch; "diskGb".
 * Optional "cudaVersions": hosts' CUDA versions to accept (for wheels that need a newer driver).
 * Optional "expect": { "<model>": ["a.png", …] } names the files a model makes (when they aren't one per input).
 *
 * Rules (docs/3d-gen/README.md): the key comes from the environment and is redacted from every log;
 * the budget guard refuses a job whose worst case could pass the cap (EVERLOOM_GPU_CAP_USD, default
 * $2.90); pods carry the everloom-gen- prefix, stop themselves when idle or past maxMinutes, and are
 * terminated in a finally step; leftovers are cleaned up before and after. Outputs that already exist
 * locally are skipped, so a job interrupted half-way resumes where it stopped.
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetCheck, chooseGpus, DEFAULT_CAP_USD, loadLedger, POD_PREFIX, redact, round, saveLedger, spentUsd } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
export const LEDGER = path.join(root, 'docs/3d-gen/runpod-ledger.json');
export const LEDGER_MD = path.join(root, 'docs/3d-gen/RUNPOD_LEDGER.md');
const IMAGE = 'nvidia/cuda:12.4.1-devel-ubuntu22.04';
/** Container disk: two torch installs, compiled extensions and ~35 GB of weights. */
const DISK_GB = Number(process.env.EVERLOOM_GPU_DISK_GB || 75);
/** RunPod bills container disk while the pod runs; added to the hourly price for the guard. */
const DISK_PER_HR = 0.02;
/** CUDA architecture of the rented card, so extensions are compiled for it alone (much faster). */
export const cudaArch = (name) => (/4090|L40|Ada|L4\b/i.test(name) ? '8.9' : /H100|H200/i.test(name) ? '9.0' : /A100/i.test(name) ? '8.0' : '8.6');

export function makeApi(key, fetchImpl = fetch) {
  return async function gql(query, variables = {}) {
    const r = await fetchImpl('https://api.runpod.io/graphql', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ query, variables }) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.errors) throw new Error(redact(`RunPod API: ${r.status} ${JSON.stringify(j?.errors ?? j).slice(0, 300)}`, [key]));
    return j.data;
  };
}

export const account = (gql) => gql('query { myself { clientBalance currentSpendPerHr pods { id name desiredStatus costPerHr } networkVolumes { id name size } } }').then((d) => d.myself);
export const terminate = (gql, id) => gql('mutation($id: String!) { podTerminate(input: { podId: $id }) }', { id });

/** Terminates every pod of ours (name prefix); returns the account as it was read. */
export async function cleanup(gql, log = console.log) {
  const me = await account(gql);
  for (const p of me.pods ?? []) if (String(p.name).startsWith(POD_PREFIX)) {
    await terminate(gql, p.id);
    log(`terminated leftover pod ${p.id} (${p.name})`);
  }
  return me;
}

function bundle() {
  const tgz = execFileSync('tar', ['-czf', '-', '-C', here, 'worker', 'models'], { maxBuffer: 10 * 1024 * 1024 });
  return tgz.toString('base64');
}

/**
 * One session. `deps` are injectable for tests: gql, http (fetch to the pod), sleep, now, log,
 * bundle. Whatever happens, the pod is terminated and the ledger records the session.
 */
export async function runSession(job, deps) {
  const { gql, http = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), log = console.log, capUsd = DEFAULT_CAP_USD, ledgerFile = LEDGER, ledgerMd = LEDGER_MD, secrets = [] } = deps;
  const say = (m) => log(redact(m, secrets));
  const out = path.resolve(root, job.out);
  const models = job.models;
  const stem = (f) => path.basename(f).replace(/\.[^.]+$/, '');
  // A job may list the files each model makes (job.expect[model]); otherwise one output per input.
  const doneFor = (m, f) => (job.expect?.[m] ? job.expect[m].every((n) => existsSync(path.join(out, m, n))) : existsSync(path.join(out, m, `${stem(f)}.${m === 'hunyuan3d' ? 'zip' : 'glb'}`)));
  const todo = job.inputs.filter((f) => models.some((m) => !doneFor(m, f)));
  if (!todo.length) { say('nothing to do: every output already exists'); return { skipped: true }; }

  const ledger = loadLedger(ledgerFile);
  const before = await cleanup(gql, say);
  const balance = Number(before.clientBalance);
  const maxMinutes = Math.min(job.maxMinutes ?? 90, 240);
  const types = (await gql('query { gpuTypes { id displayName memoryInGb communityPrice securePrice } }')).gpuTypes;
  const choices = chooseGpus(types, { minVramGb: job.minVramGb ?? 24, allow: job.allowGpus ?? null, maxPricePerHr: job.maxPricePerHr ?? 0.8 });
  if (!choices.length) throw new Error('no GPU type fits the job');
  const token = randomBytes(24).toString('hex');
  const entry = { date: new Date(now()).toISOString().slice(0, 10), job: job.job, models, inputs: todo.map((f) => path.basename(f)), gpu: null, cloud: null, pricePerHr: null, worstCaseUsd: null, start: null, stop: null, seconds: null, costUsd: null, balanceBefore: balance, balanceAfter: null, result: 'starting' };
  let pod = null;
  const t0 = now();
  const W = job.bundle ?? deps.bundle?.() ?? bundle();
  try {
    // Cards come and go: try every choice, then wait a minute and try again (job.deployRetries times).
    const rounds = Math.max(1, job.deployRetries ?? 15);
    for (let attempt = 0; attempt < rounds && !pod?.id; attempt++) {
    if (attempt) { say(`no card free yet; trying again in a minute (${attempt}/${rounds - 1})`); await sleep(60_000); }
    for (const c of choices) {
      if (pod?.id) break;
      const price = round(c.price + DISK_PER_HR);
      const check = budgetCheck({ ledger, balanceUsd: balance, capUsd, pricePerHr: price, maxMinutes });
      if (!check.ok) { say(`${c.name} (${c.cloud}, $${c.price}/h): refused, ${check.reason}`); continue; }
      try {
        const d = await gql('mutation($input: PodFindAndDeployOnDemandInput) { podFindAndDeployOnDemand(input: $input) { id costPerHr } }', { input: {
          cloudType: c.cloud, gpuCount: 1, gpuTypeId: c.id, allowedCudaVersions: job.cudaVersions ?? ['12.4', '12.5', '12.6', '12.7', '12.8', '12.9', '13.0'], volumeInGb: 0, containerDiskInGb: job.diskGb ?? DISK_GB, minVcpuCount: 2, minMemoryInGb: 16,
          name: `${POD_PREFIX}${job.job}`.slice(0, 60), imageName: IMAGE, ports: '8000/http', startSsh: false,
          dockerArgs: `bash -c 'mkdir -p /opt/worker && cd /opt/worker && printf %s "$W_BUNDLE" | base64 -d | tar -xz && W_BUNDLE="$W_BUNDLE" bash worker/start.sh'`,
          env: [{ key: 'WORKER_TOKEN', value: token }, { key: 'W_BUNDLE', value: W }, { key: 'MODELS', value: models.join(' ') }, { key: 'MAX_SECONDS', value: String(maxMinutes * 60) }, { key: 'IDLE_SECONDS', value: '600' }, { key: 'TORCH_CUDA_ARCH_LIST', value: job.cudaArch ?? cudaArch(c.name) }, ...Object.entries(job.env ?? {}).map(([key, value]) => ({ key, value: typeof value === 'string' ? value : JSON.stringify(value) }))],
        } });
        pod = d.podFindAndDeployOnDemand;
        if (pod?.id) deps.onPod?.(pod.id);
      } catch (e) { say(`${c.name} (${c.cloud}): ${String(e.message).slice(0, 160)}`); }
      if (pod?.id) {
        const actual = round((pod.costPerHr ?? c.price) + DISK_PER_HR);
        Object.assign(entry, { gpu: c.name, cloud: c.cloud, pricePerHr: actual, worstCaseUsd: round((actual * maxMinutes) / 60), start: new Date(now()).toISOString() });
        if (!budgetCheck({ ledger, balanceUsd: balance, capUsd, pricePerHr: actual, maxMinutes }).ok) { say(`pod came at $${actual}/h, over budget: terminating`); throw new Error('the pod was dearer than listed'); }
        break;
      }
    }
    }
    if (!pod?.id) throw new Error('no GPU was available within the budget');
    ledger.sessions.push(entry);
    saveLedger(ledgerFile, ledgerMd, ledger, capUsd);
    say(`pod ${pod.id}: ${entry.gpu} (${entry.cloud}) at $${entry.pricePerHr}/h, at most ${maxMinutes} min ($${entry.worstCaseUsd})`);

    const base = deps.podUrl?.(pod.id) ?? `https://${pod.id}-8000.proxy.runpod.net`;
    const call = (p, init = {}) => http(base + p, { ...init, headers: { 'x-token': token, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(600_000) });
    const deadline = t0 + maxMinutes * 60_000;
    const setupEnd = t0 + Math.min(job.setupMinutes ?? 50, maxMinutes - 5) * 60_000;
    let health = null, lastStages = '';
    while (now() < setupEnd) {
      await sleep(20_000);
      try { const r = await call('/health'); if (r.ok) health = await r.json(); } catch { /* not up yet */ }
      const st = JSON.stringify(health?.stages ?? {});
      if (st !== lastStages) { say(`[${Math.round((now() - t0) / 60000)} min] ${st}`); lastStages = st; }
      if (/^failed/.test(health?.stages?.gpu ?? '')) throw new Error(`bad host: ${health.stages.gpu}`);
      if (health && models.every((m) => /^(ready|failed)/.test(health.stages?.[m] ?? ''))) break;
    }
    const ready = models.filter((m) => health?.stages?.[m] === 'ready');
    mkdirSync(out, { recursive: true });
    for (const m of models) if (!ready.includes(m)) {
      const sl = await call(`/setup-log/${m}`).then((r) => r.text()).catch(() => '');
      writeFileSync(path.join(out, `setup-${m}.log`), redact(sl, secrets));
    }
    if (!ready.length) throw new Error(`no model finished setting up (${JSON.stringify(health?.stages ?? {})})`);
    for (const f of todo) if (!(await call(`/files/${path.basename(f)}`, { method: 'PUT', body: readFileSync(path.resolve(root, f)) })).ok) throw new Error(`upload failed: ${path.basename(f)}`);
    const results = {};
    for (const m of ready) {
      const only = todo.filter((f) => !doneFor(m, f)).map((f) => path.basename(f));
      if (!only.length) continue;
      const r = await call(`/run/${m}`, { method: 'POST', body: JSON.stringify({ ...(job.opts?.[m] ?? {}), only }) });
      if (!r.ok) throw new Error(`could not start ${m}`);
      const tm = now();
      while (now() < deadline - 3 * 60_000) {
        await sleep(20_000);
        const h = await call('/health').then((x) => x.json()).catch(() => null);
        if (h && !h.busy) break;
      }
      mkdirSync(path.join(out, m), { recursive: true });
      const names = await call(`/ls/${m}`).then((x) => x.json()).catch(() => []);
      for (const n of names) {
        const b = await call(`/result/${m}/${n}`);
        if (b.ok) writeFileSync(path.join(out, m, n), Buffer.from(await b.arrayBuffer()));
      }
      results[m] = { files: names.length, minutes: round((now() - tm) / 60000) };
      say(`${m}: ${names.length} files in ${results[m].minutes} min`);
    }
    writeFileSync(path.join(out, `worker-${job.job}.log`), redact(await call('/log').then((r) => r.text()).catch(() => ''), secrets));
    entry.result = `ok: ${Object.entries(results).map(([m, r]) => `${m} ${r.files} files`).join(', ')}${ready.length < models.length ? `; setup failed: ${models.filter((m) => !ready.includes(m)).join(', ')}` : ''}`;
    return { results };
  } catch (e) {
    entry.result = `failed: ${redact(String(e.message), secrets).slice(0, 200)}`;
    throw e;
  } finally {
    if (pod?.id) for (let i = 0; i < 6; i++) { try { await terminate(gql, pod.id); break; } catch { await sleep(5000); } }
    entry.stop = new Date(now()).toISOString();
    entry.seconds = Math.round((now() - t0) / 1000);
    if (entry.pricePerHr != null) entry.costUsd = round((entry.pricePerHr * entry.seconds) / 3600);
    entry.worstCaseUsd = null;
    const after = await cleanup(gql, say).catch(() => null);
    entry.balanceAfter = after ? Number(after.clientBalance) : null;
    if (after && (after.pods ?? []).some((p) => String(p.name).startsWith(POD_PREFIX))) entry.result += ' — WARNING: a pod of ours is still listed';
    if (pod?.id) {
      if (!ledger.sessions.includes(entry)) ledger.sessions.push(entry);
      saveLedger(ledgerFile, ledgerMd, ledger, capUsd);
      say(`session cost $${entry.costUsd} (spent $${spentUsd(ledger)} of $${capUsd}); balance $${entry.balanceAfter}`);
    }
  }
}

async function main() {
  const [cmd, file] = process.argv.slice(2);
  const key = process.env.RUNPOD_API_KEY;
  if (!key) { console.error('Set RUNPOD_API_KEY in the environment (never in a file).'); process.exit(1); }
  const gql = makeApi(key);
  const capUsd = Number(process.env.EVERLOOM_GPU_CAP_USD || DEFAULT_CAP_USD);
  const ledger = loadLedger(LEDGER);
  if (cmd === 'status') {
    const me = await account(gql);
    console.log(JSON.stringify({ balance: Number(me.clientBalance), spendPerHr: me.currentSpendPerHr, ourPods: (me.pods ?? []).filter((p) => String(p.name).startsWith(POD_PREFIX)), otherPods: (me.pods ?? []).filter((p) => !String(p.name).startsWith(POD_PREFIX)).length, networkVolumes: me.networkVolumes?.length ?? 0, spent: spentUsd(ledger), cap: capUsd }, null, 1));
  } else if (cmd === 'cleanup') {
    await cleanup(gql);
  } else if (cmd === 'estimate' || cmd === 'run') {
    const job = JSON.parse(readFileSync(file, 'utf8'));
    if (cmd === 'estimate') {
      const me = await account(gql);
      const types = (await gql('query { gpuTypes { id displayName memoryInGb communityPrice securePrice } }')).gpuTypes;
      const c = chooseGpus(types, { minVramGb: job.minVramGb ?? 24, allow: job.allowGpus ?? null, maxPricePerHr: job.maxPricePerHr ?? 0.8 });
      console.log(c.slice(0, 5).map((g) => ({ gpu: g.name, cloud: g.cloud, perHr: g.price, worstCase: round(((g.price + DISK_PER_HR) * (job.maxMinutes ?? 90)) / 60), ...budgetCheck({ ledger, balanceUsd: Number(me.clientBalance), capUsd, pricePerHr: g.price + DISK_PER_HR, maxMinutes: job.maxMinutes ?? 90 }) })));
    } else {
      let current = null;
      const stop = async () => { console.error('interrupted: terminating the pod'); if (current) await terminate(gql, current).catch(() => {}); await cleanup(gql).catch(() => {}); process.exit(130); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      // A host whose GPU doesn't start is caught in the first minutes; try another one (twice at most).
      for (let i = 0; ; i++) {
        try { await runSession(job, { gql, capUsd, secrets: [key], onPod: (id) => { current = id; } }); break; }
        catch (e) { if (i < 2 && /^bad host/.test(String(e.message))) { console.log(`${e.message}: trying another host`); continue; } throw e; }
      }
    }
  } else {
    console.error('usage: run.mjs status | cleanup | estimate <job.json> | run <job.json>');
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(redact(String(e?.message ?? e), [process.env.RUNPOD_API_KEY])); process.exit(1); });
