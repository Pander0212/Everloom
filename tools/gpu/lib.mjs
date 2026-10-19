/**
 * Everloom's GPU job runner, the parts that don't touch the network (so they're unit-tested):
 * the budget guard, the ledger, GPU choice and key redaction. tools/gpu/run.mjs drives RunPod with
 * them. docs/3d-gen/README.md explains the whole pipeline.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Name prefix of every pod this runner creates; only these are ever listed or terminated. */
export const POD_PREFIX = 'everloom-gen-';

/** The owner's cap for this work (USD), unless EVERLOOM_GPU_CAP_USD says otherwise. */
export const DEFAULT_CAP_USD = 2.9;
/** Never let the account drop below this, whatever the cap. */
export const BALANCE_FLOOR_USD = 0.05;

/** Total cost of every session in the ledger (finished sessions, plus the worst case of open ones). */
export function spentUsd(ledger) {
  return round(ledger.sessions.reduce((t, s) => t + (s.costUsd ?? s.worstCaseUsd ?? 0), 0));
}

/**
 * May a job start? It may cost at most pricePerHr × maxMinutes (the pod stops itself then). It is
 * refused if that worst case could take the spending past the cap, or the balance below the floor.
 */
export function budgetCheck({ ledger, balanceUsd, capUsd = DEFAULT_CAP_USD, pricePerHr, maxMinutes }) {
  const worst = round((pricePerHr * maxMinutes) / 60);
  const spent = spentUsd(ledger);
  if (!Number.isFinite(balanceUsd)) return { ok: false, worst, spent, reason: 'the RunPod balance could not be read' };
  if (!(pricePerHr > 0) || !(maxMinutes > 0)) return { ok: false, worst, spent, reason: 'no price or time limit' };
  if (spent + worst > capUsd) return { ok: false, worst, spent, reason: `the worst case ($${worst.toFixed(2)}) would take spending to $${(spent + worst).toFixed(2)}, over the $${capUsd.toFixed(2)} cap` };
  if (balanceUsd - worst < BALANCE_FLOOR_USD) return { ok: false, worst, spent, reason: `the balance ($${balanceUsd.toFixed(2)}) can't cover the worst case ($${worst.toFixed(2)})` };
  return { ok: true, worst, spent };
}

/**
 * The cheapest GPU type that has enough memory, from RunPod's live gpuTypes list. Community cloud
 * first (cheaper); `allow` limits the choice (e.g. one CUDA architecture the setup is compiled for).
 */
export function chooseGpus(gpuTypes, { minVramGb, allow = null, maxPricePerHr = 1 }) {
  const out = [];
  for (const g of gpuTypes) {
    if ((g.memoryInGb ?? 0) < minVramGb) continue;
    if (allow && !allow.includes(g.id)) continue;
    for (const [cloud, price] of [['COMMUNITY', g.communityPrice], ['SECURE', g.securePrice]]) if (price > 0 && price <= maxPricePerHr) out.push({ id: g.id, name: g.displayName, cloud, price, vram: g.memoryInGb });
  }
  return out.sort((a, b) => a.price - b.price);
}

/** Removes every secret (and anything shaped like a RunPod or NanoGPT key) from text bound for a log. */
export function redact(text, secrets = []) {
  let s = String(text ?? '');
  for (const k of secrets) if (k && k.length >= 8) s = s.split(k).join('[redacted]');
  return s.replace(/rpa_[A-Za-z0-9]{20,}/g, '[redacted]').replace(/sk-nano-[0-9a-f-]{20,}/g, '[redacted]').replace(/hf_[A-Za-z0-9]{20,}/g, '[redacted]');
}

export const round = (n) => Math.round(n * 1000) / 1000;

export function loadLedger(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { sessions: [] };
}

/** Writes the JSON ledger and its Markdown view (docs/3d-gen/RUNPOD_LEDGER.md). */
export function saveLedger(file, mdFile, ledger, capUsd = DEFAULT_CAP_USD) {
  writeFileSync(file, JSON.stringify(ledger, null, 1) + '\n');
  let total = 0;
  const rows = ledger.sessions.map((s) => {
    total += s.costUsd ?? 0;
    const min = s.seconds != null ? `${Math.round(s.seconds / 60)} min` : '—';
    const cost = s.costUsd != null ? `$${s.costUsd.toFixed(3)}` : '—';
    return `| ${s.date} | ${s.gpu ?? '—'} (${s.cloud ?? '—'}) | ${s.pricePerHr != null ? `$${s.pricePerHr.toFixed(2)}` : '—'} | ${min} | ${cost} | $${round(total).toFixed(3)} | ${s.job} | ${String(s.result ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`;
  });
  writeFileSync(mdFile, `# RunPod ledger (3D generation)

Written by \`tools/gpu/run.mjs\` from \`runpod-ledger.json\`. Cap for this work: **$${capUsd.toFixed(2)}**
(the owner's limit). Every pod is named \`${POD_PREFIX}…\`, stops itself when idle (10 min) or past
its time limit, and is terminated by the runner in a \`finally\` step; leftovers are cleaned up at the
start and end of every session. No network volumes are used (they cost money every month).

| Date (UTC) | GPU (cloud) | Price/h | Time | Cost | Running total | Job | Result |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`);
}
