/** Runs fitting jobs in a worker (one at a time), with progress and cancelling. */
import { buildBvh } from './bvh';
import { coveredTriangles, transferToGarment, type BodyInput, type GarmentInput, type TransferOptions, type TransferResult } from './core';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (f: number) => void }>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'fit' });
  } catch { return null; }
  worker.onmessage = (e: MessageEvent<{ id: number; progress?: number; result?: unknown; covered?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    if (e.data.progress !== undefined) { p.progress?.(e.data.progress); return; }
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data.result ?? e.data.covered);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(`The fitting worker stopped: ${e.message || 'unknown error'}`));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function run<T>(msg: Record<string, unknown>, transfer: Transferable[], progress?: (f: number) => void, signal?: AbortSignal): Promise<T> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('no-worker'));
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
    signal?.addEventListener('abort', () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      // The only way to stop a busy worker: start a fresh one next time.
      w.terminate();
      if (worker === w) worker = null;
      for (const p of pending.values()) p.reject(new Error('Cancelled'));
      pending.clear();
      reject(new Error('Cancelled'));
    });
    w.postMessage({ id, ...msg }, transfer);
  });
}

/** Weight and morph transfer for the placed garment pieces. Input arrays are copied, not moved. */
export async function transferInWorker(body: BodyInput, garments: GarmentInput[], options: Partial<TransferOptions>, progress?: (f: number) => void, signal?: AbortSignal): Promise<TransferResult> {
  try {
    return await run<TransferResult>({ op: 'transfer', body, garments, options }, [], progress, signal);
  } catch (e) {
    if ((e as Error).message !== 'no-worker') throw e;
    // No workers (old browsers, tests): do it here, in one go.
    return transferToGarment(body, garments, options, undefined, progress);
  }
}

/** Which body triangles a garment covers (1) or leaves showing (0). */
export async function coverInWorker(body: { positions: Float32Array; indices: Uint32Array }, garment: { positions: Float32Array; indices: Uint32Array }, maxDistance: number, signal?: AbortSignal): Promise<Uint8Array> {
  try {
    return await run<Uint8Array>({ op: 'cover', body, garment, maxDistance }, [], undefined, signal);
  } catch (e) {
    if ((e as Error).message !== 'no-worker') throw e;
    return coveredTriangles(body, buildBvh(garment), maxDistance);
  }
}
