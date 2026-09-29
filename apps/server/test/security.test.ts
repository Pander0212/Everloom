import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient;
afterEach(async () => c?.close());

describe('secrets and uploads', () => {
  it('stores API keys encrypted and never returns them', async () => {
    c = await createClient();
    const r = await c.req('POST', '/api/connections', { name: 'X', provider: 'openai', baseUrl: 'https://example.com/v1', model: 'm', apiKey: 'sk-super-secret-123' });
    expect(r.status).toBe(200);
    expect(r.json.hasKey).toBe(true);
    expect(r.body).not.toContain('sk-super-secret');
    const list = await c.req('GET', '/api/connections');
    expect(list.body).not.toContain('sk-super-secret');
    const row = c.built.ctx.db.prepare('SELECT api_key_enc FROM connections').get() as { api_key_enc: string };
    expect(row.api_key_enc).toMatch(/^v1:/);
    expect(row.api_key_enc).not.toContain('sk-super');
    // Keep key when omitted, clear when null.
    await c.req('PUT', `/api/connections/${r.json.id}`, { name: 'Y', provider: 'openai', baseUrl: 'https://example.com/v1' });
    expect((await c.req('GET', '/api/connections')).json[0].hasKey).toBe(true);
    await c.req('PUT', `/api/connections/${r.json.id}`, { name: 'Y', provider: 'openai', apiKey: null });
    expect((await c.req('GET', '/api/connections')).json[0].hasKey).toBe(false);
  });

  it('validates uploads by magic bytes and strips EXIF', async () => {
    c = await createClient();
    const bad = await c.req('POST', '/api/media', Buffer.from('<?php echo "hi"; ?>'));
    expect(bad.status).toBe(415);
    const fake = await c.req('POST', '/api/media', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]));
    expect(fake.status).toBe(415);
    const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#884422' } })
      .withMetadata({ exif: { IFD0: { Copyright: 'SECRET-GPS-OWNER', Make: 'SpyCam' } } })
      .jpeg()
      .toBuffer();
    expect(jpeg.toString('latin1')).toContain('SpyCam');
    const up = await c.req('POST', '/api/media?kind=upload', jpeg, { 'content-type': 'image/jpeg' });
    expect(up.status).toBe(200);
    const got = await c.req('GET', up.json.url);
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(got.raw.toString('latin1')).not.toContain('SpyCam');
    expect((await sharp(got.raw).metadata()).exif).toBeUndefined();
  });

  it('blocks path traversal', async () => {
    c = await createClient();
    for (const url of ['/media/..%2F..%2Feverloom.db', '/media/../../etc/passwd', '/api/backups/..%2F..%2Feverloom.db', '/api/backups/everloom.db']) {
      const r = await c.req('GET', url);
      expect([400, 404], url).toContain(r.status);
      expect(r.body).not.toContain('SQLite');
    }
  });

  it('rejects non-http outbound URLs', async () => {
    c = await createClient();
    const conn = await c.req('POST', '/api/connections', { name: 'F', provider: 'openai', baseUrl: 'file:///etc/passwd', model: 'x' });
    const r = await c.req('GET', `/api/connections/${conn.json.id}/models`);
    expect(r.status).toBe(400);
  });

  it('imports the SillyTavern sample card and exports it back', async () => {
    c = await createClient();
    const png = readFileSync(path.resolve(__dirname, '../../../tests/fixtures/st/Seraphina.png'));
    const imp = await c.req('POST', '/api/characters/import', png, { 'content-type': 'image/png' });
    expect(imp.status).toBe(200);
    expect(imp.json.name).toBe('Seraphina');
    expect(imp.json.avatar).toMatch(/^\/media\//);
    const exp = await c.req('GET', `/api/characters/${imp.json.id}/export?format=png`);
    expect(exp.status).toBe(200);
    expect(exp.headers['content-type']).toBe('image/png');
    const reimp = await c.req('POST', '/api/characters/import', exp.raw, { 'content-type': 'image/png' });
    expect(reimp.json.card.first_mes).toBe(imp.json.card.first_mes);
    expect(reimp.json.card.description).toBe(imp.json.card.description);
    expect(reimp.json.card.mes_example).toBe(imp.json.card.mes_example);
    const json = await c.req('GET', `/api/characters/${imp.json.id}/export?format=json`);
    expect(json.json.spec).toBe('chara_card_v2');
    expect(json.json.data.name).toBe('Seraphina');
  });
});
