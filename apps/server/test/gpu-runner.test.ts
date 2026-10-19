/** tools/gpu: the budget guard, GPU choice, key redaction, and that a pod is always terminated. */
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without types
import { budgetCheck, chooseGpus, redact, spentUsd, POD_PREFIX } from '../../../tools/gpu/lib.mjs';
// @ts-expect-error plain .mjs without types
import { runSession } from '../../../tools/gpu/run.mjs';

const ledger = (costs: number[]) => ({ sessions: costs.map((c) => ({ costUsd: c })) });
const TYPES = [
  { id: 'NVIDIA A40', displayName: 'A40', memoryInGb: 48, communityPrice: 0.35, securePrice: 0.59 },
  { id: 'NVIDIA GeForce RTX 3090', displayName: 'RTX 3090', memoryInGb: 24, communityPrice: 0.22, securePrice: 0.5 },
  { id: 'NVIDIA H100', displayName: 'H100', memoryInGb: 80, communityPrice: 2.69, securePrice: 3.99 },
];

describe('budget guard', () => {
  it('allows a job whose worst case fits under the cap and the balance', () => {
    expect(budgetCheck({ ledger: ledger([0.5]), balanceUsd: 3, capUsd: 2.9, pricePerHr: 0.37, maxMinutes: 120 })).toMatchObject({ ok: true, worst: 0.74, spent: 0.5 });
  });
  it('refuses a job that could cross the cap', () => {
    const r = budgetCheck({ ledger: ledger([2.5]), balanceUsd: 3, capUsd: 2.9, pricePerHr: 0.37, maxMinutes: 120 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/over the \$2\.90 cap/);
  });
  it('refuses when the balance cannot cover the worst case, or is unreadable', () => {
    expect(budgetCheck({ ledger: ledger([]), balanceUsd: 0.4, capUsd: 2.9, pricePerHr: 0.37, maxMinutes: 120 }).ok).toBe(false);
    expect(budgetCheck({ ledger: ledger([]), balanceUsd: NaN, capUsd: 2.9, pricePerHr: 0.37, maxMinutes: 60 }).ok).toBe(false);
  });
  it('counts open sessions at their worst case', () => {
    expect(spentUsd({ sessions: [{ costUsd: 0.2 }, { worstCaseUsd: 0.7 }] })).toBe(0.9);
  });
});

describe('GPU choice', () => {
  it('picks the cheapest card with enough memory, community first, within the price ceiling', () => {
    expect(chooseGpus(TYPES, { minVramGb: 24, maxPricePerHr: 1 }).map((g: { name: string; cloud: string }) => `${g.name}/${g.cloud}`)).toEqual(['RTX 3090/COMMUNITY', 'A40/COMMUNITY', 'RTX 3090/SECURE', 'A40/SECURE']);
    expect(chooseGpus(TYPES, { minVramGb: 40, maxPricePerHr: 1 })[0]).toMatchObject({ name: 'A40', cloud: 'COMMUNITY' });
    expect(chooseGpus(TYPES, { minVramGb: 24, allow: ['NVIDIA A40'] }).every((g: { name: string }) => g.name === 'A40')).toBe(true);
  });
});

describe('redaction', () => {
  it('removes the given secrets and anything key-shaped', () => {
    const k = ['rpa', 'X'.repeat(40)].join('_');
    const nano = ['sk', 'nano', '01234567-89ab-cdef-0123-456789abcdef'].join('-');
    expect(redact(`Bearer ${k} and ${nano} and mysecretvalue1`, ['mysecretvalue1'])).toBe('Bearer [redacted] and [redacted] and [redacted]');
  });
});

/** A fake RunPod account: records pods made and terminated. */
function fakeRunPod({ failDeploy = false } = {}) {
  const pods = new Map<string, { id: string; name: string }>();
  const calls: string[] = [];
  let n = 0;
  const gql = async (q: string, v: { id?: string; input?: { name: string } } = {}) => {
    if (q.includes('myself')) return { myself: { clientBalance: 3, currentSpendPerHr: 0, pods: [...pods.values()], networkVolumes: [] } };
    if (q.includes('gpuTypes')) return { gpuTypes: TYPES };
    if (q.includes('podFindAndDeployOnDemand')) {
      if (failDeploy) throw new Error('no capacity');
      const id = `pod${++n}`;
      pods.set(id, { id, name: v.input!.name });
      calls.push(`deploy ${v.input!.name}`);
      return { podFindAndDeployOnDemand: { id, costPerHr: 0.35 } };
    }
    if (q.includes('podTerminate')) { pods.delete(v.id!); calls.push(`terminate ${v.id}`); return { podTerminate: null }; }
    throw new Error(`unexpected query ${q.slice(0, 40)}`);
  };
  return { gql, pods, calls };
}

const job = (out: string) => ({ job: 'test', models: ['trellis2'], inputs: ['tests/fixtures/textures/quarters.png'], out, minVramGb: 40, maxMinutes: 30, setupMinutes: 5 });
const files = () => { const d = mkdtempSync(path.join(tmpdir(), 'gpu-')); return { out: d, ledgerFile: path.join(d, 'l.json'), ledgerMd: path.join(d, 'l.md') }; };
let clock = 0;
const deps = (gql: unknown, f: ReturnType<typeof files>, http: (u: string, i?: RequestInit) => Promise<Response>) => ({ gql, http, ...f, sleep: async () => { clock += 20_000; }, now: () => clock, log: () => {}, bundle: () => 'x' });

describe('a GPU session', () => {
  it('terminates the pod when the job fails half-way, and records the cost', async () => {
    const rp = fakeRunPod();
    const f = files();
    const http = async (u: string) => {
      if (u.endsWith('/health')) return new Response(JSON.stringify({ stages: { trellis2: 'ready' }, busy: false }));
      throw new Error('the connection dropped');
    };
    await expect(runSession(job(f.out), deps(rp.gql, f, http))).rejects.toThrow(/connection dropped/);
    expect(rp.calls).toEqual([`deploy ${POD_PREFIX}test`, 'terminate pod1']);
    expect(rp.pods.size).toBe(0);
    const L = JSON.parse(readFileSync(f.ledgerFile, 'utf8'));
    expect(L.sessions[0]).toMatchObject({ gpu: 'A40', result: expect.stringMatching(/^failed/) });
    expect(L.sessions[0].costUsd).toBeGreaterThan(0);
    expect(readFileSync(f.ledgerMd, 'utf8')).toContain('| test |');
  });
  it('terminates the pod when no model sets up', async () => {
    const rp = fakeRunPod();
    const f = files();
    const http = async (u: string) => new Response(u.endsWith('/health') ? JSON.stringify({ stages: { trellis2: 'failed: pip' }, busy: false }) : 'log');
    await expect(runSession(job(f.out), deps(rp.gql, f, http))).rejects.toThrow(/no model finished setting up/);
    expect(rp.pods.size).toBe(0);
    expect(existsSync(path.join(f.out, 'setup-trellis2.log'))).toBe(true);
  });
  it('starts nothing when no GPU is available, and leaves no pod', async () => {
    const rp = fakeRunPod({ failDeploy: true });
    const f = files();
    await expect(runSession(job(f.out), deps(rp.gql, f, async () => new Response('{}')))).rejects.toThrow(/no GPU was available/);
    expect(rp.pods.size).toBe(0);
  });
  it('refuses to start a job over the cap', async () => {
    const rp = fakeRunPod();
    const f = files();
    await expect(runSession({ ...job(f.out), maxMinutes: 240 }, { ...deps(rp.gql, f, async () => new Response('{}')), capUsd: 0.5 })).rejects.toThrow(/no GPU was available within the budget/);
    expect(rp.calls).toEqual([]);
  });
});
