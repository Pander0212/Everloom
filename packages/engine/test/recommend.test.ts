import { describe, expect, it } from 'vitest';
import { buildRecommendPrompt, parseRecommend, sampleForRecommend, type RecommendItem } from '../src/library/recommend.js';

const now = Date.UTC(2026, 8, 30);
const item = (i: number, p: Partial<RecommendItem> = {}): RecommendItem => ({ id: `c${i}`, name: `Char ${i}`, tags: [], description: `Plain character ${i}.`, fav: false, chatCount: 1, lastChatAt: now - 86400_000, ...p });

describe('recommender', () => {
  const lib = [
    ...Array.from({ length: 200 }, (_, i) => item(i)),
    item(900, { tags: ['horror'], description: 'A ghost in the lighthouse.' }),
    item(901, { fav: true }),
    item(902, { chatCount: 0, lastChatAt: null }),
    item(903, { lastChatAt: now - 90 * 86400_000 }),
  ];

  it('samples a bounded, seed-stable mix that puts mood matches in', () => {
    const a = sampleForRecommend(lib, { mood: 'something with a ghost', size: 30, seed: 7, now });
    expect(a).toHaveLength(30);
    expect(a.map((x) => x.id)).toEqual(sampleForRecommend(lib, { mood: 'something with a ghost', size: 30, seed: 7, now }).map((x) => x.id));
    expect(a.map((x) => x.id)).toContain('c900');
    // Favorites, forgotten and never-played ones are always represented.
    for (const id of ['c901', 'c902', 'c903']) expect(a.map((x) => x.id)).toContain(id);
    expect(sampleForRecommend(lib, { size: 30, seed: 7, exclude: ['c901'], now }).map((x) => x.id)).not.toContain('c901');
    expect(sampleForRecommend(lib.slice(0, 5), { size: 30 })).toHaveLength(5);
  });

  it('numbers the sample for the model and maps picks back, ignoring made-up or repeated numbers', () => {
    const sample = lib.slice(200);
    const [, user] = buildRecommendPrompt('spooky', sample, now);
    expect(user!.content).toContain('#1 Char 900 [horror] (last played 1d ago): A ghost in the lighthouse.');
    expect(user!.content).toContain('#2 Char 901 ★');
    expect(user!.content).toContain('(never played)');
    expect(user!.content).toContain('last played 3mo ago');
    const picks = parseRecommend('{"picks":[{"n":42,"why":"x"},{"n":"#1","why":"Ghosts."},{"n":1,"why":"again"},{"n":3,"why":"New."}]}', sample);
    expect(picks).toEqual([{ id: 'c900', why: 'Ghosts.' }, { id: 'c902', why: 'New.' }]);
    expect(() => parseRecommend('{"picks":[{"n":42}]}', sample)).toThrow(/not in your library/);
    expect(() => parseRecommend('no idea', sample)).toThrow(/picks/);
  });
});
