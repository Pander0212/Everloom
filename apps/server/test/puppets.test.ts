import { readFileSync } from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, expect, it } from 'vitest';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient | null = null;
afterEach(async () => { await c?.close(); c = null; });
const dir = path.resolve(import.meta.dirname, '../../web/public/puppets/placeholder');

it('imports a zip of finished puppets as they are, serves them, and refuses a puppet with a fake page', async () => {
  c = await createClient();
  const json = readFileSync(path.join(dir, 'puppet.json'));
  const page = readFileSync(path.join(dir, 'page0.png'));
  const adult = JSON.stringify({ ...JSON.parse(json.toString('utf8')), name: 'Second', rating: '18+' });
  const zip = Buffer.from(zipSync({ 'one/puppet.json': new Uint8Array(json), 'one/page0.png': new Uint8Array(page), 'two/puppet.json': strToU8(adult), 'two/page0.png': new Uint8Array(page) }));
  const r = await c.req('POST', '/api/puppets/import', zip);
  expect(r.status).toBe(200);
  expect(r.json.map((p: { name: string; rating: string }) => [p.name, p.rating]).sort()).toEqual([['Placeholder', 'all-ages'], ['Second', '18+']]);
  const list = (await c.req('GET', '/api/puppets')).json as Array<{ id: string; url: string }>;
  expect(list).toHaveLength(2);
  const served = await c.req('GET', list[0]!.url);
  expect(served.status).toBe(200);
  expect(JSON.parse(served.body).textures).toEqual(['page0.png']);
  expect((await c.req('GET', list[0]!.url.replace('puppet.json', 'page0.png'))).raw.subarray(0, 4).toString('hex')).toBe('89504e47');
  const fake = Buffer.from(zipSync({ 'puppet.json': new Uint8Array(json), 'page0.png': strToU8('<html>not a picture</html>') }));
  expect((await c.req('POST', '/api/puppets/import', fake)).status).toBe(400);
  expect((await c.req('GET', '/api/puppets')).json).toHaveLength(2);
}, 30000);
