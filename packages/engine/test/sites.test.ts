import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  aiccDetail,
  aiccKeyFromLink,
  aiccSearchResults,
  aiccSearchUrl,
  aiccTags,
  applyLocalFilters,
  bbDetail,
  bbKeyFromLink,
  bbSearchResults,
  bbSearchUrl,
  bbTags,
  chubQueryUrl,
  crossSourceKey,
  ctDetail,
  ctKeyFromLink,
  ctSearchResults,
  ctSearchUrl,
  ctTags,
  decodeSvelteKit,
  emptySourceQuery,
  formatSourceQuery,
  parseSourceQuery,
  SiteChanged,
  spDetail,
  spKeyFromLink,
  spSearchRequest,
  spSearchResults,
  toCharacterBook,
  type SourceItem,
  type SourceQuery,
} from '../src/index.js';

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures/sources');
const raw = (p: string) => readFileSync(path.join(FX, p), 'utf8');
const fx = (p: string) => JSON.parse(raw(p));
const q = (over: Partial<SourceQuery> = {}): SourceQuery => ({ ...emptySourceQuery(), ...over });

describe('the source query language', () => {
  it('reads filters, online-only keys and free text; writes them back', () => {
    const r = parseSourceQuery('dark elf tag:fantasy -tag:yandere creator:quill tokens<2000 has:lorebook sort:newest time:week lang:en nsfw:yes');
    expect(r.errors).toEqual([]);
    expect(r.query).toMatchObject({ text: 'dark elf', includeTags: ['fantasy'], excludeTags: ['yandere'], creator: 'quill', maxTokens: 1999, hasLorebook: true, sort: 'new', time: 'week', language: 'en', nsfw: true });
    expect(formatSourceQuery(r.query)).toBe('dark elf tag:fantasy -tag:yandere creator:quill tokens<=1999 has:lorebook lang:en sort:new time:week');
    expect(parseSourceQuery('sort:sideways').errors.join()).toMatch(/sort/);
  });
  it('the final pass enforces what the listing shows, and says what was page-only', () => {
    const item = (o: Partial<SourceItem>): SourceItem => ({ provider: 'x', key: o.name ?? 'k', name: 'n', tagline: '', creator: '', tags: [], avatarUrl: null, url: '', nsfw: false, tokens: null, stars: null, updatedAt: null, ...o });
    const items = [item({ name: 'a', tags: ['Fantasy', 'Elf'], tokens: 500 }), item({ name: 'b', tags: ['fantasy'], tokens: 5000 }), item({ name: 'c', tags: ['fantasy'], nsfw: true }), item({ name: 'd', tags: [] })];
    const r = applyLocalFilters(items, q({ includeTags: ['fantasy'], maxTokens: 1000 }), new Set(['tags']));
    // d has no tags in the listing: the site filtered by tag, so it is trusted; c is adult.
    expect(r.items.map((i) => i.name)).toEqual(['a', 'd']);
    expect(r.local).toEqual(['tokens']);
    expect(applyLocalFilters(items, q({ includeTags: ['fantasy'] }), new Set()).items.map((i) => i.name)).toEqual(['a', 'b']);
  });
  it('cross-source keys ignore case and punctuation', () => {
    expect(crossSourceKey({ name: 'Wren, of the Archive!', creator: 'Quill' })).toBe(crossSourceKey({ name: 'wren of the archive', creator: 'quill' }));
  });
});

describe('Character Tavern', () => {
  it('builds its page-data URLs', () => {
    const u = new URL(ctSearchUrl(q({ text: 'elf', includeTags: ['fantasy'], excludeTags: ['gore'], minTokens: 100, hasLorebook: true, sort: 'top', page: 2 })));
    expect(u.pathname).toBe('/search/cards/__data.json');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ query: 'elf', page: '2', sort: 'most_liked', tags: 'fantasy', exclude_tags: 'gore', minimum_tokens: '100', hasLorebook: 'true', 'x-sveltekit-invalidated': '001' });
  });
  it('reads search, tags and characters from SvelteKit page data, with streamed values', () => {
    const r = ctSearchResults(raw('ctavern/search.ndjson'));
    expect(r.items.map((i) => i.key)).toEqual(['quillwright/wren_of_the_lantern_archive', 'saltmarsh/captain_orla_vey', 'nightowl/velvet_lounge_host']);
    expect(r.items[2]!.nsfw).toBe(true);
    expect(r.items[0]!.avatarUrl).toBe('https://ct-cards.storage.character-tavern.com/quillwright/wren_of_the_lantern_archive.png');
    expect(ctTags(raw('ctavern/tags.ndjson')).find((t) => t.tag === 'pirate')).toEqual({ tag: 'pirate', count: 95 });
    const d = ctDetail(raw('ctavern/wren.ndjson'))!;
    expect(d.card).toMatchObject({ name: 'Wren', alternate_greetings: ['"Mind the ink," Wren says.', '"Another sleepless reader?"'] });
    expect((d.card as any).character_book.entries).toHaveLength(1);
    const h = ctDetail(raw('ctavern/orla.ndjson'))!;
    expect(h).toMatchObject({ hidden: true, card: { description: '', extensions: { definition_hidden: true } } });
    expect(ctKeyFromLink('https://character-tavern.com/character/quillwright/wren_of_the_lantern_archive?x=1')).toBe('quillwright/wren_of_the_lantern_archive');
  });
  it('a changed shape is a SiteChanged error, not a crash', () => {
    expect(() => ctSearchResults('{"type":"data","nodes":[{"type":"data","data":[{"searchResults":1},{"hits":2},"x"]}]}')).toThrow(SiteChanged);
    expect(decodeSvelteKit('{"type":"data","nodes":[]}')).toBeNull();
  });
});

describe('Botbooru', () => {
  it('tag query, text, tokens, time window and SFW switch', () => {
    const u = new URL(bbSearchUrl(q({ text: 'garden', includeTags: ['dark fantasy'], excludeTags: ['gore'], creator: 'fernwright', maxTokens: 3000, time: 'week', sort: 'popular' })));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ sort: 'downloads', q: 'dark_fantasy -gore fernwright', qtext: 'garden', max_tokens: '3000', time_window: 'week', sfw_only: 'true' });
  });
  it('maps listing, detail and tags', () => {
    const r = bbSearchResults(fx('botbooru/posts.json'), q());
    expect(r.items[0]).toMatchObject({ key: '90001', creator: 'fernwright', language: 'english', hasLorebook: true, tags: ['fantasy', 'gardener'], nsfw: false });
    expect(r.items[2]!.nsfw).toBe(true);
    const d = bbDetail(fx('botbooru/post-90001.json'))!;
    expect(d.card).toMatchObject({ creator_notes: 'Use **gently**.', alternate_greetings: ['"The roses are early this year."'] });
    expect((d.card as any).character_book.entries[0]).toMatchObject({ keys: ['greenhouse'] });
    expect(bbTags(fx('botbooru/tags.json')).map((t) => t.tag)).toEqual(['fantasy', 'gardener']);
    expect(bbKeyFromLink('https://botbooru.com/post/90001')).toBe('90001');
  });
});

describe('Saucepan', () => {
  it('free text only when signed in', () => {
    expect(spSearchRequest(q({ text: 'pip' }), false).body).not.toHaveProperty('text_search');
    expect(spSearchRequest(q({ text: 'pip', includeTags: ['map maker'], sort: 'new' }), true).body).toMatchObject({ text_search: 'pip', tags: ['map_maker'], match_all_tags: true, order_by: 'created', sus: false });
  });
  it('maps listing and definition; a missing definition is labelled hidden', () => {
    const r = spSearchResults(fx('saucepan/search.json'), q());
    expect(r.items[0]).toMatchObject({ name: 'Pip the Cartographer', creator: 'inkpot', tags: ['fantasy', 'map maker', 'female'], greetings: 1 });
    const d = spDetail(fx('saucepan/definition-1.json'), r.items[0]!)!;
    expect(d.card).toMatchObject({ first_mes: '"Need a map?"', mes_example: '{{char}}: "Hold this corner."' });
    expect(spDetail(fx('saucepan/definition-2.json'), r.items[1]!)!).toMatchObject({ hidden: true, card: { description: '' } });
    expect(spKeyFromLink('https://saucepan.ai/companion/5A5A5A5A-0000-4000-8000-000000000001')).toBe('5a5a5a5a-0000-4000-8000-000000000001');
  });
});

describe('AI Character Cards', () => {
  it('tags go by id; detail points at the current card file', () => {
    const tags = aiccTags(fx('aicc/tags.json'));
    const u = new URL(aiccSearchUrl(q({ includeTags: ['romance'], excludeTags: ['Slice of Life', 'unknown'], language: 'en' }), tags));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ tags: '370', excludeTags: '363', language: 'en' });
    expect(aiccSearchResults(fx('aicc/cards.json'), q()).items[0]).toMatchObject({ key: '4001', avatarUrl: 'https://api.aicharactercards.com/uploads/character_cards/500/card-500-4001-opt.webp', language: 'en' });
    expect(aiccDetail(fx('aicc/card-4001.json'))!.fileUrl).toBe('https://api.aicharactercards.com/uploads/character_cards/500/card-500-4001.png');
    expect(aiccKeyFromLink('https://aicharactercards.com/cards/4001')).toBe('4001');
  });
});

describe('Chub query', () => {
  it('carries every filter it documents', () => {
    const u = new URL(chubQueryUrl(q({ includeTags: ['elf'], excludeTags: ['gore'], creator: 'tide', minTokens: 10, time: 'month', hasLorebook: true })));
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ tags: 'elf', exclude_tags: 'gore', username: 'tide', min_tokens: '10', max_days_ago: '30', require_lore: 'true', nsfw: 'false' });
  });
});

describe('lorebooks as sites ship them', () => {
  it('SillyTavern world info becomes a character book; empty is null', () => {
    expect((toCharacterBook({ entries: { 3: { uid: 3, key: ['a'], content: 'A.' } } }) as any).entries[0]).toMatchObject({ keys: ['a'], content: 'A.' });
    expect(toCharacterBook('{"entries":[]}')).toBeNull();
    expect(toCharacterBook('not json')).toBeNull();
  });
});
