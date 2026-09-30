import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chubDetail, chubDetailUrl, chubKeyFromLink, chubSearchResults, chubSearchUrl } from '../src/library/sources.js';

const fx = (f: string) => JSON.parse(readFileSync(path.resolve(__dirname, '../../../tests/fixtures/sources/chub', f), 'utf8'));

describe('Chub source mapping', () => {
  it('builds search and detail URLs', () => {
    const u = new URL(chubSearchUrl({ query: ' lighthouse ', page: 2, sort: 'updated', nsfw: false, tags: ['Mystery'] }));
    expect(u.origin + u.pathname).toBe('https://api.chub.ai/search');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ search: 'lighthouse', page: '2', sort: 'last_activity_at', nsfw: 'false', namespace: 'characters', topics: 'Mystery' });
    expect(chubDetailUrl('tide writer/maren')).toBe('https://api.chub.ai/api/characters/tide%20writer/maren?full=true');
  });

  it('reads links in any of the usual forms', () => {
    expect(chubKeyFromLink('Get it at https://chub.ai/characters/tidewriter/maren-holt?tab=gallery')).toBe('tidewriter/maren-holt');
    expect(chubKeyFromLink('https://www.characterhub.org/characters/a_b/c.d')).toBe('a_b/c.d');
    expect(chubKeyFromLink('https://venus.chub.ai/characters/x/y%20z')).toBe('x/y z');
    expect(chubKeyFromLink('https://example.com/characters/x/y')).toBeNull();
  });

  it('maps search results, flagging adult ones', () => {
    const r = chubSearchResults(fx('search.json'));
    expect(r.total).toBe(4);
    expect(r.items.map((i) => i.key)).toEqual(['tidewriter/maren-holt', 'tidewriter/captain-orr', 'nightowl/velvet-room', 'quietmaker/secret-sister']);
    expect(r.items[0]).toMatchObject({ provider: 'chub', name: 'Maren Holt', creator: 'tidewriter', nsfw: false, tokens: 1650, stars: 120, url: 'https://chub.ai/characters/tidewriter/maren-holt' });
    expect(r.items[2]!.nsfw).toBe(true);
    expect(chubSearchResults({}).items).toEqual([]);
  });

  it("maps Chub's field names onto the card spec, keeps the lorebook, and version-stamps it", () => {
    const d = chubDetail(fx('maren-holt.json'))!;
    expect(d.hidden).toBe(false);
    expect(d.card).toMatchObject({
      name: 'Maren Holt',
      description: expect.stringContaining('logs every ship'),
      personality: 'Dry, patient, secretly sentimental.',
      first_mes: expect.stringContaining('not on my list'),
      creator_notes: expect.stringContaining('slow-burn'),
      creator: 'tidewriter',
      tags: ['Mystery', 'Female', 'OC'],
      alternate_greetings: ['The lamp gutters as you climb the stairs.'],
    });
    expect((d.card as any).character_book.entries).toHaveLength(1);
    expect((d.card!.extensions as any).chub.full_path).toBe('tidewriter/maren-holt');
    expect(d.version).toBe('2026-05-01T10:00:00Z');
  });

  it('reports a hidden definition as hidden, with no card to import', () => {
    const d = chubDetail(fx('secret-sister.json'))!;
    expect(d.hidden).toBe(true);
    expect(d.card).toBeNull();
    expect(chubDetail({ node: { fullPath: 'a/b', name: 'B', definition: { name: 'B' } } })!.hidden).toBe(true); // empty definition
  });
});
