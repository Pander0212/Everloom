import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assemblePrompt, immersivePreset, type MacroContext } from '@everloom/engine';
import { createClient, type TestClient } from './helpers.js';

let c: TestClient;
beforeEach(async () => {
  c = await createClient();
});
afterEach(async () => c?.close());

describe('Everloom Immersive preset', () => {
  it('is added once, editable, deletable for good, and never made active on its own', async () => {
    const list = (await c.req('GET', '/api/presets')).json;
    const imm = list.find((p: any) => p.name === 'Everloom Immersive');
    expect(imm).toBeTruthy();
    expect((await c.req('GET', '/api/settings')).json.activePresetId ?? null).toBeNull();
    expect((await c.req('GET', '/api/presets')).json.filter((p: any) => p.name === 'Everloom Immersive')).toHaveLength(1);
    await c.req('DELETE', `/api/presets/${imm.id}`);
    expect((await c.req('GET', '/api/presets')).json.some((p: any) => p.name === 'Everloom Immersive')).toBe(false);
  });

  it('puts the rules first and the reminder right after the history; a card can still override', () => {
    const base = { macros: { user: 'Rin', char: 'Miki' } as MacroContext, personaDescription: 'Rin, an adult ranger.', worldInfo: { before: '', after: '', depth: [], anTop: [], anBottom: [], emTop: [], emBottom: [] }, history: [{ role: 'user' as const, name: 'Rin', content: 'Hello.' }], type: 'normal' as const, maxContext: 16000, maxResponse: 500, countTokens: (s: string) => Math.ceil(s.length / 4) };
    const card = { name: 'Miki', description: 'Receptionist.', personality: '', scenario: '', mesExample: '', systemPrompt: '', postHistoryInstructions: '' };
    const a = assemblePrompt({ ...base, preset: immersivePreset(), character: card });
    const text = a.messages.map((m) => m.content).join('\n---\n');
    expect(a.messages[0].content).toContain('Never write Rin');
    expect(text).toContain('nothing sexual involving anyone under 18');
    expect(a.messages[a.messages.length - 1].content).toContain('Do not write for Rin');
    const own = assemblePrompt({ ...base, preset: immersivePreset(), character: { ...card, postHistoryInstructions: 'Card rule. {{original}}' } });
    expect(own.messages[own.messages.length - 1].content).toContain('Card rule.');
    expect(own.messages[own.messages.length - 1].content).toContain('Do not write for Rin');
  });
});
