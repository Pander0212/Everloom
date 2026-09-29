import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp, type BuiltApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.resolve(here, '../../../tests/fixtures');

export interface TestClient {
  built: BuiltApp;
  cookie: string;
  csrf: string;
  dataDir: string;
  req: (method: string, url: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; json: any; body: string; headers: Record<string, any>; raw: Buffer }>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<BuiltApp & { dataDir: string; cleanup: () => Promise<void> }> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'everloom-test-'));
  const cfg = loadConfig({ dataDir, webDir: path.join(dataDir, 'no-web'), logLevel: 'error' });
  const built = await buildApp(cfg, { logger: false });
  return {
    ...built,
    dataDir,
    cleanup: async () => {
      await built.app.close();
      built.ctx.db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function createClient(opts: { setup?: boolean; username?: string; password?: string } = {}): Promise<TestClient> {
  const t = await createTestApp();
  const client: TestClient = {
    built: t,
    cookie: '',
    csrf: '',
    dataDir: t.dataDir,
    async req(method, url, body, headers = {}) {
      const isBuf = Buffer.isBuffer(body);
      const res = await t.app.inject({
        method: method as any,
        url,
        payload: body === undefined ? undefined : isBuf ? (body as Buffer) : JSON.stringify(body),
        headers: {
          ...(body !== undefined ? { 'content-type': isBuf ? 'application/octet-stream' : 'application/json' } : {}),
          ...(client.cookie ? { cookie: client.cookie } : {}),
          ...(client.csrf ? { 'x-csrf-token': client.csrf } : {}),
          ...headers,
        },
      });
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        const c = (Array.isArray(setCookie) ? setCookie : [setCookie]).find((x) => x.startsWith('everloom_session='));
        if (c) client.cookie = c.split(';')[0];
      }
      let json: any = null;
      try {
        json = JSON.parse(res.body);
      } catch {
        json = null;
      }
      if (json?.csrf) client.csrf = json.csrf;
      return { status: res.statusCode, json, body: res.body, headers: res.headers as any, raw: res.rawPayload };
    },
    close: t.cleanup,
  };
  if (opts.setup !== false) {
    const r = await client.req('POST', '/api/auth/setup', { username: opts.username ?? 'owner', password: opts.password ?? 'correct horse battery' });
    if (r.status !== 200) throw new Error(`setup failed: ${r.body}`);
  }
  return client;
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 8000, stepMs = 50): Promise<T> {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`waitFor timed out${last ? `: ${(last as Error).message}` : ''}`);
}

export function parseSse(body: string): any[] {
  return body
    .split('\n\n')
    .map((b) => b.split('\n').find((l) => l.startsWith('data: ')))
    .filter(Boolean)
    .map((l) => JSON.parse(l!.slice(6)));
}
