import type { DB } from '../db/index.js';

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

export function isLocked(db: DB, key: string, now = Date.now()): number {
  const row = db.prepare('SELECT locked_until FROM auth_failures WHERE key = ?').get(key) as { locked_until: number } | undefined;
  return row && row.locked_until > now ? row.locked_until : 0;
}

export function recordFailure(db: DB, key: string, now = Date.now()) {
  const row = db.prepare('SELECT count, first_at FROM auth_failures WHERE key = ?').get(key) as { count: number; first_at: number } | undefined;
  if (!row || now - row.first_at > WINDOW_MS) {
    db.prepare('INSERT INTO auth_failures (key, count, first_at, locked_until) VALUES (?, 1, ?, 0) ON CONFLICT(key) DO UPDATE SET count = 1, first_at = excluded.first_at, locked_until = 0').run(key, now);
    return;
  }
  const count = row.count + 1;
  const lockedUntil = count >= MAX_FAILURES ? now + LOCK_MS : 0;
  db.prepare('UPDATE auth_failures SET count = ?, locked_until = ? WHERE key = ?').run(count, lockedUntil, key);
}

export function clearFailures(db: DB, key: string) {
  db.prepare('DELETE FROM auth_failures WHERE key = ?').run(key);
}

/** Simple in-memory fixed-window limiter for bursty endpoints. */
export class WindowLimiter {
  private hits = new Map<string, { n: number; start: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  take(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || now - h.start > this.windowMs) {
      this.hits.set(key, { n: 1, start: now });
      if (this.hits.size > 10000) this.hits.clear();
      return true;
    }
    h.n++;
    return h.n <= this.max;
  }
}
