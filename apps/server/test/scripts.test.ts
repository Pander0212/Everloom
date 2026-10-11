/**
 * Scripting on the server: imported scripts stay off until reviewed; approvals follow the code;
 * trusted creators; the server-side permission check for model calls, the network and storage;
 * regex rules in the stored text and the prompt; variables at every scope; the sandbox document.
 */
import { zipSync } from 'fflate';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockLlm } from '../../../tests/mock-llm/server.js';
import { createClient, parseSse, type TestClient } from './helpers.js';

let mock: Awaited<ReturnType<typeof startMockLlm>>;
let c: TestClient;
const control = (body: object) => fetch(mock.url.replace('/v1', '/__control'), { method: 'POST', body: JSON.stringify(body) });

beforeAll(async () => {
  mock = await startMockLlm();
});
afterAll(async () => mock.close());
beforeEach(async () => {
  await control({ reset: true });
  c = await createClient();
  const conn = await c.req('POST', '/api/connections', { name: 'Mock', provider: 'openai', baseUrl: mock.url, model: 'mock-story', params: { max_tokens: 300, context_size: 8192 } });
  await c.req('PATCH', '/api/settings', { roles: { main: conn.json.id } });
});
afterEach(async () => c?.close());

const SCRIPT = { id: 'counter', name: 'Counter', code: 'everloom.on("message", () => everloom.vars.set("n", 1));', permissions: ['variables', 'generate', 'storage', 'network'], domains: ['api.example.com'], triggers: ['chatOpen'] };
function card(extra: Record<string, unknown> = {}, creator = 'Mira') {
  return Buffer.from(
    JSON.stringify({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Scripted',
        description: 'A test character.',
        first_mes: 'Hello there.',
        creator,
        extensions: {
          everloom_scripts: { scripts: [SCRIPT], messagePermissions: ['variables'] },
          regex_scripts: [{ scriptName: 'shout', findRegex: '/\\bhello\\b/gi', replaceString: 'HELLO', placement: [1, 2] }],
          ...extra,
        },
      },
    }),
  );
}
const key = (id: string) => `character:${id}:counter`;

describe('review and approval', () => {
  it('imported scripts are off until reviewed; approvals follow the code', async () => {
    const ch = (await c.req('POST', '/api/characters/import', card())).json;
    expect(ch.scripts).toEqual({ hasScripts: true, approved: false });
    const r = (await c.req('GET', `/api/scripts/review?kind=character&id=${ch.id}`)).json;
    expect(r.items.map((i: any) => [i.type, i.granted])).toEqual([
      ['script', false],
      ['regex', false],
      ['messages', false],
    ]);
    const chat = (await c.req('POST', '/api/chats', { characterId: ch.id })).json;
    const act = (await c.req('GET', `/api/scripts/active?chatId=${chat.id}`)).json;
    expect(act.pending).toEqual([{ target: { kind: 'character', id: ch.id }, name: 'Scripted' }]);
    expect(act.scripts.find((s: any) => s.key === key(ch.id)).granted).toBe(false);
    expect(act.regex).toEqual([]);
    // Calls through the server are refused while unapproved.
    expect((await c.req('PUT', '/api/scripts/run/storage', { key: key(ch.id), k: 'a', value: 1 })).json.code).toBe('script_unapproved');
    // Approve everything.
    const after = (await c.req('POST', '/api/scripts/review', { kind: 'character', id: ch.id, approve: r.items.map((i: any) => i.key) })).json;
    expect(after.items.every((i: any) => i.granted)).toBe(true);
    expect((await c.req('PUT', '/api/scripts/run/storage', { key: key(ch.id), k: 'a', value: { x: 1 } })).status).toBe(200);
    expect((await c.req('GET', `/api/scripts/run/storage?key=${encodeURIComponent(key(ch.id))}&k=a`)).json.value).toEqual({ x: 1 });
    // Changing the code (here through the card itself) withdraws the approval for that script only.
    const full = (await c.req('GET', `/api/characters/${ch.id}`)).json;
    const ext = full.card.extensions;
    ext.everloom_scripts.scripts[0].code += '\n// changed';
    await c.req('PATCH', `/api/characters/${ch.id}`, { card: { extensions: ext } });
    const r2 = (await c.req('GET', `/api/scripts/review?kind=character&id=${ch.id}`)).json;
    expect(r2.items.find((i: any) => i.type === 'script')).toMatchObject({ granted: false, changed: true });
    expect(r2.items.find((i: any) => i.type === 'regex').granted).toBe(true);
    expect((await c.req('GET', `/api/scripts/run/storage?key=${encodeURIComponent(key(ch.id))}&k=a`)).json.code).toBe('script_unapproved');
  });

  it('scripts from a trusted creator come in approved; permissions are enforced per call', async () => {
    await c.req('POST', '/api/scripts/trust', { kind: 'creator', value: 'Mira', on: true });
    const ch = (await c.req('POST', '/api/characters/import', card())).json;
    expect(ch.scripts).toEqual({ hasScripts: true, approved: true });
    const other = (await c.req('POST', '/api/characters/import', card({}, 'Someone else'))).json;
    expect(other.scripts.approved).toBe(false);
    // The message-frame key has only "variables": storage is refused.
    expect((await c.req('PUT', '/api/scripts/run/storage', { key: `character:${ch.id}:@messages`, k: 'a', value: 1 })).json.code).toBe('script_permission');
    // Network: https only, listed domains only (checked before anything is fetched).
    expect((await c.req('POST', '/api/scripts/run/fetch', { key: key(ch.id), url: 'https://evil.example.org/x' })).json.code).toBe('script_domain');
    expect((await c.req('POST', '/api/scripts/run/fetch', { key: key(ch.id), url: 'http://api.example.com/x' })).status).toBe(400);
    // Model calls: logged under the script's name and rate-limited.
    await c.req('PATCH', '/api/settings', { scripts: { generatePerMinute: 2 } });
    const g = await c.req('POST', '/api/scripts/run/generate', { key: key(ch.id), messages: [{ role: 'user', content: 'Say hi' }] });
    expect(g.status).toBe(200);
    expect(typeof g.json.text).toBe('string');
    await c.req('POST', '/api/scripts/run/generate', { key: key(ch.id), messages: [{ role: 'user', content: 'Again' }] });
    expect((await c.req('POST', '/api/scripts/run/generate', { key: key(ch.id), messages: [{ role: 'user', content: 'Third' }] })).json.code).toBe('script_rate');
    const calls = (await c.req('GET', '/api/calls')).json;
    expect(JSON.stringify(calls)).toContain('script: Counter');
    // The kill switch stops everything.
    await c.req('PATCH', '/api/settings', { scripts: { enabled: false } });
    expect((await c.req('GET', `/api/scripts/run/storage?key=${encodeURIComponent(key(ch.id))}`)).json.code).toBe('scripts_off');
  });

  it('Tavern Helper card scripts are read as compatibility scripts with inferred permissions', async () => {
    const th = [{ type: 'script', id: 'th1', name: 'Status bar', enabled: true, content: 'eventOn(tavern_events.MESSAGE_RECEIVED, () => { const v = getVariables({type:"chat"}); toastr.info("hp " + v.hp); });', button: { enabled: true, buttons: [{ name: 'Refresh', visible: true }] } }];
    const ch = (await c.req('POST', '/api/characters/import', card({ everloom_scripts: undefined, regex_scripts: [], TavernHelper_scripts: th }))).json;
    const r = (await c.req('GET', `/api/scripts/review?kind=character&id=${ch.id}`)).json;
    expect(r.items[0]).toMatchObject({ type: 'script', name: 'Status bar', compat: true, permissions: expect.arrayContaining(['variables', 'ui.panel']), triggers: ['chatOpen', 'button'] });
  });
});

describe('regex rules and variables in the pipeline', () => {
  it('global rules change stored text; display-only and prompt-only rules stay out of storage', async () => {
    const ch = (await c.req('POST', '/api/characters', { card: { name: 'Bard', first_mes: 'Hm.' } })).json;
    const chat = (await c.req('POST', '/api/chats', { characterId: ch.id, features: 'classic' })).json;
    await c.req('POST', '/api/scripts/library', { kind: 'regex', data: { scriptName: 'tea', findRegex: '/coffee/g', replaceString: 'tea', placement: [1] } });
    await c.req('POST', '/api/scripts/library', { kind: 'regex', data: { scriptName: 'shown', findRegex: '/tea/g', replaceString: 'TEA', placement: [1], markdownOnly: true } });
    await c.req('POST', '/api/scripts/library', { kind: 'regex', data: { scriptName: 'sent', findRegex: '/please/g', replaceString: 'PLEASE', placement: [1], promptOnly: true } });
    // An imported rule waits for approval.
    await c.req('POST', '/api/scripts/library', { kind: 'regex', data: { scriptName: 'imported', findRegex: '/cup/g', replaceString: 'mug', placement: [1] }, imported: true });
    const gen = await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'normal', text: 'A cup of coffee, please.' });
    expect(parseSse(gen.body).find((e) => e.type === 'user').message.swipes[0].text).toBe('A cup of tea, please.');
    const sent = JSON.stringify(mock ? (await (await fetch(mock.url.replace('/v1', '/__control'))).json()).calls.at(-1).body.messages : []);
    expect(sent).toContain('A cup of tea, PLEASE.');
    const lib = (await c.req('GET', '/api/scripts/library?kind=regex')).json;
    expect(lib.map((x: any) => [x.data.scriptName, x.approved])).toEqual([
      ['tea', true],
      ['shown', true],
      ['sent', true],
      ['imported', false],
    ]);
  });

  it('variables: global and character scopes, message variables on the swipe, all readable by macros', async () => {
    const ch = (await c.req('POST', '/api/characters', { card: { name: 'Bard', first_mes: 'Hm.', description: 'g={{getglobalvar::coins}} c={{getcharvar::mood}} m={{getmesvar::hp}}' } })).json;
    const chat = (await c.req('POST', '/api/chats', { characterId: ch.id, features: 'classic' })).json;
    await c.req('PATCH', '/api/scripts/vars', { scope: 'global', set: { coins: 5 } });
    await c.req('PATCH', '/api/scripts/vars', { scope: 'character', scopeId: ch.id, set: { mood: 'merry' } });
    const first = (await c.req('GET', `/api/chats/${chat.id}/messages`)).json[0];
    await c.req('PATCH', `/api/messages/${first.id}/vars`, { set: { hp: 9 } });
    const prompt = async () => JSON.stringify((await c.req('POST', `/api/chats/${chat.id}/prompt/preview`, {})).json.parts);
    expect(await prompt()).toContain('g=5 c=merry m=9');
    // A second swipe without the variable: the value follows the swipe.
    await c.req('POST', `/api/chats/${chat.id}/generate`, { type: 'swipe' });
    expect(await prompt()).toContain('g=5 c=merry m=');
    expect(await prompt()).not.toContain('m=9');
    await c.req('POST', `/api/messages/${first.id}/swipe`, { swipeId: 0 });
    expect(await prompt()).toContain('m=9');
  });
});

describe('sandbox and extensions', () => {
  it('serves the sandbox document without a session, under its own policy', async () => {
    const anon = await c.built.app.inject({ method: 'GET', url: '/api/sandbox/frame' });
    expect(anon.statusCode).toBe(200);
    expect(anon.headers['content-security-policy']).toContain("connect-src 'none'");
    expect(anon.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(anon.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(anon.body).toContain('everloom');
    // Everything else stays unframeable.
    expect((await c.req('GET', '/api/health')).headers['x-frame-options']).toBe('DENY');
  });

  function extZip(version = '1.0.0', perms = ['ui.panel', 'state.ops']) {
    const manifest = {
      id: 'town-rep',
      name: 'Town reputation',
      version,
      author: 'Test',
      permissions: perms,
      entries: {
        background: 'bg.js',
        panels: [{ id: 'main', title: 'Reputation', file: 'panel.html' }],
        slashCommands: [{ name: 'rep', help: 'Change reputation' }],
        promptBlocks: [{ id: 'note', text: 'Towns remember the player.', position: 'depth', depth: 1 }],
        ops: [{ name: 'change', label: 'Reputation', params: { town: { type: 'string' }, amount: { type: 'integer', min: -10, max: 10 } }, steps: [{ do: 'add', path: '/towns/{town}', value: '{amount}' }], summary: '{town} {amount:+}' }],
      },
    };
    return Buffer.from(
      zipSync({
        'town-rep-main/everloom-extension.json': new TextEncoder().encode(JSON.stringify(manifest)),
        'town-rep-main/bg.js': new TextEncoder().encode('everloom.slash.register("rep", () => "ok");'),
        'town-rep-main/panel.html': new TextEncoder().encode('<link rel="stylesheet" href="style.css"><div class="ev-card">Rep</div><script src="lib.js"></script>'),
        'town-rep-main/style.css': new TextEncoder().encode('.x{color:red}'),
        'town-rep-main/lib.js': new TextEncoder().encode('window.lib = 1;'),
      }),
    );
  }

  it('install from a zip: preview, install, files inlined, custom ops roll back, prompt blocks, update and uninstall', async () => {
    const prev = (await c.req('POST', '/api/extensions/preview', extZip())).json;
    expect(prev.manifest.id).toBe('town-rep');
    expect(prev.update).toBeNull();
    const inst = (await c.req('POST', '/api/extensions/install', { token: prev.token })).json;
    expect(inst).toMatchObject({ id: 'town-rep', enabled: true, approved: true });
    const ui = (await c.req('GET', '/api/extensions/ui')).json;
    expect(ui[0]).toMatchObject({ id: 'town-rep', background: 'bg.js', slashCommands: [{ name: 'rep' }] });
    const doc = (await c.req('GET', '/api/extensions/town-rep/entry?file=panel.html')).json;
    expect(doc.text).toContain('<style>.x{color:red}</style>');
    expect(doc.text).toContain('window.lib = 1;');
    expect((await c.req('GET', '/api/extensions/town-rep/entry?file=lib.js')).status).toBe(404);
    // The custom op works in a game and rolls back with its message.
    const ch = (await c.req('POST', '/api/characters', { card: { name: 'Bard', first_mes: 'Hm.' } })).json;
    const chat = (await c.req('POST', '/api/chats', { characterId: ch.id, features: 'full' })).json;
    const r = (await c.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'ext.op', ext: 'town-rep', name: 'change', args: { town: 'Eastport', amount: 4 } }] })).json;
    expect(r.errors).toEqual([]);
    expect(r.state.ext['town-rep'].towns.Eastport).toBe(4);
    // The prompt block is in the prompt.
    expect(JSON.stringify((await c.req('POST', `/api/chats/${chat.id}/prompt/preview`, {})).json.parts)).toContain('Towns remember the player.');
    // An update that asks for more shows the difference and needs another look.
    const up = (await c.req('POST', '/api/extensions/preview', extZip('1.1.0', ['ui.panel', 'state.ops', 'generate']))).json;
    expect(up.update).toMatchObject({ from: '1.0.0', to: '1.1.0', addedPermissions: ['generate'] });
    // Uninstall, deleting its data.
    await c.req('PUT', '/api/scripts/run/storage', { key: 'extension:town-rep:main', k: 'x', value: 1 }).catch(() => null);
    expect((await c.req('DELETE', '/api/extensions/town-rep')).status).toBe(200);
    expect((await c.req('GET', '/api/extensions')).json.items).toEqual([]);
    // New changes with it are refused, but the story still replays: its earlier change is intact.
    expect((await c.req('POST', `/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops: [{ type: 'ext.op', ext: 'town-rep', name: 'change', args: { town: 'Eastport', amount: 1 } }] })).json.error).toMatch(/off or uninstalled/);
    const rebuilt = (await c.req('POST', `/api/campaigns/${chat.campaignId}/rebuild`, {})).json.state;
    expect(rebuilt.ext['town-rep'].towns.Eastport).toBe(4);
  });

  it('refuses bad packages, server parts while they are off, and folders outside the import locations', async () => {
    expect((await c.req('POST', '/api/extensions/preview', Buffer.from('not a zip'))).status).toBe(400);
    const noManifest = Buffer.from(zipSync({ 'a.js': new TextEncoder().encode('1') }));
    expect((await c.req('POST', '/api/extensions/preview', noManifest)).json.error).toMatch(/everloom-extension.json/);
    const withServer = Buffer.from(
      zipSync({
        'everloom-extension.json': new TextEncoder().encode(JSON.stringify({ id: 'srv', name: 'Srv', version: '1.0.0', server: { main: 'server.js' } })),
        'server.js': new TextEncoder().encode('export default (api) => api.route("GET", "/hi", () => ({ hi: 1 }));'),
      }),
    );
    const p = (await c.req('POST', '/api/extensions/preview', withServer)).json;
    expect(p.server).toMatchObject({ allowed: false });
    expect((await c.req('POST', '/api/extensions/install', { token: p.token })).json.code).toBe('server_ext_off');
    expect((await c.req('POST', '/api/extensions/dev', { folder: path.resolve(import.meta.dirname, '..') })).status).toBe(403);
  });

  it('a server extension runs in its own process when the server allows it', async () => {
    process.env.EVERLOOM_SERVER_EXTENSIONS = '1';
    try {
      const pkg = Buffer.from(
        zipSync({
          'everloom-extension.json': new TextEncoder().encode(JSON.stringify({ id: 'srv', name: 'Srv', version: '1.0.0', server: { main: 'server.js' } })),
          'server.js': new TextEncoder().encode('export default (api) => { api.route("GET", "/hi/:who", ({ params }) => ({ hi: params.who, pid: process.pid })); api.route("POST", "/boom", () => { process.exit(3); }); };'),
        }),
      );
      const p = (await c.req('POST', '/api/extensions/preview', pkg)).json;
      expect(p.server).toMatchObject({ allowed: true, main: 'server.js' });
      expect(p.server.code).toContain('api.route');
      await c.req('POST', '/api/extensions/install', { token: p.token });
      let r: any = null;
      for (let i = 0; i < 50 && !(r?.status === 200); i++) {
        r = await c.req('GET', '/api/ext/srv/hi/there');
        if (r.status !== 200) await new Promise((res) => setTimeout(res, 100));
      }
      expect(r.json.hi).toBe('there');
      expect(r.json.pid).not.toBe(process.pid);
      // It crashing doesn't take the app down; it comes back.
      await c.req('POST', '/api/ext/srv/boom', {});
      expect((await c.req('GET', '/api/health')).status).toBe(200);
      let back: any = null;
      for (let i = 0; i < 60 && !(back?.status === 200); i++) {
        back = await c.req('GET', '/api/ext/srv/hi/again');
        if (back.status !== 200) await new Promise((res) => setTimeout(res, 100));
      }
      expect(back.json.hi).toBe('again');
      await c.req('DELETE', '/api/extensions/srv');
    } finally {
      delete process.env.EVERLOOM_SERVER_EXTENSIONS;
    }
  }, 30_000);

  it('a dev folder installs live (inside the import locations)', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ext-dev-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'everloom-extension.json'), JSON.stringify({ id: 'dev-ext', name: 'Dev', version: '0.0.1', entries: { panels: [{ id: 'p', title: 'P', file: 'p.html' }] } }));
    writeFileSync(path.join(dir, 'p.html'), '<p>one</p>');
    const d = (await c.req('POST', '/api/extensions/dev', { folder: dir })).json;
    expect(d).toMatchObject({ id: 'dev-ext', dev: true, approved: true });
    writeFileSync(path.join(dir, 'p.html'), '<p>two</p>');
    expect((await c.req('GET', '/api/extensions/dev-ext/entry?file=p.html')).json.text).toBe('<p>two</p>');
  });

  it('the example extensions and the template are valid packages', async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'ext-ex-'));
    for (const name of ['dice-roller', 'relationship-chart', 'town-reputation']) {
      cpSync(path.join(root, 'examples/extensions', name), path.join(tmp, name), { recursive: true });
      const r = await c.req('POST', '/api/extensions/dev', { folder: path.join(tmp, name) });
      expect(r.status, `${name}: ${r.body}`).toBe(200);
    }
    execFileSync(process.execPath, [path.join(root, 'tools/create-everloom-extension/index.mjs'), path.join(tmp, 'made'), '--name', 'Made']);
    expect((await c.req('POST', '/api/extensions/dev', { folder: path.join(tmp, 'made') })).json).toMatchObject({ id: 'made', approved: true });
    expect((await c.req('GET', '/api/extensions')).json.items.map((x: any) => x.id).sort()).toEqual(['dice-roller', 'made', 'relationship-chart', 'town-reputation']);
  });
});
