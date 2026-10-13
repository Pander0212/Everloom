// Uploads a model to a local Everloom as the import button does (POST /api/avatars) and waits until
// it is ready. For local testing only:
//   EVERLOOM_URL=http://127.0.0.1:8787 EVERLOOM_USER=… EVERLOOM_PASS=… node tools/blender-diagnose/upload.mjs file.blend
import { readFileSync } from 'node:fs';
import path from 'node:path';

const base = process.env.EVERLOOM_URL ?? 'http://127.0.0.1:8787';
let cookie = '';
const call = async (method, url, body, headers = {}) => {
  const r = await fetch(base + url, { method, headers: { cookie, ...headers }, body });
  const set = r.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
};
let status = await call('GET', '/api/auth/status');
await call('POST', '/api/auth/login', JSON.stringify({ username: process.env.EVERLOOM_USER, password: process.env.EVERLOOM_PASS }), { 'content-type': 'application/json', 'x-csrf-token': status.csrf ?? '' });
status = await call('GET', '/api/auth/status');
for (const file of process.argv.slice(2)) {
  const name = path.basename(file).replace(/\.[^.]+$/, '');
  const made = await call('POST', `/api/avatars?name=${encodeURIComponent(name)}&filename=${encodeURIComponent(path.basename(file))}`, readFileSync(file), { 'content-type': 'application/octet-stream', 'x-csrf-token': status.csrf });
  if (!made.id) { console.log('FAILED', file, JSON.stringify(made).slice(0, 300)); continue; }
  const t0 = Date.now();
  let a;
  for (;;) {
    a = await call('GET', `/api/avatars/${made.id}`);
    if (a.status !== 'processing' && !a.info?.processingStage) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log(JSON.stringify({ file: path.basename(file), id: made.id, status: a.status, error: a.error, s: Math.round((Date.now() - t0) / 1000), family: a.config?.rig?.family, check: a.info?.conversion?.validation?.check?.ok, warnings: (a.info?.warnings ?? []).map((w) => `${w.level}:${w.code}`) }));
}
