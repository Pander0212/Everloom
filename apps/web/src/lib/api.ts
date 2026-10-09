import { askPassword } from '@/ui/Dialog';
import { askExportPassword, notifyVaultLocked } from './vaultMode';
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
  return () => {
    authListeners.delete(fn);
  };
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Send a Blob/File/ArrayBuffer as raw bytes. */
  raw?: Blob | ArrayBuffer | Uint8Array;
  contentType?: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  headers?: Record<string, string>;
}

function headers(opts: ApiOptions): Record<string, string> {
  const h: Record<string, string> = { 'x-client-id': clientId };
  if (csrfToken) h['x-csrf-token'] = csrfToken;
  if (opts.raw) h['content-type'] = opts.contentType ?? 'application/octet-stream';
  else if (opts.body !== undefined) h['content-type'] = 'application/json';
  return { ...h, ...opts.headers };
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
    if (res.status === 423 && code === 'locked') notifyVaultLocked();
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
export const post = <T = any>(path: string, body: unknown = {}, o: { signal?: AbortSignal } = {}) => api<T>(path, { method: 'POST', body, signal: o.signal });
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });
/** Upload a file; a password-protected Everloom export asks for its password and is sent again. */
export async function upload<T = any>(path: string, file: Blob, query?: ApiOptions['query']): Promise<T> {
  const send = (headers?: Record<string, string>) => api<T>(path, { method: 'POST', raw: file, contentType: file.type || 'application/octet-stream', query, headers });
  try {
    return await send();
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== 'password_required') throw e;
    for (;;) {
      const password = await askPassword({ title: 'This file is protected', description: 'Enter the password it was exported with.', confirmLabel: 'Open' });
      if (!password) throw e;
      try {
        return await send({ 'x-import-password': password });
      } catch (e2) {
        if (!(e2 instanceof ApiError) || e2.code !== 'wrong_password') throw e2;
      }
    }
  }
}

/** Exports can be password-protected (always offered while the vault is on). */
async function exportHeaders(): Promise<Record<string, string> | null> {
  if (!askExportPassword()) return {};
  const password = await askPassword({ title: 'Protect this export with a password?', description: "Leave it empty to export without one. Anyone with the password can open the file; without it, nobody can.", confirmLabel: 'Export', optional: true });
  if (password === null) return null;
  return password ? { 'x-export-password': password } : {};
}

/** POST and read an SSE response as an async stream of JSON events. */
export async function* streamPost<T = any>(path: string, body: unknown, signal?: AbortSignal, extraHeaders?: Record<string, string>): AsyncGenerator<T> {
  const res = await apiFetch(path, { method: 'POST', body, signal, headers: extraHeaders });
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
export { exportHeaders };
export async function download(path: string, fallbackName: string) {
  const headers = await exportHeaders();
  if (!headers) return;
  const res = await apiFetch(path, { headers });
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
