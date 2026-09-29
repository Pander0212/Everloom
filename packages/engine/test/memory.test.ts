import { describe, expect, it } from 'vitest';
import {
  currentFacts,
  dedupe,
  fallbackSummary,
  groupScenes,
  HeardIndex,
  knowledgeOf,
  openConflicts,
  PLAYER,
  recall,
  resolveFact,
  scoreMemory,
  specificity,
  spreadHearsay,
  storySoFar,
  type FactItem,
  type MemoryItem,
  type SummaryItem,
} from '../src/index.js';

let seq = 0;
function mem(p: Partial<MemoryItem> & { text: string }): MemoryItem {
  seq++;
  return { id: `m${seq}`, kind: 'beat', participants: [], witnesses: [PLAYER], locationId: 'tavern', gameTime: seq * 10, importance: 1, secret: false, pinned: false, seq, ...p };
}

describe('knowledge scoping', () => {
  it('participants are not witnesses', () => {
    const m = mem({ text: 'Kael stole the key from Bram', participants: ['kael', 'bram'], witnesses: [PLAYER, 'tobias'] });
    const heard = new HeardIndex();
    expect(knowledgeOf('tobias', m, heard)?.kind).toBe('witnessed');
    expect(knowledgeOf('bram', m, heard)).toBeNull(); // it's ABOUT Bram, but he wasn't there
    expect(knowledgeOf('kael', m, heard)).toBeNull();
  });

  it('hearsay spreads with distortion, dies past the limit, and never carries secrets', () => {
    const open = mem({ text: 'The bridge collapsed', witnesses: ['a'], importance: 2 });
    const secret = mem({ text: 'A hides the map under the floor', witnesses: ['a'], secret: true, importance: 3 });
    const heard = new HeardIndex();
    const t1 = spreadHearsay([['a', 'b']], [open, secret], heard, { maxDistortion: 2, perListener: 3 });
    expect(t1).toEqual([{ memoryId: open.id, viewer: 'b', distortion: 1, from: 'a' }]);
    t1.forEach((h) => heard.add(h));
    const t2 = spreadHearsay([['b', 'c']], [open, secret], heard, { maxDistortion: 2, perListener: 3 });
    expect(t2[0]).toMatchObject({ viewer: 'c', distortion: 2 });
    t2.forEach((h) => heard.add(h));
    const t3 = spreadHearsay([['c', 'd']], [open, secret], heard, { maxDistortion: 2, perListener: 3 });
    expect(t3).toEqual([]); // a third retelling would exceed the limit
    expect(knowledgeOf('b', secret, heard)).toBeNull();
    // Even a stray heard record (bad data, old import) never makes a secret known.
    heard.add({ memoryId: secret.id, viewer: 'z', distortion: 1 });
    expect(knowledgeOf('z', secret, heard)).toBeNull();
    // Deterministic: same inputs, same output.
    expect(spreadHearsay([['a', 'b']], [open, secret], new HeardIndex(), { maxDistortion: 2, perListener: 3 })).toEqual(t1);
  });
});

describe('versioned facts', () => {
  const base = (p: Partial<FactItem>): FactItem => ({ id: 'f1', entityId: 'mara', entityName: 'Mara', key: 'rank', value: 'squire', text: 'Mara is a squire', status: 'active', gameTime: 0, seq: 1, ...p });

  it('inserts, refreshes, supersedes on a shown change, and raises a conflict otherwise', () => {
    const existing = [base({})];
    expect(resolveFact([], { entityId: 'mara', entityName: 'Mara', key: 'rank', value: 'squire', text: '' }).action).toBe('insert');
    expect(resolveFact(existing, { entityId: 'mara', entityName: 'Mara', key: 'Rank', value: 'a Squire', text: '' }).action).toBe('refresh');
    expect(resolveFact(existing, { entityId: 'mara', entityName: 'Mara', key: 'rank', value: 'knight', text: 'Mara was knighted', changed: true })).toMatchObject({ action: 'supersede', target: { id: 'f1' } });
    expect(resolveFact(existing, { entityId: 'mara', entityName: 'Mara', key: 'rank', value: 'knight', text: 'Mara is a knight' })).toMatchObject({ action: 'conflict' });
    expect(resolveFact(existing, { entityId: 'tobias', entityName: 'Tobias', key: 'rank', value: 'knight', text: '' }).action).toBe('insert');
  });

  it('only the newest active value is current; conflicts are listed', () => {
    const all = [base({ status: 'superseded' }), base({ id: 'f2', value: 'knight', text: 'Mara is a knight', seq: 2 }), base({ id: 'f3', value: 'baroness', status: 'conflict', conflictsWith: 'f2', seq: 3 })];
    expect(currentFacts(all).map((f) => f.value)).toEqual(['knight']);
    expect(openConflicts(all)).toHaveLength(1);
    expect(openConflicts(all)[0].against?.id).toBe('f2');
  });
});

describe('recall', () => {
  it('a small memory about the people here beats a crowd scene', () => {
    const present = new Set([PLAYER, 'jirou']);
    expect(specificity(['jirou'], present)).toBeGreaterThan(specificity(['jirou', 'a', 'b', 'c', 'd', 'e', 'f', 'g'], present));
    expect(specificity(['x'], present)).toBe(0);
  });

  it('scopes each person to what they know, guarantees one memory each, and lists what they do not know', () => {
    seq = 0;
    const theft = mem({ text: 'Kael stole the brass key from the innkeeper', participants: ['kael', 'bram'], witnesses: [PLAYER, 'tobias'], importance: 2 });
    const song = mem({ text: 'Tobias and the player sang at the inn', participants: ['tobias'], witnesses: [PLAYER, 'tobias', 'bram'] });
    const bramOnly = mem({ text: 'Bram counted the coins alone', participants: ['bram'], witnesses: ['bram'] });
    const lexical = new Map([[theft.id, 1]]);
    const r = recall([theft, song, bramOnly], new HeardIndex(), { now: 1000, present: [PLAYER, 'tobias', 'bram'], locationId: 'tavern', lexical }, { unknownLimit: 2 });
    expect(r.player.map((x) => x.m.id)).toContain(theft.id);
    expect(r.player.map((x) => x.m.id)).not.toContain(bramOnly.id); // the player wasn't there
    const bram = r.people.find((p) => p.id === 'bram')!;
    const tobias = r.people.find((p) => p.id === 'tobias')!;
    expect(bram.knows.map((x) => x.m.id)).not.toContain(theft.id);
    expect(bram.doesNotKnow.map((x) => x.m.id)).toContain(theft.id);
    expect(tobias.knows.map((x) => x.m.id)).toContain(theft.id);
    expect(bram.knows.length + bram.heard.length).toBeGreaterThan(0);
    // Breakdown explains the score.
    const s = scoreMemory(theft, { now: 1000, present: [PLAYER, 'tobias', 'bram'], locationId: 'tavern', lexical });
    expect(s.total).toBeCloseTo(s.lexical + s.semantic + s.entities + s.place + s.named + s.importance + s.recency + s.pinned, 2);
  });

  it('collapses near-duplicates', () => {
    const a = mem({ text: 'Mara drew her sword at the city gate' });
    const b = mem({ text: 'At the city gate Mara drew her sword' });
    const c = mem({ text: 'Tobias bought bread' });
    const list = [a, b, c].map((m, i) => ({ m, k: { kind: 'witnessed' as const, distortion: 0 }, score: { total: 10 - i } as any }));
    expect(dedupe(list).map((x) => x.m.id)).toEqual([a.id, c.id]);
  });
});

describe('summaries', () => {
  it('groups scenes by place and time gap', () => {
    const b = [mem({ text: '1', locationId: 'a', gameTime: 0 }), mem({ text: '2', locationId: 'a', gameTime: 30 }), mem({ text: '3', locationId: 'b', gameTime: 40 }), mem({ text: '4', locationId: 'b', gameTime: 400 })];
    expect(groupScenes(b).map((g) => g.beats.length)).toEqual([2, 1, 1]);
  });

  it('never drops a milestone from the story so far', () => {
    const milestone = mem({ text: 'MILESTONE: Mara swore the oath', importance: 3 });
    const days: SummaryItem[] = Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, level: 'day', title: '', text: `Day ${i} ${'x'.repeat(200)}`, fromTime: i * 1440, toTime: i * 1440 + 100, covers: [], importance: 1, seq: i }));
    const out = storySoFar(days, [milestone], 800);
    expect(out.join('\n')).toContain('MILESTONE');
    expect(out.join('').length).toBeLessThanOrEqual(1200);
    expect(fallbackSummary([{ text: 'ordinary', importance: 1 }, { text: 'big moment', importance: 3 }])).toMatch(/^big moment\./);
  });
});
