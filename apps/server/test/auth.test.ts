import { afterEach, describe, expect, it } from 'vitest';
import { totpCode } from '../src/security/crypto.js';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient;
afterEach(async () => c?.close());

describe('auth', () => {
  it('health is public; everything else requires auth', async () => {
    c = await createClient({ setup: false });
    expect((await c.req('GET', '/api/health')).status).toBe(200);
    const st = await c.req('GET', '/api/auth/status');
    expect(st.json.setupRequired).toBe(true);
    for (const url of ['/api/characters', '/api/chats', '/api/connections', '/api/settings', '/api/events', '/api/backups', '/media/m_abcdefgh', '/api/personas', '/api/lorebooks']) {
      expect((await c.req('GET', url)).status, url).toBe(401);
    }
    expect((await c.req('POST', '/api/characters', { card: { name: 'x' } })).status).toBe(401);
  });

  it('first-run setup creates the owner once', async () => {
    c = await createClient({ setup: false });
    expect((await c.req('POST', '/api/auth/setup', { username: 'me', password: 'short' })).status).toBe(400);
    const r = await c.req('POST', '/api/auth/setup', { username: 'me', password: 'a long enough password' });
    expect(r.status).toBe(200);
    expect(r.headers['set-cookie']).toMatch(/HttpOnly/i);
    expect(r.headers['set-cookie']).toMatch(/SameSite=Strict/i);
    expect((await c.req('GET', '/api/characters')).status).toBe(200);
    expect((await c.req('POST', '/api/auth/setup', { username: 'evil', password: 'another long password' })).status).toBe(409);
  });

  it('requires a CSRF token for mutations', async () => {
    c = await createClient();
    const saved = c.csrf;
    c.csrf = '';
    expect((await c.req('POST', '/api/personas', { name: 'P' })).status).toBe(403);
    c.csrf = 'wrong';
    expect((await c.req('POST', '/api/personas', { name: 'P' })).status).toBe(403);
    c.csrf = saved;
    expect((await c.req('POST', '/api/personas', { name: 'P' })).status).toBe(200);
  });

  it('login, logout and lockout after repeated failures', async () => {
    c = await createClient({ username: 'owner', password: 'correct horse battery' });
    await c.req('POST', '/api/auth/logout', {});
    c.cookie = '';
    c.csrf = '';
    expect((await c.req('GET', '/api/chats')).status).toBe(401);
    expect((await c.req('POST', '/api/auth/login', { username: 'owner', password: 'correct horse battery' })).status).toBe(200);
    expect((await c.req('GET', '/api/chats')).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await c.req('POST', '/api/auth/login', { username: 'owner', password: 'wrong' })).status).toBe(401);
    const locked = await c.req('POST', '/api/auth/login', { username: 'owner', password: 'correct horse battery' });
    expect(locked.status).toBe(429);
    expect(locked.headers['retry-after']).toBeTruthy();
  });

  it('supports TOTP two-factor login', async () => {
    c = await createClient();
    const setup = await c.req('POST', '/api/auth/totp/setup', {});
    expect(setup.json.svg).toContain('<svg');
    expect((await c.req('POST', '/api/auth/totp/enable', { code: '000000' })).status).toBe(400);
    expect((await c.req('POST', '/api/auth/totp/enable', { code: totpCode(setup.json.secret) })).status).toBe(200);
    await c.req('POST', '/api/auth/logout', {});
    c.cookie = '';
    c.csrf = '';
    const need = await c.req('POST', '/api/auth/login', { username: 'owner', password: 'correct horse battery' });
    expect(need.status).toBe(401);
    expect(need.json.code).toBe('totp_required');
    expect((await c.req('POST', '/api/auth/login', { username: 'owner', password: 'correct horse battery', code: totpCode(setup.json.secret) })).status).toBe(200);
  });

  it('sends security headers', async () => {
    c = await createClient();
    const r = await c.req('GET', '/api/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-frame-options']).toBe('DENY');
  });
});
