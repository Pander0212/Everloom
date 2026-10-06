/** Runs model optimization off the main thread (texture encoding can take a minute). */
import { parentPort } from 'node:worker_threads';
import { optimizeModel, type OptimizeOptions } from './optimize.js';

parentPort?.on('message', async (m: { bytes: Uint8Array; opts: OptimizeOptions }) => {
  try {
    const r = await optimizeModel(Buffer.from(m.bytes), m.opts);
    parentPort!.postMessage({ ok: true, main: r.main, low: r.low, report: r.report });
  } catch (e) {
    parentPort!.postMessage({ ok: false, error: (e as Error).message });
  }
});
