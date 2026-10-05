/**
 * Scripting building blocks: SillyTavern-format regex rules, slash commands with pipes, the loop
 * guard, message variables, and declarative extension ops (with rollback).
 */
import { describe, expect, it } from 'vitest';
import { guardHtmlScripts, guardLoops, guardPrelude } from '../src/scripting/guard.js';
import {
  applyOps,
  applyRegexScripts,
  expandMacros,
  createInitialState,
  importRegexScripts,
  invertOps,
  messageVarsAt,
  parseSlash,
  RegexPlacement,
  registerExtOps,
  runSlash,
  scriptFingerprint,
  SlashRegistry,
  validateOps,
  type Op,
  type VarMap,
} from '../src/index.js';

describe('regex scripts', () => {
  const st = importRegexScripts({
    regex_scripts: [
      { scriptName: 'status', findRegex: '/<status>(.*?)<\\/status>/gs', replaceString: '```html\n<div class="st">$1</div>\n```', placement: [2], markdownOnly: true },
      { scriptName: 'oops', findRegex: '/\\bteh\\b/g', replaceString: 'the', placement: [1, 2] },
      { scriptName: 'trim', findRegex: '/\\[OOC:.*?\\]/g', replaceString: '', placement: [2], promptOnly: true, maxDepth: 2 },
      { scriptName: 'named', findRegex: '/(?<who>\\w+) waves/g', replaceString: '{{user}} sees $<who> wave ({{match}})', placement: [2] },
      { scriptName: 'off', findRegex: '/x/g', replaceString: 'y', placement: [2], disabled: true },
      { scriptName: 'broken', findRegex: '' },
    ],
  });
  it('imports SillyTavern rules and drops empty ones', () => {
    expect(st.map((s) => s.scriptName)).toEqual(['status', 'oops', 'trim', 'named', 'off']);
  });
  it('stored text: only rules without display/prompt flags, by placement', () => {
    expect(applyRegexScripts('teh cat <status>ok</status>', st, { placement: RegexPlacement.userInput, target: 'stored' })).toBe('the cat <status>ok</status>');
    expect(applyRegexScripts('Ana waves', st, { placement: RegexPlacement.aiOutput, target: 'stored', macros: { user: 'Rin' } })).toBe('Rin sees Ana wave (Ana waves)');
  });
  it('display-only rules change what is shown, prompt-only rules respect depth', () => {
    expect(applyRegexScripts('<status>HP 3</status>', st, { placement: RegexPlacement.aiOutput, target: 'display' })).toBe('```html\n<div class="st">HP 3</div>\n```');
    expect(applyRegexScripts('hi [OOC: note]', st, { placement: RegexPlacement.aiOutput, target: 'prompt', depth: 1 })).toBe('hi ');
    expect(applyRegexScripts('hi [OOC: note]', st, { placement: RegexPlacement.aiOutput, target: 'prompt', depth: 5 })).toBe('hi [OOC: note]');
  });
});

describe('slash commands', () => {
  it('parses names, key=value arguments, quotes and pipes', () => {
    expect(parseSlash('/setvar key=hp 10 | /echo "a | b" | /x')).toEqual([
      { name: 'setvar', args: { key: 'hp' }, text: '10' },
      { name: 'echo', args: {}, text: 'a | b' },
      { name: 'x', args: {}, text: '' },
    ]);
    expect(parseSlash('/sys name="Old Man" Hello there, traveller')).toEqual([{ name: 'sys', args: { name: 'Old Man' }, text: 'Hello there, traveller' }]);
    expect(parseSlash('hello')).toMatchObject({ error: expect.any(String) });
  });
  it('runs a chain: each result is {{pipe}} and the next text when it has none', async () => {
    const reg = new SlashRegistry<{ log: string[] }>();
    reg.register({ name: 'roll', help: '', run: (c) => String(c.text === '2d6' ? 7 : 0) });
    reg.register({ name: 'add', help: '', run: (c) => String(Number(c.text) + Number(c.args.n ?? 0)) });
    reg.register({ name: 'echo', aliases: ['say'], help: '', run: (c, ctx) => void ctx.log.push(c.text) });
    const ctx = { log: [] as string[] };
    expect(await runSlash('/roll 2d6 | /add n=3 | /say You rolled {{pipe}}', reg, ctx)).toEqual({ ok: true, result: '' });
    expect(ctx.log).toEqual(['You rolled 10']);
    expect(await runSlash('/nope', reg, ctx)).toEqual({ ok: false, error: 'Unknown command /nope' });
    expect(reg.suggest('/s').map((d) => d.name)).toEqual(['echo']);
  });
});

describe('loop guard', () => {
  it('adds a check to every loop, braced or not, and leaves other code alone', () => {
    const r = guardLoops('for (let i=0;i<3;i++) x(i); while (a) { b(); } do c(); while (d); const s = "while(true){}";', { fn: '__g1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.loops).toBe(3);
    expect(r.code).toContain('for (let i=0;i<3;i++) {__g1();x(i);}');
    expect(r.code).toContain('while (a) {__g1(); b(); }');
    expect(r.code).toContain('"while(true){}"');
  });
  it('reports syntax errors instead of running them', () => {
    expect(guardLoops('function (')).toMatchObject({ ok: false, line: 1 });
  });
  it('stops an endless loop, even one that catches errors inside', () => {
    const r = guardLoops('let n = 0; while (true) { try { for (;;) { n++; } } catch (e) {} }', { fn: '__g2' });
    if (!r.ok) throw new Error(r.error);
    const run = new Function(`${guardPrelude(100, '__g2')}${r.code}`);
    const t = performance.now();
    expect(() => run()).toThrow(/Stopped/);
    expect(performance.now() - t).toBeLessThan(2000);
    // The guard can't be replaced by the script.
    expect(() => new Function('"use strict"; globalThis.__g2 = () => {}')()).toThrow();
  });
  it('guards inline scripts in HTML and leaves data blocks', () => {
    const { html, errors } = guardHtmlScripts('<script>while(x){}</script><script type="application/json">{"while":1}</script><script>(</script>', '__g3');
    expect(html).toContain('while(x){__g3();}');
    expect(html).toContain('{"while":1}');
    expect(errors).toHaveLength(1);
  });
});

describe('macros for scripts', () => {
  it('{{script::name}} reads values scripts published; {{getmesvar}} reads message variables', () => {
    expect(expandMacros('Rep: {{script::townrep}} / hp {{getmesvar::hp}}', { vars: { '__script.townrep': 'Eastport +12' }, mesVars: { hp: 7 } })).toBe('Rep: Eastport +12 / hp 7');
  });
});

describe('message variables', () => {
  it('follow the active swipe of each message', () => {
    const msgs: Array<{ id: string; swipeId: number; swipes: Array<{ vars?: VarMap }> }> = [
      { id: 'a', swipeId: 0, swipes: [{ vars: { hp: 10, mood: 'calm' } }] },
      { id: 'b', swipeId: 1, swipes: [{ vars: { hp: 1 } }, { vars: { hp: 7, mood: null } }] },
      { id: 'c', swipeId: 0, swipes: [{}] },
    ];
    expect(messageVarsAt(msgs)).toEqual({ hp: 7 });
    expect(messageVarsAt(msgs, 'a')).toEqual({ hp: 10, mood: 'calm' });
    msgs[1]!.swipeId = 0;
    expect(messageVarsAt(msgs)).toEqual({ hp: 1, mood: 'calm' });
  });
  it('a grant fingerprint changes with code, permissions or domains', () => {
    const base = { code: 'x()', permissions: ['chat.read' as const], domains: [] };
    const f = scriptFingerprint(base);
    expect(scriptFingerprint({ ...base })).toBe(f);
    expect(scriptFingerprint({ ...base, code: 'y()' })).not.toBe(f);
    expect(scriptFingerprint({ ...base, permissions: ['chat.read', 'generate'] })).not.toBe(f);
    expect(scriptFingerprint({ ...base, domains: ['example.com'] })).not.toBe(f);
  });
});

describe('extension ops', () => {
  registerExtOps('towns', [
    {
      name: 'rep',
      label: 'Town reputation',
      description: 'Change how a town sees the player',
      params: { town: { type: 'string', maxLength: 40 }, amount: { type: 'integer', min: -20, max: 20 } },
      steps: [
        { do: 'add', path: '/rep/{town}', value: '{amount}', min: -100, max: 100 },
        { do: 'push', path: '/log', value: '{town} {amount}', limit: 3 },
      ],
      summary: '{town} {amount:+}',
      ai: true,
    },
    { name: 'ban', label: 'Ban', params: { town: { type: 'string' } }, steps: [{ do: 'require', path: '/rep/{town}', check: 'lte', value: -50, message: 'Not hated enough' }, { do: 'set', path: '/banned/{town}', value: true }] },
  ]);
  it('apply, clamp, report and roll back like built-in ops', () => {
    const s0 = createInitialState({ seed: 1 });
    const r = applyOps(s0, [{ type: 'ext.op', ext: 'towns', name: 'rep', args: { town: 'Eastport', amount: 15 } } as Op], { source: 'user' });
    expect(r.errors).toEqual([]);
    expect(r.state.ext?.towns).toEqual({ rep: { Eastport: 15 }, log: ['Eastport 15'] });
    expect(r.changes[0]!.text).toBe('Eastport +15');
    expect(invertOps(r.state, r.inverses)).toEqual(s0);
  });
  it('arguments and checks are enforced; nothing changes when they fail', () => {
    const s0 = createInitialState({ seed: 1 });
    const bad = applyOps(s0, [
      { type: 'ext.op', ext: 'towns', name: 'rep', args: { town: 'X', amount: 99 } } as Op,
      { type: 'ext.op', ext: 'towns', name: 'rep', args: { town: '__proto__', amount: 1 } } as Op,
      { type: 'ext.op', ext: 'towns', name: 'ban', args: { town: 'X' } } as Op,
      { type: 'ext.op', ext: 'nope', name: 'rep', args: {} } as Op,
    ], { source: 'user' });
    expect(bad.errors.map((e) => e.error)).toEqual([expect.stringMatching(/above 20/), expect.stringMatching(/Bad key/), 'Not hated enough', expect.stringMatching(/Unknown extension op/)]);
    expect(bad.state).toEqual(s0);
  });
  it('only ops marked for the AI can come from it, and they are in its op list', () => {
    const s0 = createInitialState({ seed: 1 });
    const v = validateOps([{ type: 'ext.op', ext: 'towns', name: 'ban', args: { town: 'X' } }]);
    expect(v.ok).toHaveLength(1);
    expect(applyOps(s0, v.ok, { source: 'ai' }).errors[0]!.error).toMatch(/can't be used by the AI/);
  });
});
