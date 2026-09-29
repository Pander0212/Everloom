/** Deterministic, seedable RNG helpers. Same seed always gives the same sequence. */

/** FNV-1a 32-bit hash of a string. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Combine several parts into one 32-bit seed. */
export function seedFrom(...parts: Array<string | number>): number {
  return hashString(parts.map(String).join('␟'));
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** True with probability p (0..1). */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
}

/** mulberry32 — tiny, fast, good enough for games. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int(min, max) {
      if (max < min) [min, max] = [max, min];
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(p) {
      return next() < p;
    },
    pick(items) {
      if (!items.length) throw new Error('pick from empty list');
      return items[Math.floor(next() * items.length)];
    },
    shuffle(items) {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return rng;
}

/** Parse and roll dice notation like "2d6+3" or "d20". Returns null when invalid. */
export function rollDice(notation: string, rng: Rng): { total: number; rolls: number[] } | null {
  const m = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(notation);
  if (!m) {
    const n = Number(notation);
    if (Number.isFinite(n) && n > 0) return rollDice(`1d${Math.floor(n)}`, rng);
    return null;
  }
  const count = Math.min(100, Math.max(1, Number(m[1] || 1)));
  const sides = Math.min(10000, Math.max(1, Number(m[2])));
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(rng.int(1, sides));
  let total = rolls.reduce((s, r) => s + r, 0);
  if (m[3] && m[4]) total += (m[3] === '-' ? -1 : 1) * Number(m[4]);
  return { total, rolls };
}
