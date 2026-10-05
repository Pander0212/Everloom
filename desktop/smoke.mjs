// Smoke test for the Windows build (run on windows-latest after electron-builder):
// silent install → start → /api/health → set up, connect the mock model, chat → quit → start again
// and the chat is still there → silent uninstall → the data is still there. Then the portable zip:
// it keeps its data next to the exe.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const release = path.join(here, 'release');
const installer = readdirSync(release).find((f) => /^Everloom-Setup-.*\.exe$/.test(f));
if (!installer) throw new Error('No installer in desktop/release');
const appData = process.env.APPDATA;
const dataDir = path.join(appData, 'Everloom');
const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'Everloom');
const exe = path.join(installDir, 'Everloom.exe');
const MOCK_PORT = 8799;

const step = (s) => console.log(`\n== ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms = 120_000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

/** A tiny client that keeps the session cookie and CSRF token. */
function client(port) {
  let cookie = '';
  let csrf = '';
  return async (method, url, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* SSE or text */
    }
    if (json && json.csrf) csrf = json.csrf;
    return { status: r.status, json, text };
  };
}

function startApp(file, dir) {
  rmSync(path.join(dir, 'desktop-state.json'), { force: true });
  const child = spawn(file, ['--headless'], { detached: false, stdio: 'ignore' });
  return child;
}
async function portOf(dir) {
  const st = await until('the app to start its server', () => existsSync(path.join(dir, 'desktop-state.json')) && JSON.parse(readFileSync(path.join(dir, 'desktop-state.json'), 'utf8')));
  await until('/api/health', async () => (await fetch(`http://127.0.0.1:${st.port}/api/health`)).ok);
  return st.port;
}
async function quitApp(file, child) {
  const exited = new Promise((r) => child.once('exit', r));
  spawn(file, ['--quit'], { stdio: 'ignore' });
  const ok = await Promise.race([exited.then(() => true), sleep(45_000).then(() => false)]);
  if (!ok) throw new Error('The app did not quit within 45 s');
}

// ------------------------------------------------------------------ the mock model
step('mock model');
const mock = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'tests/mock-llm/server.ts'), String(MOCK_PORT)], { cwd: root, stdio: 'inherit' });
await until('the mock model', async () => (await fetch(`http://127.0.0.1:${MOCK_PORT}/__control`)).ok, 60_000);

try {
  // ---------------------------------------------------------------- install
  step(`silent install of ${installer}`);
  rmSync(dataDir, { recursive: true, force: true });
  execFileSync(path.join(release, installer), ['/S'], { stdio: 'inherit' });
  await until('Everloom.exe', () => existsSync(exe), 60_000);

  step('start and set up');
  let app = startApp(exe, dataDir);
  let port = await portOf(dataDir);
  let api = client(port);
  const status = (await api('GET', '/api/auth/status')).json;
  if (!status.setupRequired) throw new Error('Expected first-run setup');
  const setup = await api('POST', '/api/auth/setup', { username: 'owner', password: 'correct horse battery' });
  if (setup.status !== 200) throw new Error(`setup: ${setup.text}`);
  const conn = await api('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`, model: 'mock-story', params: { max_tokens: 200, context_size: 8192 } });
  await api('PATCH', '/api/settings', { roles: { main: conn.json.id } });
  await fetch(`http://127.0.0.1:${MOCK_PORT}/__control`, { method: 'POST', body: JSON.stringify({ story: 'The kettle sings on the stove.' }) });
  const ch = (await api('POST', '/api/characters', { card: { name: 'Smoke Sam', first_mes: 'Hello from Windows.' } })).json;
  const chat = (await api('POST', '/api/chats', { characterId: ch.id, features: 'classic' })).json;
  const gen = await api('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'Is the tea ready?' });
  if (!gen.text.includes('"type":"done"')) throw new Error(`generate: ${gen.text.slice(0, 500)}`);
  const msgs = (await api('GET', `/api/chats/${chat.id}/messages`)).json;
  if (!msgs.some((m) => m.swipes[m.swipeId].text.includes('kettle sings'))) throw new Error('The reply was not stored');

  step('quit cleanly, start again: the chat is still there');
  await quitApp(exe, app);
  if (!existsSync(path.join(dataDir, 'everloom.db'))) throw new Error('No database in %APPDATA%\\Everloom');
  app = startApp(exe, dataDir);
  port = await portOf(dataDir);
  api = client(port);
  const login = await api('POST', '/api/auth/login', { username: 'owner', password: 'correct horse battery' });
  if (login.status !== 200) throw new Error(`login: ${login.text}`);
  const again = (await api('GET', `/api/chats/${chat.id}/messages`)).json;
  if (!Array.isArray(again) || again.length !== msgs.length) throw new Error('The chat did not survive a restart');
  await quitApp(exe, app);

  step('silent uninstall keeps the data');
  execFileSync(path.join(installDir, 'Uninstall Everloom.exe'), ['/S'], { stdio: 'inherit' });
  await until('the program files to go', () => !existsSync(exe), 60_000);
  if (!existsSync(path.join(dataDir, 'everloom.db'))) throw new Error('Uninstall removed the data');

  // ---------------------------------------------------------------- portable
  const zip = readdirSync(release).find((f) => /^Everloom-Portable-.*\.zip$/.test(f));
  if (zip) {
    step(`portable: ${zip}`);
    const dir = path.join(process.env.RUNNER_TEMP || process.env.TEMP, 'everloom-portable');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${path.join(release, zip)}' -DestinationPath '${dir}'`], { stdio: 'inherit' });
    const pexe = path.join(dir, 'Everloom.exe');
    const pdata = path.join(dir, 'data');
    const papp = startApp(pexe, pdata);
    await portOf(pdata);
    await quitApp(pexe, papp);
    if (!existsSync(path.join(pdata, 'everloom.db'))) throw new Error('The portable app did not keep its data next to the exe');
  }
  step('all good');
} finally {
  mock.kill();
}
