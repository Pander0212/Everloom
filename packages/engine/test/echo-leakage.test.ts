/**
 * Property-based leakage tests (§5.5, §12 epistemic 12). Random stories with secrets, partial
 * views, lies, rumors, private messages and swipes; for every actor, every string their view or
 * packet could carry must trace back to an event they actually perceived (at the level needed).
 * Target: zero leaks over every seed.
 */
import { describe, expect, it } from 'vitest';
import { echo } from '../src/index.js';
import { createRng } from '../src/util/rng.js';
import { ev, P, persp, viewText } from './echo-helpers.js';

const ACTORS = ['anna', 'ben', 'clara', 'daniel', 'eve', 'player'];

function randomStory(seed: number) {
  const rng = createRng(seed);
  const events: echo.EchoEvent[] = [];
  const n = rng.int(8, 30);
  for (let i = 1; i <= n; i++) {
    const actor = rng.pick(ACTORS);
    const others = ACTORS.filter((a) => a !== actor);
    const observers = others.filter(() => rng.chance(0.6)).map((a) => ({
      actor: a,
      place: rng.pick(['here', 'here', 'adjacent', 'remote'] as const),
      sight: rng.chance(0.7),
      hearing: rng.pick(['clear', 'muffled', 'none'] as const),
      awake: rng.chance(0.9),
      impairment: rng.chance(0.2) ? rng.next() : 0,
      attention: rng.next(),
      ...(rng.chance(0.15) ? { recognises: false } : {}),
    }));
    const kind = rng.pick(['action', 'speech', 'message', 'secret'] as const);
    const recipients = kind === 'action' ? [] : others.filter(() => rng.chance(0.3)).slice(0, 2);
    const cues: echo.Cue[] = rng.chance(0.6)
      ? [{ channel: rng.pick(['sight', 'sound', 'smell'] as const), detail: `[cue${i}] something happened`, salience: rng.next(), reveals: rng.pick(['presence', 'behavior', 'identity'] as const), props: rng.chance(0.5) ? [P(`obj${i}`, 'seen_at', `place${i}`)] : [] }]
      : [];
    const claimFrom = rng.chance(0.3) && events.length ? events[rng.int(0, events.length - 1)] : null;
    events.push(
      ev(
        {
          id: `e${i}`,
          type: kind === 'secret' ? 'action' : kind,
          actors: [actor],
          recipients,
          visibility: kind === 'secret' ? 'secret' : kind === 'action' ? (rng.chance(0.7) ? 'public' : 'private') : 'private',
          action: `[tok${i}] ${actor} did a thing`,
          quote: rng.chance(0.3) ? `[quote${i}]` : undefined,
          establishes: rng.chance(0.6) ? [P(`thing${i}`, 'state', `val${i}`)] : [],
          claims: kind === 'speech' || kind === 'message' ? [{ prop: claimFrom ? P(`thing${claimFrom.seq}`, 'state', `claimval${i}`) : P(`thing${i}`, 'rumor', `claimval${i}`), text: `[claim${i}]` }] : undefined,
          sincere: rng.chance(0.3) ? false : undefined,
          observers,
          cues,
          infers: rng.chance(0.2) ? [{ owner: actor, prop: P(actor, 'concludes', `refl${i}`), text: `[refl${i}]`, from: [] }] : undefined,
          messageId: `m${i}`,
          swipeId: 0,
        },
        i,
      ),
    );
    // Swipes: an alternate take of this message that will be abandoned.
    if (rng.chance(0.2)) events.push(ev({ id: `alt${i}`, actors: [actor], action: `[abandoned${i}] alternate take`, observers: ACTORS.map((a) => ({ actor: a, place: 'here' as const, sight: true, hearing: 'clear' as const, awake: true, impairment: 0, attention: 1 })), establishes: [P(`thing${i}`, 'state', `abandonedval${i}`)], messageId: `m${i}`, swipeId: 1 }, i + 0.5));
  }
  return events;
}

describe('ECHO leakage (property-based)', () => {
  it('no actor view or packet carries anything they did not perceive, over 300 random stories', () => {
    let checked = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const all = randomStory(seed);
      const path = new Map(all.filter((e) => e.swipeId === 0).map((e) => [e.messageId!, 0]));
      const live = echo.onBranch(all, path);
      const proj = echo.project(live);
      // Ground truth from the perception rules alone.
      const perceivedAt = new Map<string, Map<string, echo.Reveal>>();
      for (const e of live) for (const p of echo.perceive(e)) {
        const m = perceivedAt.get(p.actor) ?? new Map();
        m.set(e.id, p.level);
        perceivedAt.set(p.actor, m);
      }
      for (const actor of ACTORS) {
        const view = echo.authorize(proj, persp(actor));
        const packet = echo.compilePacket({ view, query: echo.understand('tok thing val claim cue refl quote abandoned', { entities: {} }, 1e6), scene: { now: 1e6, present: ACTORS, locationId: 'hall', sensory: ['something'] }, names: {}, recall: { maxResults: 50, tunneling: { enabled: true, rate: 1, seed: `s${seed}` } }, budget: 100000 });
        const text = `${viewText(view)} ${packet.text.toLowerCase()}`;
        const mine = perceivedAt.get(actor) ?? new Map();
        const tokens = [...text.matchAll(/\[(tok|quote|cue|claim|refl|abandoned)(\d+)\]/g)];
        for (const [, kind, num] of tokens) {
          const id = `e${num}`;
          if (kind === 'abandoned') throw new Error(`seed ${seed}: ${actor} sees an abandoned swipe`);
          if (kind === 'claim') {
            // A claim text reaches listeners at content level (or the speaker) only.
            expect(mine.get(id), `seed ${seed}: ${actor} has claim ${num}`).toBe('content');
          } else if (kind === 'cue') {
            expect(mine.has(id), `seed ${seed}: ${actor} has cue ${num}`).toBe(true);
          } else {
            // Full text, quotes and private conclusions: only at content level.
            expect(mine.get(id), `seed ${seed}: ${actor} has ${kind} ${num}`).toBe('content');
          }
        }
        // Canonical values: only those the actor perceived the establishing event of, at content level.
        for (const [, num] of text.matchAll(/\bval(\d+)\b/g)) expect(mine.get(`e${num}`), `seed ${seed}: ${actor} knows val${num}`).toBe('content');
        expect(text).not.toMatch(/abandonedval/);
        expect(text).not.toContain('sincere');
        checked++;
      }
    }
    expect(checked).toBe(300 * ACTORS.length);
  });
});
