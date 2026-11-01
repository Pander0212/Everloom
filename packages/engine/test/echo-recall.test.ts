/** ECHO §12 recall tests 1–12 on a 600-event synthetic story (engine only, no embeddings). */
import { describe, expect, it } from 'vitest';
import { echo } from '../src/index.js';
import { generateStory, nameIndex } from '../../../tests/echo-bench/synth.js';
import { ev, here, P, persp } from './echo-helpers.js';

const story = generateStory(600);
const proj = echo.project(story.events, { names: story.names });
const view = echo.authorize(proj, persp('player', { storyId: 'story' }));
const idx = nameIndex(story.names);
const run = (id: string) => {
  const q = story.queries.find((x) => x.id === id)!;
  const r = echo.recallMemories(view, echo.understand(q.text, idx, q.scene.now), q.scene, {}, {}, { maxResults: 5 });
  return { q, r, events: r.hits.map((h) => h.unit.eventId) };
};

describe('ECHO recall', () => {
  it.each(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q9', 'q13'])('%s finds its target in the top 3', (id) => {
    const { q, events } = run(id);
    expect(events.slice(0, 3), `${q.kind}: ${q.text}`).toContain(q.expect[0]);
  });

  it('1. exact recall from far back: the target is #1', () => {
    expect(run('q1').events[0]).toBe('t_compass');
  });

  it('9. exact dialogue on request: the packet carries the quote', () => {
    const q = story.queries.find((x) => x.id === 'q9')!;
    const pkt = echo.compilePacket({ view, query: echo.understand(q.text, idx, q.scene.now), scene: q.scene, names: story.names });
    expect(pkt.text).toContain('Under the third stone from the door');
  });

  it('10/11. missing evidence and unrelated scenes recall nothing (packet empty)', () => {
    for (const id of ['q10', 'q11']) {
      const { q, r } = run(id);
      expect(r.hits, q.text).toHaveLength(0);
      const pkt = echo.compilePacket({ view, query: echo.understand(q.text, idx, q.scene.now), scene: q.scene, names: story.names });
      expect(pkt.text).toBe('');
      expect(pkt.tokens).toBe(0);
    }
  });

  it('interference: winter cue picks the winter lake, summer cue the summer lake', () => {
    expect(run('q12a').events[0]).toBe('t_lake_winter');
    expect(run('q12b').events[0]).toBe('t_lake_summer');
    const damp = run('q12a').r.hits.find((h) => h.unit.eventId === 't_lake_summer');
    if (damp) expect(damp.dampened).toBeTruthy();
  });

  it('recency never dominates: a relevant memory from 500 events ago beats an unrelated recent one', () => {
    const { r } = run('q2');
    expect(r.hits[0].unit.eventId).toBe('t_mill');
    expect(r.hits[0].unit.seq).toBeLessThan(100);
  });

  it('8. contradictory beliefs stay separate lines', () => {
    const p = echo.project([
      ev({ type: 'speech', actors: ['anna'], recipients: ['player'], action: 'Anna said Ben was at the docks', claims: [{ prop: P('ben', 'whereabouts', 'docks'), text: 'Ben was at the docks' }], observers: here('anna', 'player') }, 1),
      ev({ type: 'speech', actors: ['clara'], recipients: ['player'], action: 'Clara said Ben was at the chapel', claims: [{ prop: P('ben', 'whereabouts', 'chapel'), text: 'Ben was at the chapel' }], observers: here('clara', 'player') }, 2),
    ], { names: story.names });
    const v = echo.authorize(p, persp('player'));
    expect(v.beliefs.every((b) => b.contested)).toBe(true);
    const pkt = echo.compilePacket({ view: v, query: echo.understand('Where was Ben?', idx, 100), scene: { now: 100, present: ['player'], locationId: 'x' }, names: story.names });
    const lines = pkt.text.split('\n').filter((l) => l.includes('Ben was at') && l.includes('told by'));
    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).toContain('told by Anna');
    expect(lines.join(' ')).toContain('told by Clara');
    expect(lines.join(' ')).toContain('contested');
  });

  it('12. involuntary recall is rare and reproducible per message and swipe', () => {
    const q = story.queries.find((x) => x.id === 'q13')!;
    const qu = echo.understand('I wait by the window.', idx, q.scene.now);
    let fired = 0;
    for (let s = 0; s < 1000; s++) {
      const r = echo.recallMemories(view, qu, { ...q.scene, now: q.scene.now + 200 * 1440 }, {}, {}, { tunneling: { enabled: true, rate: 0.03, seed: `m${s}:0` } });
      const inv = r.hits.filter((h) => h.involuntary);
      expect(inv.length).toBeLessThanOrEqual(1);
      if (inv.length) fired++;
    }
    expect(fired).toBeGreaterThan(5);
    expect(fired).toBeLessThan(60);
    const a = echo.recallMemories(view, qu, { ...q.scene, now: q.scene.now + 200 * 1440 }, {}, {}, { tunneling: { enabled: true, rate: 0.5, seed: 'm9:1' } });
    const b = echo.recallMemories(view, qu, { ...q.scene, now: q.scene.now + 200 * 1440 }, {}, {}, { tunneling: { enabled: true, rate: 0.5, seed: 'm9:1' } });
    expect(a.hits.map((h) => h.unit.id)).toEqual(b.hits.map((h) => h.unit.id));
  });

  it('decoherence fades accessibility but never storage; recall strengthens it', () => {
    const u = { importance: 1 as const, emotion: 0, occurredAt: 0 };
    const fresh = echo.accessibility(u, 1440);
    const old = echo.accessibility(u, 60 * 1440);
    expect(old).toBeLessThan(fresh);
    expect(old).toBeGreaterThan(0);
    expect(echo.accessibility(u, 60 * 1440, { count: 3, lastTime: 50 * 1440 })).toBeGreaterThan(old);
    expect(echo.accessibility({ ...u, importance: 3 }, 60 * 1440)).toBeGreaterThan(old);
  });

  it('predictive activation: meeting someone surfaces unresolved business, not every memory of them', () => {
    const p = echo.project([
      ...Array.from({ length: 30 }, (_, i) => ev({ actors: ['player'], targets: ['daniel'], action: `Mara and Daniel shared lunch number ${i}`, observers: here('player', 'daniel') }, i + 1)),
      ev({ id: 'betrayal', actors: ['daniel'], action: 'Daniel sold Mara out to the guard captain', observers: here('player', 'daniel'), relations: [{ from: 'player', to: 'daniel', trust: -0.5, resentment: 0.6 }], importance: 2 }, 40),
    ], { names: story.names });
    const v = echo.authorize(p, persp('player'));
    const r = echo.recallMemories(v, echo.understand('Hello.', idx, 5000), { now: 5000, present: ['player', 'daniel'], locationId: 'square' });
    expect(r.hits.map((h) => h.unit.eventId)).toEqual(['betrayal']);
    const pkt = echo.compilePacket({ view: v, query: echo.understand('Hello.', idx, 5000), scene: { now: 5000, present: ['player', 'daniel'], locationId: 'square' }, names: story.names });
    expect(pkt.text).toContain('guarded');
    // Rotation: the same affordance is suppressed next time.
    const next = echo.compilePacket({ view: v, query: echo.understand('Hello.', idx, 5000), scene: { now: 5000, present: ['player', 'daniel'], locationId: 'square' }, names: story.names, recentAffordances: pkt.affordances });
    expect(next.affordances.some((a) => pkt.affordances.includes(a))).toBe(false);
  });

  it('the packet stays small however long the story is', () => {
    for (const id of ['q1', 'q5', 'q7']) {
      const q = story.queries.find((x) => x.id === id)!;
      const pkt = echo.compilePacket({ view, query: echo.understand(q.text, idx, q.scene.now), scene: q.scene, names: story.names });
      expect(pkt.tokens).toBeGreaterThan(0);
      expect(pkt.tokens).toBeLessThan(1000);
    }
  });
});
