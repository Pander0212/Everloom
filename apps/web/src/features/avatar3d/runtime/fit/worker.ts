/** Garment fitting off the main thread: weight and morph transfer, and covered-skin tests. */
import { buildBvh } from './bvh';
import { coveredTriangles, transferToGarment, type BodyInput, type GarmentInput, type TransferOptions } from './core';

export type FitRequest =
  | { id: number; op: 'transfer'; body: BodyInput; garments: GarmentInput[]; options: Partial<TransferOptions> }
  | { id: number; op: 'cover'; body: { positions: Float32Array; indices: Uint32Array }; garment: { positions: Float32Array; indices: Uint32Array }; maxDistance: number };

self.onmessage = (e: MessageEvent<FitRequest>) => {
  const req = e.data;
  const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
  try {
    if (req.op === 'transfer') {
      let last = 0;
      const result = transferToGarment(req.body, req.garments, req.options, undefined, (f) => {
        const now = Date.now();
        if (now - last > 80) { last = now; post({ id: req.id, progress: f }); }
      });
      const buffers: Transferable[] = [];
      for (const m of result.meshes) buffers.push(m.positions.buffer, m.joints.buffer, m.weights.buffer, m.flags.buffer, ...m.morphs.map((x) => x.deltas.buffer));
      post({ id: req.id, result }, buffers);
    } else {
      const bvh = buildBvh(req.garment);
      const covered = coveredTriangles(req.body, bvh, req.maxDistance);
      post({ id: req.id, covered }, [covered.buffer]);
    }
  } catch (err) {
    post({ id: req.id, error: (err as Error).message });
  }
};
