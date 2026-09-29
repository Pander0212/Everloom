import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRESET, assemblePrompt, createRng, expandMacros, exportSillyTavernPreset, findInstructTemplate, importSillyTavernPreset,
  renderInstructPrompt, type AssemblyInput,
} from '../src/index.js';

describe('macros', () => {
  it('expands core macros', () => {
    expect(expandMacros('{{char}} greets {{user}}. <BOT>/<USER>', { char: 'Iris', user: 'Anala' })).toBe('Iris greets Anala. Iris/Anala');
    expect(expandMacros('a{{newline}}b{{noop}}{{// comment}}', {})).toBe('a\nb');
    expect(expandMacros('x  {{trim}}  y', {})).toBe('xy');
  });
  it('random, pick and roll', () => {
    const r = expandMacros('{{random::a::b::c}}', { rng: createRng(3) });
    expect(['a', 'b', 'c']).toContain(r);
    const r2 = expandMacros('{{random:x,y}}', { rng: createRng(3) });
    expect(['x', 'y']).toContain(r2);
    const roll = Number(expandMacros('{{roll:2d6}}', { rng: createRng(9) }));
    expect(roll).toBeGreaterThanOrEqual(2);
    expect(roll).toBeLessThanOrEqual(12);
    const a = expandMacros('{{pick::1::2::3::4::5}}', { pickSeed: 'chat1' });
    const b = expandMacros('{{pick::1::2::3::4::5}}', { pickSeed: 'chat1' });
    expect(a).toBe(b);
  });
  it('variables', () => {
    const vars: Record<string, string | number> = {};
    expect(expandMacros('{{setvar::mood::happy}}{{getvar::mood}}', { vars })).toBe('happy');
    expandMacros('{{setvar::n::1}}{{addvar::n::4}}{{incvar::n}}', { vars });
    expect(vars.n).toBe(6);
  });
  it('game macros', () => {
    const out = expandMacros('{{location}} at {{time}}, {{weather}}. HP {{hp}}/{{maxhp}}. Hunger {{tracker::hunger}}', {
      game: { location: 'Old Mill', time: '4:52 PM', weather: 'rain', bars: { hp: { cur: 80, max: 100 } }, trackers: { hunger: { value: 42, max: 100, label: 'Hunger' } } },
    });
    expect(out).toBe('Old Mill at 4:52 PM, rain. HP 80/100. Hunger 42');
  });
  it('leaves unknown macros alone', () => {
    expect(expandMacros('{{unknownthing}}', {})).toBe('{{unknownthing}}');
  });
});

function input(over: Partial<AssemblyInput> = {}): AssemblyInput {
  return {
    preset: DEFAULT_PRESET,
    macros: { char: 'Iris', user: 'Anala' },
    character: { name: 'Iris', description: 'DESC', personality: 'TRAITS', scenario: 'SCEN', mesExample: '<START>\n{{char}}: Hello', systemPrompt: '', postHistoryInstructions: '' },
    personaDescription: 'PERSONA',
    worldInfo: { before: 'WIB', after: 'WIA', depth: [], anTop: [], anBottom: [], emTop: [], emBottom: [] },
    memory: 'MEM',
    gameState: 'GAME',
    history: [
      { role: 'assistant', name: 'Iris', content: 'm1' },
      { role: 'user', name: 'Anala', content: 'm2' },
      { role: 'assistant', name: 'Iris', content: 'm3' },
    ],
    type: 'normal',
    maxContext: 8000,
    maxResponse: 500,
    authorsNote: { content: 'NOTE', depth: 1, role: 'system' },
    ...over,
  };
}

describe('prompt assembly', () => {
  it('follows the preset block order', () => {
    const r = assemblePrompt(input());
    const contents = r.messages.map((m) => m.content);
    const idx = (s: string) => contents.findIndex((c) => c.includes(s));
    const order = ['Write Iris', 'WIB', 'PERSONA', 'DESC', 'TRAITS', 'SCEN', 'MEM', 'GAME', 'WIA', 'Hello', 'm1', 'm2', 'm3'];
    const positions = order.map(idx);
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('injects the author\'s note at depth', () => {
    const r = assemblePrompt(input());
    const contents = r.messages.map((m) => m.content);
    expect(contents.indexOf('NOTE')).toBe(contents.indexOf('m3') - 1);
  });

  it('character system prompt overrides main with {{original}}', () => {
    const r = assemblePrompt(input({ character: { ...input().character, systemPrompt: 'CHARSYS {{original}}' } }));
    expect(r.messages[0].content.startsWith('CHARSYS Write Iris')).toBe(true);
  });

  it('trims oldest history to fit the budget', () => {
    const history = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', name: 'x', content: `message number ${i} `.repeat(20) })) as any;
    const r = assemblePrompt(input({ history, maxContext: 3000, maxResponse: 500 }));
    expect(r.trimmedHistory).toBeGreaterThan(0);
    expect(r.totalTokens).toBeLessThanOrEqual(r.budget + 50);
    expect(r.messages.at(-1)!.content).toContain('message number 199');
  });

  it('adds impersonation and continue nudges', () => {
    expect(assemblePrompt(input({ type: 'impersonate' })).messages.at(-1)!.content).toContain('point of view of Anala');
    expect(assemblePrompt(input({ type: 'continue' })).messages.at(-1)!.content).toContain('Continue');
  });

  it('renders instruct text-completion prompts', () => {
    const r = assemblePrompt(input());
    const t = renderInstructPrompt(r, findInstructTemplate('ChatML'), { charName: 'Iris', userName: 'Anala' });
    expect(t.prompt.endsWith('<|im_start|>assistant\nIris: ')).toBe(true);
    expect(t.stop).toContain('<|im_end|>');
  });

  it('imports and exports SillyTavern presets', () => {
    const st = {
      temperature: 0.8,
      prompts: [
        { identifier: 'main', name: 'Main Prompt', system_prompt: true, role: 'system', content: 'MAIN' },
        { identifier: 'charDescription', marker: true },
        { identifier: 'chatHistory', marker: true },
        { identifier: 'custom1', name: 'Style', role: 'system', content: 'Be terse.' },
        { identifier: 'jailbreak', name: 'PHI', role: 'system', content: 'PHI' },
      ],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }, { identifier: 'custom1', enabled: true }, { identifier: 'charDescription', enabled: true }, { identifier: 'chatHistory', enabled: true }, { identifier: 'jailbreak', enabled: false }] }],
    };
    const { preset, samplers } = importSillyTavernPreset(st, 'X');
    expect(samplers.temperature).toBe(0.8);
    expect(preset.blocks.map((b) => b.id).slice(0, 3)).toEqual(['main', 'custom1', 'charDescription']);
    expect(preset.blocks.find((b) => b.id === 'postHistory')!.enabled).toBe(false);
    expect(preset.blocks.some((b) => b.marker === 'gameState')).toBe(true);
    const out = exportSillyTavernPreset(preset, samplers) as any;
    expect(out.prompts.find((p: any) => p.identifier === 'jailbreak').content).toBe('PHI');
  });
});
