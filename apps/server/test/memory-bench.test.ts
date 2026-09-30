import { expect, it } from 'vitest';
import { formatReport, runBench } from '../../../tests/memory-bench/run.js';

// The memory benchmark as a regression guard: a shorter run of the synthetic campaign (mock mode,
// deterministic). The full 320-turn run is `npm run bench:memory`; its numbers are in
// docs/PHASE2_DECISIONS.md.
it('new memory clearly beats the Phase-1 memory on the benchmark campaign', async () => {
  const r = await runBench({ turns: 200 });
  const report = formatReport(r);
  expect(r.new.recall, report).toBeGreaterThanOrEqual(0.75);
  expect(r.new.recall - r.old.recall, report).toBeGreaterThanOrEqual(0.3);
  expect(r.new.person, report).toBeGreaterThanOrEqual(0.75);
  expect(r.new.leak, report).toBe(0);
  expect(r.new.fact, report).toBeGreaterThanOrEqual(0.8);
  expect(r.new.stale, report).toBe(0);
  // Memory must not cost much more of the prompt than before.
  expect(r.new.avgTokens, report).toBeLessThanOrEqual(r.old.avgTokens * 1.35);
  // One tracker call per turn; background work stays a small fraction of turns.
  expect(r.callsPerTurn.tracker, report).toBeLessThanOrEqual(1.05);
  expect((r.callsPerTurn.chronicler ?? 0) + (r.callsPerTurn.consolidation ?? 0), report).toBeLessThan(0.3);
}, 300_000);
