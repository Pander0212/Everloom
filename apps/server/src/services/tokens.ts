/** Real tokenizer (o200k via js-tiktoken) with a cheap cache; falls back to estimation. */
import { estimateTokens } from '@everloom/engine';
import { getEncoding, type Tiktoken } from 'js-tiktoken';

let enc: Tiktoken | null | undefined;
const cache = new Map<string, number>();

function encoder(): Tiktoken | null {
  if (enc !== undefined) return enc;
  try {
    enc = getEncoding('o200k_base');
  } catch {
    enc = null;
  }
  return enc;
}

export function countTokens(text: string): number {
  if (!text) return 0;
  if (text.length > 200_000) return estimateTokens(text);
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const e = encoder();
  let n: number;
  try {
    n = e ? e.encode(text, 'all').length : estimateTokens(text);
  } catch {
    n = estimateTokens(text);
  }
  if (cache.size > 5000) cache.clear();
  cache.set(text, n);
  return n;
}
