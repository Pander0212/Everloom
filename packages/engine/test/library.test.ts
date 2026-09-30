import { describe, expect, it } from 'vitest';
import { cardHash, diffCards, findDuplicates, matchItem, nameSimilarity, nextTagState, parseQuery, relatedTo, sortItems, tagCounts, wordDiff, type LibraryItem } from '../src/index.js';

const item = (p: Partial<LibraryItem> & { id: string; name: string }): LibraryItem => ({ tags: [], creator: '', description: '', tokens: 1000, fav: false, createdAt: 1, updatedAt: 1, ...p });
const lib = [
  item({ id: 'a', name: 'Iris Thorne', tags: ['Modern', 'slice of life'], creator: 'John', description: 'A bartender who keeps a ledger.', tokens: 1800, fav: true, hasLorebook: true, collections: ['c1'] }),
  item({ id: 'b', name: 'Seraphina', tags: ['fantasy', 'healer'], creator: 'Someone', description: 'Guardian of the glade.', tokens: 900, hasGallery: true, linked: 'chub:abc' }),
  item({ id: 'c', name: 'Kael the dark elf', tags: ['fantasy', 'nsfw'], creator: 'johnny', description: 'A dark elf rogue.', tokens: 2500, updatedAt: 5 }),
];
const run = (q: string, opts = {}) => lib.filter((c) => matchItem(c, parseQuery(q), { collectionNames: { c1: 'Backlog' }, ...opts })).map((c) => c.id);

describe('library search', () => {
  it('parses prefixes, negation, comparisons and quoted phrases', () => {
    const p = parseQuery('dark elf creator:john tag:fantasy -tag:nsfw tokens>1500 has:lorebook fav linked:no in:"back log" bogus:1');
    expect(p.text).toEqual(['dark', 'elf', 'bogus:1']);
    expect(p.creator).toEqual(['john']);
    expect(p.tags).toEqual({ include: ['fantasy'], exclude: ['nsfw'] });
    expect(p.tokens).toEqual([{ op: '>', n: 1500 }]);
    expect(p.has).toEqual([{ what: 'lorebook', value: true }]);
    expect(p.fav).toBe(true);
    expect(p.linked).toBe(false);
    expect(p.collection).toEqual(['back log']);
    expect(p.errors).toEqual(['bogus: is not a filter']);
  });
  it('filters', () => {
    expect(run('')).toEqual(['a', 'b', 'c']);
    expect(run('dark elf')).toEqual(['c']);
    expect(run('creator:john')).toEqual(['a', 'c']); // contains match
    expect(run('tag:fantasy -tag:nsfw')).toEqual(['b']);
    expect(run('tokens>=1800')).toEqual(['a', 'c']);
    expect(run('tokens<1000')).toEqual(['b']);
    expect(run('has:lorebook')).toEqual(['a']);
    expect(run('-has:gallery')).toEqual(['a', 'c']);
    expect(run('fav')).toEqual(['a']);
    expect(run('fav:no')).toEqual(['b', 'c']);
    expect(run('linked:yes')).toEqual(['b']);
    expect(run('linked:chub')).toEqual(['b']);
    expect(run('in:backlog')).toEqual(['a']);
    expect(run('in:none')).toEqual(['b', 'c']);
    expect(run('ledger')).toEqual(['a']); // creator notes / description
    expect(run('ledger', { fields: { notes: false } })).toEqual([]);
  });
  it('tri-state tags: include must have, exclude must not, neutral ignored', () => {
    expect(run('', { tagStates: { fantasy: 'include' } })).toEqual(['b', 'c']);
    expect(run('', { tagStates: { fantasy: 'include', nsfw: 'exclude' } })).toEqual(['b']);
    expect(run('', { tagStates: { MODERN: 'include' } })).toEqual(['a']);
    expect([nextTagState(undefined), nextTagState('include'), nextTagState('exclude')]).toEqual(['include', 'exclude', undefined]);
    expect(tagCounts(lib)[0]).toEqual({ tag: 'fantasy', count: 2 });
  });
  it('sorts, including a stable seeded random', () => {
    expect(sortItems(lib, 'name').map((c) => c.id)).toEqual(['a', 'c', 'b']);
    expect(sortItems(lib, 'tokens').map((c) => c.id)).toEqual(['c', 'a', 'b']);
    expect(sortItems(lib, 'modified').map((c) => c.id)[0]).toBe('c');
    expect(sortItems(lib, 'name', { favFirst: true }).map((c) => c.id)[0]).toBe('a');
    expect(sortItems(lib, 'random', { seed: 9 })).toEqual(sortItems(lib, 'random', { seed: 9 }));
  });
  it('is fast on 2,000 characters', () => {
    const many = Array.from({ length: 2000 }, (_, i) => item({ id: `x${i}`, name: `Character ${i}`, tags: [`tag${i % 40}`, i % 3 ? 'fantasy' : 'modern'], creator: `creator${i % 50}`, description: `A long description number ${i} `.repeat(10), tokens: i * 3 }));
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) {
      const p = parseQuery(`creator:creator1 tag:fantasy tokens>300 description ${k}`);
      sortItems(many.filter((c) => matchItem(c, p)), 'name');
    }
    expect((performance.now() - t0) / 20).toBeLessThan(25);
  });
});

describe('cards', () => {
  it('diffs fields with word-level changes', () => {
    const d = diffCards({ name: 'Iris', description: 'A quiet bartender.', tags: ['a'] }, { name: 'Iris', description: 'A very quiet bartender!', tags: ['a', 'b'] });
    expect(d.map((x) => x.key)).toEqual(['description', 'tags']);
    const ops = d[0].words.filter((w) => w.op !== 'same').map((w) => `${w.op}:${w.text.trim()}`);
    expect(ops).toEqual(['add:very', 'del:bartender.', 'add:bartender!']);
    expect(wordDiff('a b c', 'a b c')).toEqual([{ op: 'same', text: 'a b c' }]);
  });
  it('hashes content, not presentation', () => {
    expect(cardHash({ name: 'Iris', description: 'A  bartender.' })).toBe(cardHash({ name: 'iris', description: 'A bartender. ', tags: ['x'] } as any));
    expect(cardHash({ name: 'Iris', description: 'A bartender.' })).not.toBe(cardHash({ name: 'Iris', description: 'A baker.' }));
  });
  it('finds duplicates by hash, by name+creator, and by similar name and description', () => {
    expect(nameSimilarity('Iris Thorne (v2)', 'Iris Thorne')).toBe(1);
    const g = findDuplicates([
      { id: '1', name: 'Iris', creator: 'j', hash: 'h1', description: 'x', updatedAt: 1 },
      { id: '2', name: 'Iris copy', creator: 'k', hash: 'h1', description: 'y', updatedAt: 2 },
      { id: '3', name: 'Seraphina', creator: 'z', hash: 'h3', description: 'Guardian of the forest glade, a healer.', updatedAt: 1 },
      { id: '4', name: 'Seraphina (v2)', creator: 'q', hash: 'h4', description: 'Guardian of the forest glade and a gentle healer.', updatedAt: 3 },
      { id: '5', name: 'Kael', creator: 'z', hash: 'h5', description: 'Rogue.', updatedAt: 1 },
      { id: '6', name: 'Kael', creator: 'z', hash: 'h6', description: 'Different.', updatedAt: 2 },
      { id: '7', name: 'Kaelen', creator: 'y', hash: 'h7', description: 'Unrelated knight.', updatedAt: 2 },
    ]);
    expect(g.map((x) => [x.reason, x.ids])).toEqual([
      ['identical', ['2', '1']],
      ['similar', ['4', '3']],
      ['same name and creator', ['6', '5']],
    ]);
  });
  it('related: shared rare tags, same creator, similar description', () => {
    const all = [
      { id: 't', name: 'T', tags: ['fantasy', 'elf'], creator: 'ann', description: 'An elf ranger of the northern woods.' },
      { id: 'a', name: 'A', tags: ['fantasy'], creator: 'bob', description: 'A merchant.' },
      { id: 'b', name: 'B', tags: ['elf'], creator: 'ann', description: 'An elf druid of the northern woods.' },
      { id: 'c', name: 'C', tags: ['modern'], creator: 'cy', description: 'An accountant.' },
    ];
    const r = relatedTo(all[0], all);
    expect(r.map((x) => x.id)).toEqual(['b', 'a']);
    expect(r[0].reasons).toEqual(expect.arrayContaining(['same creator', 'similar description']));
  });
});
