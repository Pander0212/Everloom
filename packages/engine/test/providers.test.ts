import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  chubDetail,
  ctDetail,
  ctKeyFromLink,
  ctSearchResults,
  pygDetail,
  pygKeyFromLink,
  pygSearchResults,
  risuDetail,
  risuKeyFromLink,
  risuSearchResults,
  unflattenPageData,
  wyvDetail,
  wyvKeyFromLink,
  wyvSearchResults,
} from '../src/index.js';

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures/sources');
const fx = (p: string) => JSON.parse(readFileSync(path.join(FX, p), 'utf8'));

describe('Character Tavern', () => {
  it('search maps hits and flags adult content', () => {
    const r = ctSearchResults(fx('ctavern/search.json'));
    expect(r.items.map((i) => i.key)).toEqual(['quillwright/wren_of_the_lantern_archive', 'saltmarsh/captain_orla_vey', 'midnight/velvet_night']);
    expect(r.items[0]).toMatchObject({ provider: 'ctavern', creator: 'quillwright', avatarUrl: 'https://cards.character-tavern.com/quillwright/wren_of_the_lantern_archive.png', nsfw: false, tokens: 412 });
    expect(r.items[2]!.nsfw).toBe(true);
    expect(r.hasMore).toBe(false);
  });
  it('detail maps the definition; a private card keeps only its public profile', () => {
    const d = ctDetail(fx('ctavern/quillwright__wren_of_the_lantern_archive.json'))!;
    expect(d.hidden).toBe(false);
    expect(d.card).toMatchObject({ name: 'Wren', description: expect.stringContaining('Lantern Archive'), personality: 'Gentle, precise, quietly funny.', first_mes: expect.stringContaining('Late visitor'), creator_notes: 'Made for slow, cosy mysteries.' });
    const h = ctDetail(fx('ctavern/saltmarsh__captain_orla_vey.json'))!;
    expect(h.hidden).toBe(true);
    expect(h.card).toMatchObject({ name: 'Captain Orla Vey', description: '', first_mes: '', extensions: { definition_hidden: true } });
  });
  it('recognises its links', () => {
    expect(ctKeyFromLink('https://character-tavern.com/character/quillwright/wren_of_the_lantern_archive?x=1')).toBe('quillwright/wren_of_the_lantern_archive');
    expect(ctKeyFromLink('https://example.com/character/a/b')).toBeNull();
  });
});

describe('RisuRealm', () => {
  it('decodes the page data format', () => {
    const root = unflattenPageData(fx('risu/search.json'));
    expect(root.cards).toHaveLength(2);
    expect(root.cards[0].tags).toEqual(['Fantasy', 'Original', 'Slice-Of-Life']);
  });
  it('search and detail, with the lorebook and a hidden card left undownloaded', () => {
    const r = risuSearchResults(fx('risu/search.json'));
    expect(r.items[0]).toMatchObject({ key: '1f2e3d4c-0000-4000-8000-00000000a001', name: 'Sable the Clockmaker', creator: 'tickwright', stars: 1200, tagline: 'A clockmaker who repairs stopped moments.' });
    expect(r.items[0]!.avatarUrl).toMatch(/^https:\/\/sv\.risuai\.xyz\/resource\/a1b2/);
    expect(r.items[0]!.updatedAt).toBe(29416985 * 60_000);
    const d = risuDetail(fx('risu/meta-1f2e3d4c-0000-4000-8000-00000000a001.json'), fx('risu/card-1f2e3d4c-0000-4000-8000-00000000a001.json'))!;
    expect(d.card).toMatchObject({ name: 'Sable', first_mes: expect.stringContaining('stopped on purpose'), alternate_greetings: ['*The shop bell rings twice.*'] });
    expect((d.card as any).character_book.entries).toHaveLength(1);
    const h = risuDetail(fx('risu/meta-1f2e3d4c-0000-4000-8000-00000000a002.json'), null)!;
    expect(h).toMatchObject({ hidden: true, card: { name: 'Hidden Garden', creator_notes: 'The creator keeps this one private.', extensions: { definition_hidden: true } } });
    expect(risuKeyFromLink('https://realm.risuai.net/character/1f2e3d4c-0000-4000-8000-00000000a001')).toBe('1f2e3d4c-0000-4000-8000-00000000a001');
  });
});

describe('Pygmalion', () => {
  it('search, detail and links', () => {
    const r = pygSearchResults(fx('pygmalion/search.json'), 1);
    expect(r.items.map((i) => [i.name, i.nsfw])).toEqual([
      ['Juniper Hale', false],
      ['Nightlight', true],
    ]);
    expect(r.items[0]).toMatchObject({ creator: 'maplewood', stars: 3, tokens: 380, updatedAt: 1766728717000 });
    const d = pygDetail(fx('pygmalion/7a7a7a7a-1111-4222-8333-444455556666.json'))!;
    expect(d.card).toMatchObject({ name: 'Juniper', description: expect.stringContaining('Wend'), first_mes: expect.stringContaining('It moved again'), alternate_greetings: [expect.stringContaining('bakery')] });
    expect(pygKeyFromLink('https://pygmalion.chat/character/7a7a7a7a-1111-4222-8333-444455556666')).toBe('7a7a7a7a-1111-4222-8333-444455556666');
  });
});

describe('Wyvern', () => {
  it('search filters by rating; secret fields are never read', () => {
    const r = wyvSearchResults(fx('wyvern/search.json'));
    expect(r.items.map((i) => [i.name, i.nsfw])).toEqual([
      ['Bram the Beekeeper', false],
      ['The Masked Host', false],
      ['Afterdark', true],
    ]);
    const open = wyvDetail(fx('wyvern/_fixtureWyvernOpen01.json'))!;
    expect(open).toMatchObject({ hidden: false, creator: 'Brindle', card: { description: expect.stringContaining('hives'), first_mes: expect.stringContaining('She likes you') } });
    const secret = fx('wyvern/_fixtureWyvernSecret2.json');
    // Even if a secret field came back filled in, it is not used.
    secret.description = 'SHOULD NOT APPEAR';
    const s = wyvDetail(secret)!;
    expect(s.hidden).toBe(true);
    expect(JSON.stringify(s.card)).not.toContain('SHOULD NOT APPEAR');
    expect(s.card).toMatchObject({ first_mes: expect.stringContaining('Welcome back'), extensions: { definition_hidden: true } });
    expect(wyvKeyFromLink('https://app.wyvern.chat/characters/_fixtureWyvernOpen01')).toBe('_fixtureWyvernOpen01');
  });
});

describe('Chub hidden definitions', () => {
  it('import the public profile, labelled', () => {
    const d = chubDetail(fx('chub/secret-sister.json'))!;
    expect(d.hidden).toBe(true);
    expect(d.card).toMatchObject({ description: '', first_mes: '', extensions: { definition_hidden: true } });
    expect(d.card!.name).toBeTruthy();
  });
});
