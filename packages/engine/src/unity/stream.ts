/** Bounded-memory tar extraction with backpressure; consumers must drain each entry before advancing. */
import { DEFAULT_TAR_LIMITS, TarLimitError, type TarLimits } from './tar';
export interface StreamEntry { name: string; size: number; chunks: AsyncIterable<Uint8Array> }
export async function* streamTar(source: AsyncIterable<Uint8Array>, limits: TarLimits = DEFAULT_TAR_LIMITS): AsyncGenerator<StreamEntry> {
  const input = source[Symbol.asyncIterator]();
  let buffer: Uint8Array = new Uint8Array(0);
  let at = 0, count = 0, total = 0, longName = '', paxName = '';
  const take = async (n: number): Promise<Uint8Array> => {
    if (at === buffer.length) {
      const next = await input.next();
      if (next.done) throw new Error('Truncated tar archive');
      buffer = next.value; at = 0;
      if (!buffer.length) return take(n);
    }
    const out = buffer.subarray(at, at + Math.min(n, buffer.length - at)); at += out.length; return out;
  };
  const read = async (n: number) => {
    const out = new Uint8Array(n); let off = 0;
    while (off < n) { const chunk = await take(n - off); out.set(chunk, off); off += chunk.length; }
    return out;
  };
  const str = (b: Uint8Array) => new TextDecoder().decode(b).split('\0')[0]!.trim();
  const number = (b: Uint8Array) => b[0]! & 128 ? [...b.subarray(1)].reduce((n, v) => n * 256 + v, 0) : parseInt(str(b) || '0', 8);
  try {
    for (;;) {
      const h = await read(512);
      if (h.every(v => v === 0)) return;
      const sum = h.reduce((n, v, i) => n + (i >= 148 && i < 156 ? 32 : v), 0);
      if (sum !== number(h.subarray(148, 156))) throw new Error('Invalid tar header checksum');
      const size = number(h.subarray(124, 136)), type = String.fromCharCode(h[156] || 48);
      if (!Number.isSafeInteger(size) || size < 0 || size > limits.maxFileBytes) throw new TarLimitError('An archive entry exceeds the configured file limit');
      const prefix = str(h.subarray(345, 500));
      let name = paxName || longName || `${prefix ? prefix + '/' : ''}${str(h.subarray(0, 100))}`;
      paxName = longName = '';
      let remaining = size;
      async function* chunks() {
        while (remaining) { const c = await take(Math.min(remaining, 4 * 1024 * 1024)); remaining -= c.length; yield c; }
      }
      if (['L', 'x', 'g'].includes(type)) {
        if (size > 1024 * 1024) throw new TarLimitError('Archive metadata is too large');
        const body = await read(size); remaining = 0;
        if (type === 'L') longName = str(body);
        if (type === 'x') paxName = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(new TextDecoder().decode(body))?.[1] ?? '';
      } else {
        if (++count > limits.maxEntries || (total += size) > limits.maxTotalBytes) throw new TarLimitError('The archive exceeds its entry or unpacked-size limit');
        name = name.replace(/^\.\//, '');
        if (type === '0' || type === '7') yield { name, size, chunks: chunks() };
        for await (const _ of chunks()) { /* safely skip unconsumed entries and links */ }
      }
      const padding = (512 - size % 512) % 512;
      if (padding) await read(padding);
    }
  } finally { await input.return?.(); }
}
