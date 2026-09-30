import { describe, expect, it } from 'vitest';
import { buildLoreEntryPrompt, buildLoreGenPrompt, parseLoreEntry, parseLoreProposals } from '../src/lore/generate.js';

describe('lorebook entry generation', () => {
  it('tells the model what exists and what the story is about', () => {
    const [sys, user] = buildLoreGenPrompt({ topic: 'the harbor factions', count: 4, bookName: 'Northcrest', existing: [{ comment: 'The Ravens', key: ['ravens', 'band'] }], about: 'A rainy port town.' });
    expect(sys!.content).toContain('exactly 4 entries');
    expect(user!.content).toContain('- The Ravens (keys: ravens, band)');
    expect(user!.content).toContain('A rainy port town.');
    expect(user!.content).toContain('about: the harbor factions');
    const [, one] = buildLoreEntryPrompt({ entry: { comment: 'Tide Bell', key: [], content: 'A bell.' }, instruction: 'spookier', bookName: 'N', existing: [{ comment: 'Tide Bell', key: [] }] });
    expect(one!.content).toContain('Improve the entry "Tide Bell"');
    expect(one!.content).toContain('Current text:\nA bell.');
    expect(one!.content).toContain('Also: spookier');
    expect(one!.content).not.toContain('- Tide Bell'); // the entry itself isn't listed as "already covered"
  });

  it('keeps usable proposals and drops repeats of existing entries and each other', () => {
    const text = JSON.stringify({
      entries: [
        { title: 'The Ravens', keys: ['ravens'], content: 'Again.' },
        { title: 'Harbor Guild', keys: 'guild, Guild, harbor guild', content: 'Dockworkers.' },
        { title: 'harbor guild', keys: ['x'], content: 'Dup.' },
        { title: 'No content', keys: ['a'], content: '' },
        { title: 'Keyless', content: 'Falls back to its title as the key.', constant: true },
      ],
    });
    expect(parseLoreProposals(text, [{ comment: 'The Ravens', key: [] }])).toEqual([
      { title: 'Harbor Guild', keys: ['guild', 'harbor guild'], content: 'Dockworkers.', constant: false },
      { title: 'Keyless', keys: ['keyless'], content: 'Falls back to its title as the key.', constant: true },
    ]);
    expect(() => parseLoreProposals('{"entries":[{"title":"The Ravens","content":"x"}]}', [{ comment: 'The Ravens', key: [] }])).toThrow(/already has/);
    expect(() => parseLoreProposals('nothing useful')).toThrow(/any entries/);
  });

  it('reads a single entry, as JSON or plain text', () => {
    expect(parseLoreEntry('{"keys":["bell"],"content":"It rings."}')).toEqual({ keys: ['bell'], content: 'It rings.' });
    expect(parseLoreEntry('It rings at dusk.')).toEqual({ keys: [], content: 'It rings at dusk.' });
  });
});
