import { describe, expect, it } from 'vitest';
import { buildStudioMessages, cleanCardPatch, draftText, parseStudioReply } from '../src/library/studio.js';

describe('character studio', () => {
  it('shows the model only the filled-in fields of the draft', () => {
    const t = draftText({ name: 'Maren', description: 'Keeps a lighthouse.', personality: '', tags: ['mystery'], alternate_greetings: [] });
    expect(t).toContain('## Name (name)\nMaren');
    expect(t).toContain('## Tags (tags)\nmystery');
    expect(t).not.toContain('Personality');
    expect(t).not.toContain('Alternate');
    expect(draftText({})).toBe('(empty so far)');
  });

  it('puts the chosen system prompt first and the passage to revise in the user turn', () => {
    const m = buildStudioMessages({ mode: 'revise', field: 'description', selection: 'She logs ships.', instruction: 'more ominous' }, { description: 'Maren keeps the light. She logs ships.' }, 'CUSTOM SYSTEM');
    expect(m[0]!.role).toBe('system');
    expect(m[0]!.content.startsWith('CUSTOM SYSTEM')).toBe(true);
    expect(m[1]!.content).toContain('<<<\nShe logs ships.\n>>>');
    expect(m[1]!.content).toContain('How: more ominous');
  });

  it('keeps only known card fields with the right types', () => {
    const p = cleanCardPatch({ name: '  Maren  ', tags: 'Mystery, #Coastal', alternate_greetings: 'One\nTwo', evil: 'x', description: 42, creator: 'me' });
    expect(p).toEqual({ name: 'Maren', tags: ['mystery', 'coastal'], alternate_greetings: ['One', 'Two'] });
  });

  it('parses each mode, and fails clearly on a useless reply', () => {
    expect(parseStudioReply({ mode: 'brainstorm', brief: '' }, '```json\n{"ideas":[{"title":"A","pitch":"B"}]}\n```')).toEqual({ mode: 'brainstorm', ideas: [{ title: 'A', pitch: 'B' }] });
    expect(() => parseStudioReply({ mode: 'brainstorm', brief: '' }, 'Sure! Here are some ideas.')).toThrow(/ideas/);
    const c = parseStudioReply({ mode: 'create', brief: 'x' }, '{"card":{"name":"Maren","description":"D"},"notes":"n"}');
    expect(c).toEqual({ mode: 'create', card: { name: 'Maren', description: 'D' }, notes: 'n' });
    expect(() => parseStudioReply({ mode: 'create', brief: 'x' }, '{"card":{"description":"D"}}')).toThrow(/name/);
    expect(parseStudioReply({ mode: 'refine', instruction: 'x' }, '{"card":{"personality":"Warm."}}')).toMatchObject({ card: { personality: 'Warm.' } });
    expect(parseStudioReply({ mode: 'field', field: 'tags' }, 'lighthouse\nMystery')).toEqual({ mode: 'field', field: 'tags', value: ['lighthouse', 'mystery'] });
    expect(parseStudioReply({ mode: 'field', field: 'first_mes' }, '```\nHello there.\n```')).toEqual({ mode: 'field', field: 'first_mes', value: 'Hello there.' });
    expect(parseStudioReply({ mode: 'revise', field: 'description', selection: 's', instruction: 'i' }, '"She counts the drowned."')).toEqual({ mode: 'revise', field: 'description', text: 'She counts the drowned.' });
  });
});
