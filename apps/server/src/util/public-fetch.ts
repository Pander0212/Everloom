/**
 * Fetching URLs that come from content (image links inside cards, online character sources).
 * Unlike the user's own connections, these must never reach loopback, private or link-local
 * addresses: the resolved address is checked at connect time (so DNS tricks don't get around it),
 * and every redirect hop is checked again.
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { HttpError } from '../context.js';

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff');
}

export interface PublicResponse {
  status: number;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface PublicFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Tests and LAN setups (EVERLOOM_FETCH_PRIVATE=1). */
  allowPrivate?: boolean;
  maxRedirects?: number;
}

function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: any, cb: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return cb(err, '', 0);
      const list = addresses as unknown as LookupAddress[];
      const bad = !allowPrivate && list.some((a) => isPrivateAddress(a.address));
      if (bad) return cb(Object.assign(new Error(`${hostname} is a private network address`), { code: 'EPRIVATE' }), '', 0);
      if (options?.all) return cb(null, list);
      cb(null, list[0]!.address, list[0]!.family);
    });
  };
}

export async function fetchPublic(raw: string, opts: PublicFetchOptions = {}): Promise<PublicResponse> {
  const maxBytes = opts.maxBytes ?? 15 * 1024 * 1024;
  let current = raw;
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      throw new HttpError(400, 'Invalid URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http(s) links can be fetched');
    if (url.username || url.password) throw new HttpError(400, 'Links with credentials are not fetched');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !opts.allowPrivate && isPrivateAddress(host)) throw new HttpError(400, `${host} is a private network address`);
    const res = await new Promise<PublicResponse>((resolve, reject) => {
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.get(url, { headers: { 'user-agent': 'Everloom (self-hosted; +https://github.com/Pander0212/Everloom)', accept: '*/*', ...opts.headers }, lookup: guardedLookup(!!opts.allowPrivate) as any, timeout: opts.timeoutMs ?? 20_000 }, (r) => {
        const len = Number(r.headers['content-length'] ?? 0);
        if (r.statusCode && r.statusCode >= 300 && r.statusCode < 400) {
          r.resume();
          return resolve({ status: r.statusCode, url: url.href, headers: r.headers, body: Buffer.alloc(0) });
        }
        if (len > maxBytes) {
          r.destroy();
          return reject(new HttpError(413, 'The file is too large'));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        r.on('data', (c: Buffer) => {
          total += c.length;
          if (total > maxBytes) {
            r.destroy();
            reject(new HttpError(413, 'The file is too large'));
          } else chunks.push(c);
        });
        r.on('end', () => resolve({ status: r.statusCode ?? 0, url: url.href, headers: r.headers, body: Buffer.concat(chunks) }));
        r.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('timed out')));
      req.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'EPRIVATE' ? new HttpError(400, e.message) : new HttpError(502, `Could not reach ${url.host}: ${e.message}`, 'upstream')));
    });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, url).href;
      continue;
    }
    return res;
  }
  throw new HttpError(502, 'Too many redirects');
}
