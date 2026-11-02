/**
 * Embedding calls that the provider refuses for good (a subscription-only key, no access to the
 * model, a missing key) are not retried on every turn: the connection is paused for embeddings for
 * a while, and recall simply runs without the semantic signal. Rate limits and outages are not
 * paused (they pass).
 */
const paused = new Map<string, number>();
const PAUSE_MS = 30 * 60_000;

export function embeddingsPaused(connId: string): boolean {
  const until = paused.get(connId);
  if (!until) return false;
  if (Date.now() > until) {
    paused.delete(connId);
    return false;
  }
  return true;
}

/** Call after a failed embedding request. Returns true when the connection is now paused. */
export function noteEmbeddingFailure(connId: string, err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  // A rate limit: wait as long as the provider asks (default a minute), then try again.
  if (/\b429\b|rate.?limit|too many requests/i.test(msg) && !/subscription.only|cannot spend|billing/i.test(msg)) {
    const secs = Number(msg.match(/(?:try again in|retry after|wait)\s*(\d{1,5})\s*s/i)?.[1] ?? 60);
    paused.set(connId, Date.now() + Math.min(3600, Math.max(5, secs)) * 1000);
    return true;
  }
  if (/subscription.only|cannot spend|billing|insufficient|not allowed|permission|unauthori[sz]ed|forbidden|invalid api key|\b40[13]\b|model.*not (found|available)/i.test(msg)) {
    paused.set(connId, Date.now() + PAUSE_MS);
    return true;
  }
  return false;
}
