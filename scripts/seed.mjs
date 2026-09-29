// Seeds a running Everloom with an account, mock connection, persona, character and a chat. For QA.
const base = process.argv[2] ?? 'http://localhost:8787';
const mock = process.argv[3] ?? 'http://127.0.0.1:5055/v1';
let cookie = '';
let csrf = '';
async function call(method, path, body, raw) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(body !== undefined ? { 'content-type': raw ? 'application/octet-stream' : 'application/json' } : {}) },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (json?.csrf) csrf = json.csrf;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return json ?? text;
}
const { readFileSync } = await import('node:fs');
const status = await call('GET', '/api/auth/status');
if (status.setupRequired) await call('POST', '/api/auth/setup', { username: 'owner', password: 'correct horse battery' });
else await call('POST', '/api/auth/login', { username: 'owner', password: 'correct horse battery' });
const conn = await call('POST', '/api/connections', { name: 'Mock model', provider: 'openai', baseUrl: mock, model: 'mock-story', params: { max_tokens: 400, context_size: 8192, temperature: 0.9 } });
await call('PATCH', '/api/settings', { roles: { main: conn.id } });
await call('POST', '/api/personas', { name: 'Anala', title: 'Wandering singer', age: 24, ageStage: 'Young adult', description: 'A traveling singer with a battered guitar case and a habit of humming when nervous.', isDefault: true });
const ch = await call('POST', '/api/characters/import', readFileSync(new URL('../tests/fixtures/st/Seraphina.png', import.meta.url)), true);
const iris = await call('POST', '/api/characters', { card: { name: 'Iris Thorne', description: 'Bartender at the Lantern, quiet, observant, keeps a ledger of favors.', personality: 'Guarded, dry humor, kind underneath.', first_mes: 'Iris wipes the counter without looking up. "Rain again. What can I get you?"', tags: ['modern', 'slice of life'] } });
const chat = await call('POST', '/api/chats', { characterId: iris.id });
const sse = await fetch(`${base}/api/chats/${chat.id}/generate`, { method: 'POST', headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'normal', text: 'Hi! Something cold, please. It has been a long walk.' }) });
await sse.text();
await new Promise((r) => setTimeout(r, 800));
const sse2 = await fetch(`${base}/api/chats/${chat.id}/generate`, { method: 'POST', headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'normal', text: '*I take a sip and look at the door.* Who is Tobias?' }) });
await sse2.text();
await call('POST', '/api/lorebooks', { name: 'Northcrest', book: { entries: { 0: { uid: 0, key: ['Lantern'], content: 'The Lantern is a small bar on Market Row, lit by paper lanterns.', comment: 'The Lantern' }, 1: { uid: 1, key: ['Ravens'], content: 'The Ravens are a local band looking for a singer.', comment: 'The Ravens' } } } });
console.log(JSON.stringify({ chat: chat.id, seraphina: ch.id, iris: iris.id }));
