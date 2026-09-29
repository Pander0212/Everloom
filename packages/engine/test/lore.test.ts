import { describe, expect, it } from 'vitest';
import { checkWorldInfo, createRng, newEntry, normalizeBook, WILogic, WIPosition, worldFromSillyTavern, type ScanEntry } from '../src/index.js';
import { fixture } from './helpers.js';

const E = (uid: number, p: Partial<ScanEntry>): ScanEntry => ({ ...newEntry(uid), world: 'w', ...p }) as ScanEntry;
const scan = (entries: ScanEntry[], msgs: string[], extra: any = {}) =>
  checkWorldInfo({ entries, messagesNewestFirst: msgs, chatLength: msgs.length, maxContext: 8000, rng: createRng(1), ...extra });

describe('world info activation', () => {
  it('activates on primary keys, case-insensitive by default', () => {
    const r = scan([E(1, { key: ['Dragon'], content: 'Dragons are rare.' })], ['I saw a dragon!']);
    expect(r.before).toBe('Dragons are rare.');
  });

  it('supports regex keys', () => {
    const r = scan([E(1, { key: ['/drag(on|oons)/i'], content: 'R' })], ['DRAGOONS attack']);
    expect(r.activated).toHaveLength(1);
  });

  it('respects scan depth', () => {
    const entries = [E(1, { key: ['castle'], content: 'C' })];
    expect(scan(entries, ['hello', 'hi', 'the castle'], { settings: { scanDepth: 2 } }).activated).toHaveLength(0);
    expect(scan(entries, ['hello', 'hi', 'the castle'], { settings: { scanDepth: 3 } }).activated).toHaveLength(1);
    expect(scan([E(1, { key: ['castle'], content: 'C', scanDepth: 3 })], ['hello', 'hi', 'the castle'], { settings: { scanDepth: 1 } }).activated).toHaveLength(1);
  });

  it('implements secondary key logic', () => {
    const mk = (logic: WILogic) => [E(1, { key: ['king'], keysecondary: ['crown', 'throne'], selectiveLogic: logic, content: 'K' })];
    expect(scan(mk(WILogic.AND_ANY), ['the king and his crown']).activated).toHaveLength(1);
    expect(scan(mk(WILogic.AND_ANY), ['the king']).activated).toHaveLength(0);
    expect(scan(mk(WILogic.AND_ALL), ['the king and his crown']).activated).toHaveLength(0);
    expect(scan(mk(WILogic.AND_ALL), ['the king, crown and throne']).activated).toHaveLength(1);
    expect(scan(mk(WILogic.NOT_ANY), ['the king']).activated).toHaveLength(1);
    expect(scan(mk(WILogic.NOT_ANY), ['the king crown']).activated).toHaveLength(0);
    expect(scan(mk(WILogic.NOT_ALL), ['the king crown']).activated).toHaveLength(1);
    expect(scan(mk(WILogic.NOT_ALL), ['the king crown throne']).activated).toHaveLength(0);
  });

  it('activates constants and skips disabled', () => {
    const r = scan([E(1, { constant: true, content: 'always' }), E(2, { constant: true, disable: true, content: 'never' })], ['x']);
    expect(r.activated.map((a) => a.uid)).toEqual([1]);
  });

  it('recurses through activated content, honoring exclude/prevent recursion', () => {
    const entries = [E(1, { key: ['sword'], content: 'The sword was forged by Aldric.' }), E(2, { key: ['Aldric'], content: 'Aldric is a smith.' })];
    expect(scan(entries, ['a sword']).activated).toHaveLength(2);
    expect(scan(entries, ['a sword'], { settings: { recursive: false } }).activated).toHaveLength(1);
    const prevent = [E(1, { key: ['sword'], content: 'Aldric', preventRecursion: true }), E(2, { key: ['Aldric'], content: 'A' })];
    expect(scan(prevent, ['a sword']).activated).toHaveLength(1);
    const exclude = [E(1, { key: ['sword'], content: 'Aldric' }), E(2, { key: ['Aldric'], content: 'A', excludeRecursion: true })];
    expect(scan(exclude, ['a sword']).activated).toHaveLength(1);
  });

  it('orders by insertion order and splits positions', () => {
    const r = scan(
      [
        E(1, { key: ['a'], content: 'low', order: 10 }),
        E(2, { key: ['a'], content: 'high', order: 200 }),
        E(3, { key: ['a'], content: 'after', position: WIPosition.after }),
        E(4, { key: ['a'], content: 'deep', position: WIPosition.atDepth, depth: 2 }),
      ],
      ['a'],
    );
    expect(r.before).toBe('low\nhigh');
    expect(r.after).toBe('after');
    expect(r.depth).toEqual([{ depth: 2, role: 0, entries: ['deep'] }]);
  });

  it('enforces the token budget (higher order wins)', () => {
    const big = 'x'.repeat(400);
    const r = scan(
      [E(1, { key: ['a'], content: big, order: 1 }), E(2, { key: ['a'], content: big, order: 100 })],
      ['a'],
      { maxContext: 1000, settings: { budgetPercent: 15 }, countTokens: (t: string) => Math.ceil(t.length / 4) },
    );
    expect(r.activated.map((e) => e.uid)).toEqual([2]);
    expect(r.overflowed).toBe(true);
  });

  it('rolls probability deterministically with a seeded rng', () => {
    const entries = [E(1, { key: ['a'], content: 'maybe', probability: 50, useProbability: true })];
    const results = Array.from({ length: 40 }, (_, i) => checkWorldInfo({ entries, messagesNewestFirst: ['a'], chatLength: 1, maxContext: 8000, rng: createRng(i) }).activated.length);
    expect(results.some((x) => x === 1)).toBe(true);
    expect(results.some((x) => x === 0)).toBe(true);
  });

  it('handles sticky and cooldown timed effects', () => {
    const entries = [E(1, { key: ['bell'], content: 'Bell', sticky: 2, cooldown: 2 })];
    const r1 = checkWorldInfo({ entries, messagesNewestFirst: ['bell'], chatLength: 1, maxContext: 8000 });
    expect(r1.activated).toHaveLength(1);
    // Sticky keeps it on without the keyword.
    const r2 = checkWorldInfo({ entries, messagesNewestFirst: ['nothing'], chatLength: 2, maxContext: 8000, timed: r1.timed });
    expect(r2.activated).toHaveLength(1);
    // After sticky ends, cooldown blocks re-activation.
    const r3 = checkWorldInfo({ entries, messagesNewestFirst: ['bell'], chatLength: 4, maxContext: 8000, timed: r2.timed });
    expect(r3.activated).toHaveLength(0);
    const r4 = checkWorldInfo({ entries, messagesNewestFirst: ['bell'], chatLength: 6, maxContext: 8000, timed: r3.timed });
    expect(r4.activated).toHaveLength(1);
  });

  it('delay blocks early activation', () => {
    const entries = [E(1, { key: ['a'], content: 'x', delay: 5 })];
    expect(checkWorldInfo({ entries, messagesNewestFirst: ['a'], chatLength: 2, maxContext: 8000 }).activated).toHaveLength(0);
    expect(checkWorldInfo({ entries, messagesNewestFirst: ['a'], chatLength: 5, maxContext: 8000 }).activated).toHaveLength(1);
  });

  it('only one entry per inclusion group', () => {
    const r = scan([E(1, { key: ['a'], content: '1', group: 'g' }), E(2, { key: ['a'], content: '2', group: 'g', groupOverride: true, order: 5 })], ['a']);
    expect(r.activated.map((e) => e.uid)).toEqual([2]);
  });

  it('matches whole words when asked', () => {
    const entries = [E(1, { key: ['cat'], content: 'C', matchWholeWords: true })];
    expect(scan(entries, ['concatenate']).activated).toHaveLength(0);
    expect(scan(entries, ['the cat sat']).activated).toHaveLength(1);
  });

  it('imports the SillyTavern Eldoria world file', () => {
    const raw = JSON.parse(new TextDecoder().decode(fixture('st/Eldoria.json')));
    const book = worldFromSillyTavern(raw, 'Eldoria');
    expect(Object.keys(book.entries)).toHaveLength(4);
    const entries = Object.values(book.entries).map((e) => ({ ...e, world: 'Eldoria' }));
    const r = checkWorldInfo({ entries, messagesNewestFirst: ['Tell me about the forest'], chatLength: 1, maxContext: 16000, substitute: (s) => s.replace(/\{\{char\}\}/g, 'Seraphina') });
    expect(r.activated.length).toBeGreaterThan(0);
  });

  it('normalizes loose entries', () => {
    const b = normalizeBook({ entries: [{ keys: 'a, b', content: 'x', enabled: false }] });
    expect(b.entries['0'].key).toEqual(['a', 'b']);
    expect(b.entries['0'].disable).toBe(true);
  });
});
