import { describe, expect, it } from 'vitest';
import {
  chronicleBatch,
  effectiveWatermark,
  ensureMilestones,
  novel,
  parseChronicle,
  parseConsolidate,
  planChapter,
  planDays,
  planScenes,
  PLAYER,
  storySoFar,
  type MemoryItem,
  type SummaryItem,
} from '../src/index.js';

let seq = 0;
function mem(p: Partial<MemoryItem> & { text: string }): MemoryItem {
  seq++;
  return { id: `m${seq}`, kind: 'beat', participants: [], witnesses: [PLAYER], locationId: 'tavern', gameTime: seq * 10, importance: 1, secret: false, pinned: false, seq, ...p };
}
function sum(p: Partial<SummaryItem> & { id: string; text: string }): SummaryItem {
  seq++;
  return { level: 'day', title: '', fromTime: seq, toTime: seq, covers: [], importance: 1, seq, ...p };
}

describe('chronicler watermark', () => {
  it('only counts runs whose last message still shows the same swipe', () => {
    const runs = [
      { fromSeq: 1, toSeq: 10, messageId: 'a', swipeId: 0, at: 1 },
      { fromSeq: 11, toSeq: 20, messageId: 'b', swipeId: 1, at: 2 },
    ];
    expect(effectiveWatermark(runs, () => true)).toBe(20);
    // The last message it read was swiped: reading resumes after the earlier run.
    expect(effectiveWatermark(runs, (id, sw) => id === 'a' || sw === 0)).toBe(10);
    expect(effectiveWatermark(runs, () => false)).toBe(0);
  });

  it('never re-reads, leaves the newest messages alone, and waits for enough to read', () => {
    const msgs = Array.from({ length: 20 }, (_, i) => ({ seq: i + 1, name: 'x', text: `line ${i + 1}` }));
    const b = chronicleBatch(msgs, 10)!;
    expect(b[0].seq).toBe(11);
    expect(b[b.length - 1].seq).toBe(16); // the newest four stay in the prompt verbatim
    expect(chronicleBatch(msgs, 14)).toBeNull(); // two unread: not worth a call yet
    expect(chronicleBatch(msgs, 14, { force: true, keepRecent: 0 })!.map((m) => m.seq)).toEqual([15, 16, 17, 18, 19, 20]);
    expect(chronicleBatch(msgs, 20, { force: true, keepRecent: 0 })).toBeNull();
  });

  it('parses tolerant output and drops lines already remembered', () => {
    const out = parseChronicle('Here:\n```json\n{"memories":[{"text":"Tobias asked Anala to sing for the Ravens","about":"Tobias","importance":2},"Iris broke a glass at the bar"],"facts":[{"about":"Tobias","key":"job","value":"band leader"}],"summary":"They talked."}\n```');
    expect(out!.memories.map((m) => m.text)).toEqual(['Tobias asked Anala to sing for the Ravens', 'Iris broke a glass at the bar']);
    expect(out!.facts[0].value).toBe('band leader');
    expect(parseChronicle('no json here')).toBeNull();
    const fresh = novel(out!.memories, ['Tobias asked Anala to sing for the Ravens on Friday.']);
    expect(fresh.map((m) => m.text)).toEqual(['Iris broke a glass at the bar']);
  });
});

describe('consolidation plans', () => {
  it('folds a finished scene only among beats the same people saw', () => {
    const shared = [PLAYER, 'iris'];
    const beats = [
      mem({ text: 'Iris poured tea', witnesses: shared, gameTime: 0 }),
      mem({ text: 'Tobias arrived late', witnesses: shared, gameTime: 10 }),
      mem({ text: 'Iris whispered a secret to Anala', witnesses: [PLAYER, 'iris'], secret: true, gameTime: 20 }),
      mem({ text: 'They sang together', witnesses: shared, gameTime: 30, importance: 3 }),
      // Still going on at the market: not cold.
      mem({ text: 'At the market now', locationId: 'market', witnesses: shared, gameTime: 400 }),
    ];
    const plans = planScenes(beats, 'market', 410);
    expect(plans).toHaveLength(1);
    expect(plans[0].beats.map((b) => b.text)).toEqual(['Iris poured tea', 'Tobias arrived late', 'They sang together']);
    expect(plans[0].witnesses).toEqual(shared);
    expect(plans[0].importance).toBe(3);
    // The secret stays its own memory; the scene in progress is left alone.
    expect(planScenes(beats.slice(0, 4), 'tavern', 40)).toEqual([]);
  });

  it('plans finished days not yet summarized, and chapters once summaries pile up', () => {
    const d0 = [mem({ text: 'a', gameTime: 100 }), mem({ text: 'b', gameTime: 200 })];
    const d1 = [mem({ text: 'c', gameTime: 1500 }), mem({ text: 'd', gameTime: 1600 })];
    const today = mem({ text: 'e', gameTime: 3000 });
    const plans = planDays([...d0, ...d1, today], 2, new Set());
    expect(plans.map((p) => p.day)).toEqual([0, 1]);
    expect(planDays([...d0, ...d1], 2, new Set(d0.map((m) => m.id))).map((p) => p.day)).toEqual([1]);
    const sums = Array.from({ length: 6 }, (_, i) => sum({ id: `s${i}`, text: `day ${i}` }));
    expect(planChapter(sums.slice(0, 5))).toBeNull();
    expect(planChapter(sums)!.map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3']);
    const withChapter = [...sums, sum({ id: 'c', level: 'chapter', text: 'x', covers: ['s0', 's1', 's2', 's3'] })];
    expect(planChapter(withChapter)).toBeNull();
  });

  it('milestones survive summary prose that drops them', () => {
    const t = ensureMilestones('They had a quiet evening', ['Bram died defending the gate', 'Anala had a quiet evening']);
    expect(t).toContain('Bram died defending the gate.');
    expect(t.match(/quiet evening/g)).toHaveLength(1);
  });

  it('reads consolidation prose by group id', () => {
    const m = parseConsolidate('{"summaries":{"s0":{"title":"Tea","text":"Iris poured tea for Anala."},"d0":"too"}}');
    expect(m.get('s0')!.title).toBe('Tea');
    expect(m.has('d0')).toBe(false);
  });

  it('the story so far shows chapters, loose summaries and uncovered milestones', () => {
    const milestone = mem({ text: 'Bram died defending the gate', importance: 3 });
    const covered = mem({ text: 'Anala swore an oath', importance: 3 });
    const s = [
      sum({ id: 'x1', level: 'scene', text: 'Messages 1-20: they met.' }),
      sum({ id: 'x2', level: 'scene', text: 'Messages 21-40: the oath.', covers: [covered.id] }),
    ];
    const lines = storySoFar(s, [milestone, covered]);
    expect(lines).toEqual(['Messages 1-20: they met.', 'Messages 21-40: the oath.', 'Bram died defending the gate']);
    const ch = sum({ id: 'c', level: 'chapter', text: 'Chapter one.', covers: ['x1', 'x2'], fromTime: 0 });
    expect(storySoFar([...s, ch], [milestone, covered])).toEqual(['Chapter one.', 'Bram died defending the gate']);
  });
});
