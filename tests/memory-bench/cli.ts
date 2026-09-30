/**
 * npm run bench:memory [-- --turns 320 --profile balanced --out tests/memory-bench/results.md]
 * Real model: MEMORY_BENCH_URL=https://… MEMORY_BENCH_MODEL=… [MEMORY_BENCH_KEY=…] npm run bench:memory
 */
import { writeFileSync } from 'node:fs';
import { formatReport, runBench } from './run.js';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const real = process.env.MEMORY_BENCH_URL && process.env.MEMORY_BENCH_MODEL ? { baseUrl: process.env.MEMORY_BENCH_URL, model: process.env.MEMORY_BENCH_MODEL, apiKey: process.env.MEMORY_BENCH_KEY } : null;
const report = await runBench({ turns: arg('turns') ? Number(arg('turns')) : undefined, seed: arg('seed') ? Number(arg('seed')) : undefined, profile: (arg('profile') as any) ?? 'balanced', real, log: (l) => console.error(l) });
const text = formatReport(report);
console.log(text);
if (process.argv.includes('--misses')) for (const m of report.misses) console.log(`${m.system} ${m.kind}: ${m.cue} -> ${m.expect}`);
const out = arg('out');
if (out) writeFileSync(out, `${text}\n`);
