/** Builds code-made characters off the main thread. */
import { codeGeometry, transferables, type BuildOptions } from './geometry';

self.onmessage = (e: MessageEvent<{ id: number; recipe: unknown; opts: BuildOptions }>) => {
  const { id, recipe, opts } = e.data;
  try {
    const g = codeGeometry(recipe, opts);
    (self as unknown as Worker).postMessage({ id, g }, transferables(g));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
