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

// A second chat with a fully set-up game world for the game screens.
const world = await call('POST', '/api/chats', { characterId: iris.id, greeting: false, title: 'Rain Town' });
const cfg = {
  title: 'Rain Town', style: 'modern', seed: 4242,
  character: { name: 'Anala', className: 'Courier', resourceProfile: 'hybrid', level: 3, age: 24, ageStage: 'Young adult', customBars: [] },
  appearance: 'Dark curls under a yellow rain hood, guitar case on her back.',
  currency: { name: 'Dollars', symbol: '$', amount: 140 },
  groups: [{ name: 'Lantern Guild', type: 'Merchant guild', standing: 70 }, { name: 'Dockside Crew', type: 'Gang', standing: 22 }],
  trackers: [
    { id: 'hunger', label: 'Hunger', enabled: true, value: 35, max: 100, perHour: 4, direction: 'need' },
    { id: 'energy', label: 'Energy', enabled: true, value: 62, max: 100, perHour: -3, direction: 'fill' },
    { id: 'hygiene', label: 'Hygiene', enabled: true, value: 80, max: 100, perHour: -1.5, direction: 'fill' },
  ],
  items: [{ name: 'Umbrella', qty: 1, category: 'tool' }, { name: 'Sandwich', qty: 2, category: 'food' }, { name: 'Bus pass', qty: 1, category: 'key' }, { name: 'Guitar', qty: 1, category: 'tool' }],
  skills: [{ name: 'Sprint', kind: 'utility', cost: 5, costType: 'ap', power: 10 }, { name: 'Soothing song', kind: 'heal', cost: 8, costType: 'mp', power: 14 }],
  quests: [{ title: 'Find a singer for the Ravens', desc: 'Tobias needs a voice by Friday.', objectives: ['Talk to Tobias', 'Rehearse at the Old Pier'] }],
  npcs: [{ name: 'Tobias Moreno', role: 'Drummer', personality: 'Restless, loyal, talks fast.' }, { name: 'Mara Quill', role: 'Guild clerk', personality: 'Precise and patient.' }],
  location: { world: 'Aurel', region: 'Greenmarch', local: 'Northcrest', description: 'A rain-soaked market town on the river.', kind: 'town' },
  startDate: { year: 2026, month: 10, day: 3, hour: 19 },
  dayLength: { mode: 'turns', realMinutesPerDay: 20 },
  facts: ['It has rained for three days.', 'The Lantern closes at 2 AM.'],
};
await call('POST', `/api/chats/${world.id}/newgame`, { config: cfg, opening: false });
await call('POST', `/api/campaigns/${world.campaignId}/ops`, {
  chatId: world.id,
  ops: [
    { type: 'location.upsert', name: 'Market Row', parent: 'Northcrest', kind: 'district', description: 'Stalls under striped awnings.' },
    { type: 'location.upsert', name: 'The Lantern', parent: 'Northcrest', kind: 'shop', description: 'A small bar lit by paper lanterns.' },
    { type: 'location.upsert', name: 'Old Pier', parent: 'Northcrest', kind: 'dock', description: 'Creaking boards over dark water.', discovered: false },
    { type: 'location.upsert', name: 'Northcrest Station', parent: 'Northcrest', kind: 'station' },
    { type: 'location.upsert', name: 'Harbor Watch', parent: 'Northcrest', kind: 'danger', description: 'Where the Dockside Crew collects its dues.' },
    { type: 'org.rule', org: 'Lantern Guild', text: 'Members settle debts before the new moon.' },
    { type: 'org.runin', org: 'Dockside Crew', text: 'Paid a toll to cross the pier.' },
    { type: 'org.member', org: 'Lantern Guild', npc: 'Mara Quill', rank: 'Clerk' },
    { type: 'relationship.delta', name: 'Tobias Moreno', affection: 38, trust: 30 },
    { type: 'relationship.memory', name: 'Tobias Moreno', text: 'Shared an umbrella on Market Row.' },
    { type: 'relationship.delta', name: 'Mara Quill', affection: 8, trust: 45 },
    { type: 'phone.notify', npc: 'Tobias Moreno', reason: 'rehearsal moved to the pier' },
    { type: 'party.add', name: 'Tobias Moreno', role: 'Drummer' },
    { type: 'event.add', title: 'Rehearsal', inMinutes: 1440, kind: 'event' },
  ],
});
await call('POST', `/api/campaigns/${world.campaignId}/diary`, { title: 'First night in Northcrest', content: { text: 'The rain never stops here. Iris poured me tea without asking, and a drummer named Tobias told me his band needs a voice. I said maybe. I meant yes.', mood: 'hopeful', photos: [], stickers: [{ icon: 'moon', x: 88, y: 8, rot: -8 }, { icon: 'music', x: 10, y: 92, rot: 12 }] } });
console.log(JSON.stringify({ chat: chat.id, world: world.id, seraphina: ch.id, iris: iris.id }));
