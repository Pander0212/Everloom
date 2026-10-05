/**
 * The Windows app's server side: "No password on this PC" (loopback only, not through a rebinding
 * host name, off as soon as the server listens on the network), the token-guarded control routes,
 * and a clean shutdown request.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onShutdownRequest } from '../src/shutdown.js';
import { createClient, type TestClient } from './helpers.js';

const TOKEN = 'desktop-test-token-0123456789abcdef';
let c: TestClient;
const saved = { ...process.env };
beforeEach(() => {
  process.env.EVERLOOM_DESKTOP = '1';
  process.env.EVERLOOM_DESKTOP_TOKEN = TOKEN;
  process.env.HOST = '127.0.0.1';
});
afterEach(async () => {
  await c?.close();
  process.env = { ...saved };
});

const raw = (method: string, url: string, headers: Record<string, string> = {}, body?: unknown) =>
  c.built.app.inject({ method: method as 'GET', url, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, payload: body === undefined ? undefined : JSON.stringify(body) });

describe('desktop', () => {
  it('no password on this PC: this computer is signed in; other host names and the network are not', async () => {
    c = await createClient({ setup: false });
    const s = await c.req('POST', '/api/auth/setup', { username: 'owner', noPassword: true });
    expect(s.status).toBe(200);
    // A fresh browser on this PC (no cookie) is signed in.
    const st = JSON.parse((await raw('GET', '/api/auth/status', { host: '127.0.0.1:8787' })).body);
    expect(st).toMatchObject({ authenticated: true, username: 'owner', desktop: { noPassword: true, local: true } });
    // A page on another domain that resolves to 127.0.0.1 is not.
    expect(JSON.parse((await raw('GET', '/api/auth/status', { host: 'evil.example:8787' })).body).authenticated).toBe(false);
    // Turning it off needs a new password, and then signing in needs it.
    const off = await c.req('POST', '/api/auth/no-password', { on: false, next: 'a fresh long password' });
    expect(off.json).toEqual({ noPassword: false });
    expect(JSON.parse((await raw('GET', '/api/auth/status', { host: '127.0.0.1:8787' })).body).authenticated).toBe(false);
    expect((await c.req('POST', '/api/auth/login', { username: 'owner', password: 'a fresh long password' })).status).toBe(200);
  });

  it('listening on the network switches it off', async () => {
    process.env.HOST = '0.0.0.0';
    c = await createClient({ setup: false });
    expect((await c.req('POST', '/api/auth/setup', { username: 'owner', noPassword: true })).status).toBe(400);
  });

  it('control routes need the token; lock, backup, state and a clean shutdown', async () => {
    c = await createClient();
    expect((await raw('POST', '/api/desktop/lock', {}, {})).statusCode).toBe(403);
    expect((await raw('POST', '/api/desktop/lock', { 'x-desktop-token': 'wrong-token-0123456789abcdefghij' }, {})).statusCode).toBe(403);
    const t = { 'x-desktop-token': TOKEN };
    expect(JSON.parse((await raw('GET', '/api/desktop/state', t)).body)).toMatchObject({ noPassword: false, host: '127.0.0.1' });
    expect(JSON.parse((await raw('POST', '/api/desktop/lock', t, {})).body)).toMatchObject({ enabled: false });
    const b = await raw('POST', '/api/desktop/backup', t, {});
    expect(b.statusCode).toBe(200);
    expect(JSON.parse(b.body).backup.name).toMatch(/preupdate/);
    expect(JSON.parse((await raw('GET', '/api/desktop/lan', t)).body)).toMatchObject({ listening: false });
    let asked = '';
    onShutdownRequest((why) => (asked = why));
    expect((await raw('POST', '/api/desktop/shutdown', t, {})).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 120));
    expect(asked).toBe('desktop app');
  });

  it('without the desktop app, none of it exists', async () => {
    delete process.env.EVERLOOM_DESKTOP;
    c = await createClient({ setup: false });
    expect((await c.req('POST', '/api/auth/setup', { username: 'owner', noPassword: true })).status).toBe(400);
    expect((await raw('GET', '/api/desktop/state', { 'x-desktop-token': TOKEN })).statusCode).toBe(404);
  });
});
