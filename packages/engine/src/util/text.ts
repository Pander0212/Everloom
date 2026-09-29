/** Lowercase, strip accents/punctuation, collapse whitespace. */
export function normalizeName(input: string): string {
  return String(input ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .replace(/['-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(input: string, fallback = 'x'): string {
  const s = normalizeName(input).replace(/\s+/g, '_').slice(0, 48);
  return s || fallback;
}

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'lady', 'lord', 'captain', 'capt', 'master', 'mistress', 'the', 'old', 'young', 'king', 'queen', 'prince', 'princess']);

/** Name tokens without honorifics. */
export function nameTokens(input: string): string[] {
  return normalizeName(input)
    .split(' ')
    .filter((t) => t && !HONORIFICS.has(t));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Score how likely two names refer to the same person, 0..1.
 * "Tobias" vs "Tobias Moreno" → high (one is a token-prefix of the other).
 * "Tobias Moreno" vs "Tobias Reyes" → low (conflicting surnames).
 */
export function nameMatchScore(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  if (ta.join(' ') === tb.join(' ')) return 0.98;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  // All tokens of the shorter name appear in the longer one, in order, first name matching.
  if (short.length < long.length && short[0] === long[0] && short.every((t) => long.includes(t))) return 0.9;
  // Single-token surname-only reference ("Moreno" → "Tobias Moreno") is weaker.
  if (short.length === 1 && long.length > 1 && long[long.length - 1] === short[0]) return 0.75;
  // Same token count: allow small typos per token.
  if (ta.length === tb.length) {
    let total = 0;
    for (let i = 0; i < ta.length; i++) {
      const d = levenshtein(ta[i], tb[i]);
      const len = Math.max(ta[i].length, tb[i].length);
      if (d > (len >= 6 ? 2 : len >= 4 ? 1 : 0)) return 0;
      total += 1 - d / len;
    }
    return 0.85 * (total / ta.length);
  }
  return 0;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/** Rough token estimate when no tokenizer is available (≈ 3.6 chars/token for English prose). */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.6);
}
