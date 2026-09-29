/** Fetch wrapper: same-origin cookies, CSRF header, client id (for echo suppression) and typed errors. */
let csrfToken = '';
export const clientId: string = (() => {
  try {
    const existing = sessionStorage.getItem('everloom.clientId');
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem('everloom.clientId', id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2);
  }
})();

export function setCsrf(token: string | null | undefined) {
  if (token) csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

type Listener = () => void;
const authListeners = new Set<Listener>();
export function onAuthRequired(fn: Listener) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Send a Blob/File/ArrayBuffer as raw bytes. */
  raw?: Blob | ArrayBuffer | Uint8Array;
  contentType?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
}

function headers(opts: ApiOptions): Record<string, string> {
  const h: Record<string, string> = { 'x-client-id': clientId };
  if (csrfToken) h['x-csrf-token'] = csrfToken;
  if (opts.raw) h['content-type'] = opts.contentType ?? 'application/octet-stream';
  else if (opts.body !== undefined) h['content-type'] = 'application/json';
  return h;
}

export function buildUrl(path: string, query?: ApiOptions['query']): string {
  if (!query) return path;
  const q = Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!q.length) return path;
  return `${path}?${new URLSearchParams(q.map(([k, v]) => [k, String(v)])).toString()}`;
}

export async function apiFetch(path: string, opts: ApiOptions = {}): Promise<Response> {
  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? (opts.body !== undefined || opts.raw ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: headers(opts),
    body: opts.raw ? (opts.raw as BodyInit) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  if (!res.ok) {
    let msg = res.statusText || 'Request failed';
    let code: string | undefined;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
      code = j.code;
    } catch {
      /* not json */
    }
    if (res.status === 401 && code === 'auth_required') authListeners.forEach((fn) => fn());
    throw new ApiError(res.status, msg, code);
  }
  return res;
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const res = await apiFetch(path, opts);
  const text = await res.text();
  if (!text) return undefined as T;
  const json = JSON.parse(text);
  if (json && typeof json === 'object' && 'csrf' in json) setCsrf(json.csrf);
  return json as T;
}

export const get = <T = any>(path: string, query?: ApiOptions['query']) => api<T>(path, { query });
export const post = <T = any>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });
export const upload = <T = any>(path: string, file: Blob, query?: ApiOptions['query']) =>
  api<T>(path, { method: 'POST', raw: file, contentType: file.type || 'application/octet-stream', query });

/** POST and read an SSE response as an async stream of JSON events. */
export async function* streamPost<T = any>(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<T> {
  const res = await apiFetch(path, { method: 'POST', body, signal });
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of block.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            yield JSON.parse(line.slice(6)) as T;
          } catch {
            /* ignore partial */
          }
        }
      }
    }
  }
}

/** Download a server file (keeps cookies; works in standalone PWA). */
export async function download(path: string, fallbackName: string) {
  const res = await apiFetch(path);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
