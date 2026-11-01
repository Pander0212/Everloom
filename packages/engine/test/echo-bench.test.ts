/** §12: ECHO must beat recency-only, plain top-k and Everloom's legacy recall (500-record story). */
import { describe, expect, it } from 'vitest';
import { runSize } from '../../../tests/echo-bench/run.js';

describe('ECHO benchmark', () => {
  it('beats every baseline on recall, MRR and staying quiet; the packet stays small', () => {
    const r = runSize(500);
    const e = r.systems.echo;
    for (const b of ['recency', 'topk', 'legacy'] as const) {
      const s = r.systems[b];
      expect(e.recallAt3, b).toBeGreaterThan(s.recallAt3);
      expect(e.mrr, b).toBeGreaterThan(s.mrr);
      expect(e.quiet, b).toBeGreaterThanOrEqual(s.quiet);
      expect(e.precisionAt5, b).toBeGreaterThan(s.precisionAt5);
    }
    expect(e.quiet).toBe(1);
    expect(e.tokens).toBeLessThan(1000);
  });
});
