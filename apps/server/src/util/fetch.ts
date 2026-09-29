/** Guarded outbound HTTP for user-configured endpoints: scheme check, timeouts, response size caps. */
import { HttpError } from '../context.js';

export interface SafeFetchOptions extends RequestInit {
  timeoutMs?: number;
  /** Abort if no bytes arrive for this long while streaming. */
  idleMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, `Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http(s) URLs are allowed');
  if (url.username || url.password) throw new HttpError(400, 'Put credentials in the API key field, not the URL');
  return url;
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<Response> {
  const url = checkUrl(raw);
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error('Request timed out')), opts.timeoutMs ?? 60_000);
  const onAbort = () => ctrl.abort(opts.signal?.reason ?? new Error('Aborted'));
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timeout);
    return res;
  } catch (e) {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onAbort);
    const err = e as Error;
    if (opts.signal?.aborted) throw err;
    throw new HttpError(502, `Could not reach ${url.host}: ${err.message}`, 'upstream');
  }
  // The abort listener stays attached so a caller can still cancel while the body streams.
}

/** Read a response body with a size cap. */
export async function readCapped(res: Response, maxBytes = 20 * 1024 * 1024): Promise<Buffer> {
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new HttpError(502, 'Upstream response too large');
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(502, 'Upstream response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function readJson<T = any>(res: Response, maxBytes?: number): Promise<T> {
  const buf = await readCapped(res, maxBytes);
  const text = buf.toString('utf8');
  if (!res.ok) {
    let msg = text.slice(0, 500);
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail ?? msg;
      if (typeof msg !== 'string') msg = JSON.stringify(msg).slice(0, 500);
    } catch {
      /* plain text */
    }
    throw new HttpError(502, `Upstream ${res.status}: ${msg}`, 'upstream');
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, 'Upstream returned invalid JSON', 'upstream');
  }
}

/** Iterate SSE `data:` payloads (and `event:` names) from a streaming response with an idle timeout. */
export async function* sseEvents(res: Response, idleMs = 120_000, maxBytes = 50 * 1024 * 1024): AsyncGenerator<{ event: string; data: string }> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let total = 0;
  let event = 'message';
  let dataLines: string[] = [];
  for (;;) {
    let timer: NodeJS.Timeout | undefined;
    const idle = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new HttpError(504, 'Upstream stream stalled')), idleMs);
    });
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await Promise.race([reader.read(), idle]);
    } catch (e) {
      await reader.cancel().catch(() => {});
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (chunk.done) break;
    total += chunk.value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(502, 'Upstream stream too large');
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    let idx: number;
    while ((idx = buffer.search(/\r?\n/)) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + (buffer[idx] === '\r' ? 2 : 1));
      if (line === '') {
        if (dataLines.length) yield { event, data: dataLines.join('\n') };
        event = 'message';
        dataLines = [];
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'data') dataLines.push(value);
      else if (field === 'event') event = value;
    }
  }
  if (dataLines.length) yield { event, data: dataLines.join('\n') };
}

/** Iterate newline-delimited JSON objects (Ollama-style streams). */
export async function* ndjsonLines(res: Response): AsyncGenerator<any> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) {
        try {
          yield JSON.parse(line);
        } catch {
          /* skip */
        }
      }
    }
  }
}
