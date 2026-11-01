/** ECHO §12 epistemic tests 1–17, deterministic, on the engine alone. */
import { describe, expect, it } from 'vitest';
import { echo } from '../src/index.js';
import { ev, here, P, persp, viewText } from './echo-helpers.js';

const { project, authorize } = echo;
const names = { anna: 'Anna', ben: 'Ben', clara: 'Clara', daniel: 'Daniel', eve: 'Eve', player: 'Mara' };

describe('ECHO epistemics', () => {
  it('1. hidden object: the motion is seen, the identity is not', () => {
    const p = project([
      ev({
        actors: ['anna'],
        action: 'Anna hid the letter from Clara inside the desk drawer',
        establishes: [P('letter', 'location', 'drawer')],
        observers: here('anna', 'ben'),
        cues: [{ channel: 'sight', detail: 'Anna slid something small into the desk drawer', salience: 0.7, reveals: 'behavior', props: [P('anna', 'hid_something_in', 'drawer')] }],
      }),
    ], { names });
    const ben = authorize(p, persp('ben'));
    expect(viewText(ben)).not.toContain('letter');
    expect(ben.beliefs.map((b) => b.prop)).toContainEqual(P('anna', 'hid_something_in', 'drawer'));
    expect(ben.unknowns.join(' ')).toContain('not what exactly');
    const anna = authorize(p, persp('anna'));
    expect(anna.beliefs.map((b) => b.prop)).toContainEqual(P('letter', 'location', 'drawer'));
  });

  it('2. overheard through an open door, not through a soundproof one', () => {
    const talk = (hearing: echo.Hearing) =>
      project([
        ev({
          type: 'speech',
          actors: ['anna'],
          recipients: ['clara'],
          visibility: 'private',
          action: 'Anna told Clara the vault code is 7-4-1',
          claims: [{ prop: P('vault', 'code', '741'), text: 'the vault code is 7-4-1' }],
          observers: [...here('anna', 'clara'), { actor: 'ben', place: 'adjacent', sight: false, hearing, awake: true, impairment: 0, attention: 1 }],
          cues: [{ channel: 'sound', detail: 'Anna telling Clara the vault code is 7-4-1', salience: 0.9, reveals: 'content' }],
        }),
      ]);
    const open = authorize(talk('muffled'), persp('ben'));
    expect(open.beliefs.map((b) => b.prop)).toContainEqual(P('vault', 'code', '741'));
    expect(open.beliefs[0].status).toBe('told');
    const shut = authorize(talk('none'), persp('ben'));
    expect(viewText(shut)).not.toContain('741');
    expect(shut.units).toHaveLength(0);
  });

  it('3. a convincing lie produces a false belief the believer cannot see is false', () => {
    const p = project([
      ev({ type: 'speech', actors: ['anna'], recipients: ['clara'], visibility: 'secret', action: 'Anna met Clara in the locked office', establishes: [P('anna', 'office_visit', 'meeting clara')], observers: here('anna', 'clara') }),
      ev({ type: 'speech', actors: ['anna'], recipients: ['ben'], action: 'Anna told Ben she had only been fetching documents', claims: [{ prop: P('anna', 'office_visit', 'fetching documents'), text: 'she was fetching documents' }], sincere: false, observers: here('anna', 'ben') }),
    ], { names });
    const ben = authorize(p, persp('ben'));
    const b = ben.beliefs.find((x) => x.prop.o === 'fetching documents')!;
    expect(b.status).toBe('told');
    expect(b.truth).toBeUndefined();
    expect(viewText(ben)).not.toContain('meeting clara');
    expect(viewText(ben)).not.toContain('sincere');
    const omni = authorize(p, persp('narrator', { accessScope: 'omniscient' }));
    expect(omni.beliefs.find((x) => x.prop.o === 'fetching documents' && x.id.includes(':ben:'))!.truth).toBe('false');
  });

  it('4. a four-person rumor chain keeps its provenance and never becomes the fact', () => {
    const claim = { prop: P('anna', 'suspects', 'clara stole the ring'), text: 'Anna suspects Clara stole the ring' };
    const p = project([
      ev({ type: 'speech', actors: ['anna'], recipients: ['ben'], visibility: 'private', action: 'Anna confided her suspicion to Ben', claims: [claim], observers: here('anna', 'ben') }),
      ev({ type: 'speech', actors: ['ben'], recipients: ['daniel'], visibility: 'private', action: 'Ben passed it on to Daniel', claims: [claim], observers: here('ben', 'daniel') }),
      ev({ type: 'speech', actors: ['daniel'], recipients: ['eve'], visibility: 'private', action: 'Daniel whispered it to Eve', claims: [claim], observers: here('daniel', 'eve') }),
    ], { names });
    const d = authorize(p, persp('daniel')).beliefs.find((b) => b.prop.p === 'suspects')!;
    expect(d.status).toBe('rumored');
    expect(d.via).toEqual(['ben', 'anna']);
    expect(d.text).toContain('Ben said');
    const e = authorize(p, persp('eve')).beliefs;
    expect(e.find((b) => b.prop.p === 'suspects')!.via).toEqual(['daniel', 'ben', 'anna']);
    // Nobody believes Clara stole the ring.
    for (const who of ['ben', 'daniel', 'eve']) expect(authorize(p, persp(who)).beliefs.some((b) => b.prop.s === 'clara')).toBe(false);
  });

  it('5. "Anna believes Ben knows" does not make Ben know', () => {
    const p = project([
      ev({ actors: ['anna'], action: 'Anna noticed the broken seal', establishes: [P('seal', 'state', 'broken')], observers: here('anna'), meta: [{ owner: 'anna', chain: [{ about: 'ben', kind: 'knows' }], prop: P('seal', 'state', 'broken') }] }),
    ]);
    const anna = authorize(p, persp('anna'));
    expect(anna.higher.some((h) => h.chain[0].about === 'ben' && h.prop.o === 'broken')).toBe(true);
    const ben = authorize(p, persp('ben'));
    expect(ben.beliefs).toHaveLength(0);
    expect(viewText(ben)).not.toContain('seal');
  });

  it('6. a private message reaches its recipient and a justified interceptor only', () => {
    const p = project([
      ev({ type: 'message', actors: ['anna'], recipients: ['ben'], interceptors: ['daniel'], visibility: 'private', action: 'Anna texted Ben: meet me at the pier at midnight', claims: [{ prop: P('anna', 'meeting_place', 'pier'), text: 'meet at the pier at midnight' }], observers: here('anna', 'clara') }),
    ]);
    expect(viewText(authorize(p, persp('ben')))).toContain('pier');
    expect(viewText(authorize(p, persp('daniel')))).toContain('pier');
    expect(viewText(authorize(p, persp('clara')))).not.toContain('pier');
  });

  it('7. delayed discovery: historical queries stay correct', () => {
    const p = project([
      ev({ actors: ['clara'], visibility: 'secret', action: 'Clara slipped the ring into her bag', establishes: [P('ring', 'location', 'clara bag')], observers: here('clara') }, 1),
      ev({ action: 'Morning passes quietly', observers: here('ben') }, 2),
      ev({ actors: ['ben'], action: 'Ben found the ring in Clara\'s bag', establishes: [P('ring', 'location', 'clara bag')], observers: here('ben') }, 5),
    ]);
    const at3 = authorize(p, persp('ben', { atSeq: 3 }));
    expect(at3.beliefs.some((b) => b.prop.s === 'ring')).toBe(false);
    expect(viewText(at3)).not.toContain('ring');
    const now = authorize(p, persp('ben'));
    expect(now.beliefs.some((b) => b.prop.s === 'ring' && b.status === 'experienced')).toBe(true);
    // By world time: before the discovery (t=50) nothing; after, the belief.
    expect(echo.beliefsAbout(p, 'ben', 'ring', { leaf: 'leaf', storyId: 'story', atTime: 30 })).toHaveLength(0);
    expect(echo.beliefsAbout(p, 'ben', 'ring', { leaf: 'leaf', storyId: 'story', atTime: 60 })).toHaveLength(1);
  });

  it('8. revision keeps the original belief as history', () => {
    const p = project([
      ev({ type: 'speech', actors: ['anna'], recipients: ['ben'], action: 'Anna said the ring was in the drawer', claims: [{ prop: P('ring', 'location', 'drawer'), text: 'the ring is in the drawer' }], observers: here('anna', 'ben') }, 1),
      ev({ actors: ['ben'], action: 'Ben saw the ring in Clara\'s bag', establishes: [P('ring', 'location', 'clara bag')], observers: here('ben') }, 2),
    ]);
    const before = authorize(p, persp('ben', { atSeq: 1 })).beliefs.filter((b) => b.prop.s === 'ring');
    expect(before.map((b) => b.prop.o)).toEqual(['drawer']);
    const after = authorize(p, persp('ben')).beliefs.filter((b) => b.prop.s === 'ring');
    expect(after.map((b) => b.prop.o)).toEqual(['clara bag']);
    const old = [...p.beliefs.values()].find((b) => b.prop.o === 'drawer')!;
    expect(old.status).toBe('out');
    expect(old.until).toBe(2);
    expect(old.outReason).toContain('revised');
  });

  it('9. an object moving over time has a correct history', () => {
    const p = project([
      ev({ action: 'The ring lay in the drawer', establishes: [P('ring', 'location', 'drawer')] }, 1),
      ev({ action: 'Clara took the ring', establishes: [P('ring', 'location', 'clara bag')] }, 3),
      ev({ action: 'Ben pocketed the ring', establishes: [P('ring', 'location', 'ben pocket')] }, 6),
    ]);
    expect(p.factAt('ring', 'location', 2).map((f) => f.o)).toEqual(['drawer']);
    expect(p.factAt('ring', 'location', 4).map((f) => f.o)).toEqual(['clara bag']);
    expect(p.factAt('ring', 'location').map((f) => f.o)).toEqual(['ben pocket']);
    expect(p.factAtTime('ring', 'location', 45).map((f) => f.o)).toEqual(['clara bag']);
    expect(p.facts).toHaveLength(3);
  });

  it('10. an attention failure: present but absorbed sees nothing', () => {
    const e = ev({ actors: ['clara'], action: 'Clara pocketed the key', establishes: [P('key', 'location', 'clara pocket')], cues: [{ channel: 'sight', detail: 'Clara pocketed something', salience: 0.6, reveals: 'behavior' }], observers: [...here('clara'), { actor: 'ben', place: 'here', sight: true, hearing: 'clear', awake: true, impairment: 0, attention: 0.2 }] });
    expect(authorize(project([e]), persp('ben')).units).toHaveLength(0);
    const alert = { ...e, observers: here('clara', 'ben') };
    expect(authorize(project([alert]), persp('ben')).units).toHaveLength(1);
  });

  it('11. a swipe or rewind imports nothing from the abandoned branch', () => {
    const base = ev({ action: 'Ben waits in the hall', observers: here('ben'), messageId: 'm1' }, 1);
    const swipe0 = ev({ id: 'secret0', actors: ['anna'], recipients: ['ben'], type: 'speech', action: 'Anna confessed to Ben she poisoned the duke', claims: [{ prop: P('anna', 'poisoned', 'duke'), text: 'she poisoned the duke' }], observers: here('anna', 'ben'), messageId: 'm2', swipeId: 0 }, 2);
    const swipe1 = ev({ id: 'other1', actors: ['anna'], action: 'Anna talked about the weather', observers: here('anna', 'ben'), messageId: 'm2', swipeId: 1 }, 2.001);
    const all = [base, swipe0, swipe1];
    const leaf1 = new Map([['m1', 0], ['m2', 1]]);
    const p = Object.assign(project(echo.onBranch(all, leaf1)), { leaf: echo.leafKey(leaf1), storyId: 'story' });
    const v = authorize(p, persp('ben', { leaf: echo.leafKey(leaf1) }));
    expect(viewText(v)).not.toContain('poison');
    expect(viewText(v)).toContain('weather');
    // A projection cached for the other leaf is refused.
    const leaf0 = new Map([['m1', 0], ['m2', 0]]);
    expect(() => authorize(p, persp('ben', { leaf: echo.leafKey(leaf0) }))).toThrow(echo.AccessError);
    // Rewind: message m2 deleted.
    expect(viewText(authorize(project(echo.onBranch(all, new Map([['m1', 0]]))), persp('ben')))).not.toContain('poison');
  });

  it('12. no leakage through summaries, vectors, reflections or the packet', () => {
    const p = project([
      ev({ actors: ['anna'], visibility: 'secret', action: 'Anna buried the dagger under the old oak', establishes: [P('dagger', 'location', 'old oak')], observers: here('anna', 'ben'), infers: [{ owner: 'anna', prop: P('anna', 'feels', 'guilty'), text: 'Anna feels guilty', from: [P('dagger', 'location', 'old oak')], reflection: true }] }),
      ev({ actors: ['ben'], action: 'Ben walked past the old oak', observers: here('ben') }),
    ], { names });
    const ben = authorize(p, persp('ben'));
    const annaUnit = p.units.find((u) => u.owner === 'anna')!.id;
    // A semantic score for an unauthorized id (as if a vector index were shared) is ignored.
    const packet = echo.compilePacket({ view: ben, query: echo.understand('the dagger by the old oak', { entities: {} }, 100), scene: { now: 100, present: ['ben'], locationId: 'hall' }, names, signals: { semantic: new Map([[annaUnit, 0.99]]) } });
    expect(packet.text.toLowerCase()).not.toContain('dagger');
    expect(packet.text.toLowerCase()).not.toContain('guilty');
    expect(viewText(ben)).not.toContain('guilty');
  });

  it('13. the narrator respects the persona\'s knowledge', () => {
    const p = project([ev({ actors: ['anna'], recipients: ['clara'], visibility: 'secret', type: 'speech', action: 'Anna told Clara the heir is alive', establishes: [P('heir', 'status', 'alive')], observers: here('anna', 'clara', 'player') })]);
    const narr = authorize(p, persp('player', { accessScope: 'persona-narrator' }));
    expect(viewText(narr)).not.toContain('heir');
    const issues = echo.validateTurn(p, [ev({ actors: ['narrator'], action: 'Mara somehow knows the heir lives', establishes: [P('heir', 'status', 'alive')] })], { narration: 'persona', liveEventIds: new Set(p.order) });
    expect(issues.map((i) => i.kind)).toContain('perspective-leak');
  });

  it('14. intent vs outcome: an attempt is not a success', () => {
    const p = project([
      ev({ actors: ['ben'], action: 'Ben tried to pick the lock', attempted: true, outcome: 'failure', establishes: [P('door', 'state', 'open')] }),
      ev({ actors: ['ben'], action: 'Ben tried to force the window', attempted: true, outcome: 'unknown', establishes: [P('window', 'state', 'open')] }),
    ]);
    expect(p.factAt('door', 'state')).toHaveLength(0);
    expect(p.factAt('window', 'state')).toHaveLength(0);
    expect(p.violations.map((v) => v.kind)).toEqual(['attempt-as-success']);
  });

  it('15. legacy migration grants nothing universally', () => {
    const row = { id: 'mi1', text: 'The duke was poisoned at dinner', participants: ['duke'], witnesses: [] as string[], locationId: 'hall', gameTime: 10, importance: 2, secret: false, seq: 1, messageId: null, swipeId: null };
    const p = project([echo.eventFromLegacy(row, 'story')]);
    for (const who of ['player', 'duke', 'anna']) expect(authorize(p, persp(who)).units).toHaveLength(0);
    const p2 = project([echo.eventFromLegacy({ ...row, witnesses: ['anna'] }, 'story')]);
    expect(authorize(p2, persp('anna')).units).toHaveLength(1);
    expect(authorize(p2, persp('duke')).units).toHaveLength(0);
  });

  it('16. lazy canon: a collapse respects its clues, and a swipe can re-roll it', () => {
    const open = ev({ action: 'An iron box sits on the table', undetermined: [{ s: 'box', p: 'contains', label: 'what is in the iron box', candidates: ['gold coins', 'a letter', 'a dagger', 'a map'] }] }, 1);
    const clue = ev({ action: 'The box rattles softly, like paper and something light', constrains: [{ s: 'box', p: 'contains', constraint: { kind: 'not', values: ['a dagger', 'gold coins'], why: 'it rattled softly' } }] }, 2);
    const bad = ev({ actors: ['ben'], action: 'Ben opened the box: a dagger', establishes: [P('box', 'contains', 'a dagger')] }, 3);
    const p1 = project([open, clue, bad]);
    expect(p1.violations.map((v) => v.kind)).toContain('collapse-constraint');
    expect(p1.factAt('box', 'contains')).toHaveLength(0);
    expect(p1.possible('box|contains')).toEqual(['a letter', 'a map']);
    const good = ev({ actors: ['ben'], action: 'Ben opened the box: a letter', establishes: [P('box', 'contains', 'a letter')] }, 3);
    const p2 = project([open, clue, good]);
    expect(p2.factAt('box', 'contains').map((f) => f.o)).toEqual(['a letter']);
    expect(p2.undetermined.get('box|contains')!.status).toBe('collapsed');
    // Seeded suggestions differ across swipes, but always fit the clues.
    const picks = new Set<string>();
    for (let s = 0; s < 12; s++) {
      const pkt = echo.compilePacket({
        view: authorize(project([open, clue]), persp('player', { accessScope: 'persona-narrator' })),
        query: echo.understand('I open the box', { entities: {} }, 30),
        scene: { now: 30, present: [], locationId: 'hall' },
        names: {},
        adjudication: { slots: [...project([open, clue]).undetermined.values()], possible: (k) => project([open, clue]).possible(k), seed: `m3:${s}` },
      });
      const m = pkt.text.match(/it is: (.+)\./);
      if (m) picks.add(m[1]);
    }
    expect([...picks].sort()).toEqual(['a letter', 'a map']);
    // The author can pre-decide a twist; the story must then match it.
    const pre = project([open, clue, good], {}, [{ id: 'op1', kind: 'predecide', s: 'box', p: 'contains', value: 'a map' }]);
    expect(pre.violations.map((v) => v.kind)).toContain('predecided-mismatch');
    // An NPC's packet never carries the undecided detail.
    const npc = echo.buildNpcContext('ben', { proj: project([open, clue]), storyId: 'story', leaf: 'leaf', query: echo.understand('open the box', { entities: {} }, 30), scene: { now: 30, present: [], locationId: 'hall' }, names: {}, adjudication: { slots: [...project([open, clue]).undetermined.values()], possible: () => ['a map'], seed: 'x' } });
    expect(npc.text).not.toContain('a map');
  });

  it('17. an exposed lie retracts the beliefs that depend on it (truth maintenance)', () => {
    const p = project([
      ev({ type: 'speech', actors: ['anna'], recipients: ['ben'], action: 'Anna told Ben she had been fetching documents', claims: [{ prop: P('anna', 'office_visit', 'fetching documents'), text: 'she was fetching documents' }], sincere: false, observers: here('anna', 'ben'), infers: [{ owner: 'ben', prop: P('anna', 'is', 'honest with ben'), text: 'Anna is straight with him', from: [P('anna', 'office_visit', 'fetching documents')] }], hypotheses: [{ owner: 'ben', question: 'why Anna was in the office', options: [{ label: 'fetching documents', prop: P('anna', 'office_visit', 'fetching documents'), weight: 0.5 }, { label: 'meeting someone', prop: P('anna', 'office_visit', 'meeting clara'), weight: 0.3, sinister: true }] }] }, 1),
      ev({ actors: ['ben'], action: 'Ben saw Anna and Clara leave the office together', observers: here('ben'), cues: [{ channel: 'sight', detail: 'Anna and Clara leaving the office together', salience: 0.9, reveals: 'identity', props: [P('anna', 'office_visit', 'meeting clara')] }] }, 2),
    ], { names });
    const ben = authorize(p, persp('ben'));
    expect(ben.beliefs.map((b) => b.prop.o)).not.toContain('fetching documents');
    expect(ben.beliefs.map((b) => b.prop.o)).not.toContain('honest with ben');
    const inferred = [...p.beliefs.values()].find((b) => b.prop.o === 'honest with ben')!;
    expect(inferred.status).toBe('out');
    expect(inferred.outReason).toContain('learned otherwise');
    expect(p.trust('ben', 'anna')).toBeLessThan(0.6);
    const h = ben.hypotheses[0];
    const meeting = h.options.find((o) => o.label === 'meeting someone')!;
    expect(meeting.amplitude).toBeGreaterThan(0.85);
    expect(h.status).toBe('resolved');
    // Still not canon: no fact was written by the suspicion.
    expect(p.factAt('anna', 'office_visit')).toHaveLength(0);
  });

  it('superposition: a paranoid character weights the sinister explanation higher', () => {
    const seed = { owner: 'ben', question: 'why Anna left the locked office', options: [{ label: 'fetching documents', prop: P('anna', 'office_visit', 'documents'), weight: 0.5 }, { label: 'meeting someone', prop: P('anna', 'office_visit', 'meeting'), weight: 0.3 }, { label: 'hiding something', prop: P('anna', 'office_visit', 'hiding'), weight: 0.2, sinister: true }] };
    const e = ev({ actors: ['anna'], action: 'Anna left the locked office', observers: here('anna', 'ben'), hypotheses: [seed] });
    const calm = project([e]).hypotheses.get('hyp:ben:why anna left the locked office')!;
    const para = project([e], { traits: { ben: { paranoia: 1 } } }).hypotheses.get('hyp:ben:why anna left the locked office')!;
    const hid = (h: echo.HypothesisSet) => h.options.find((o) => o.sinister)!.amplitude;
    expect(hid(calm)).toBeCloseTo(0.2, 2);
    expect(hid(para)).toBeGreaterThan(0.4);
  });

  it('broken promises move trust for those who learn of it', () => {
    const p = project([
      ev({ type: 'promise', actors: ['anna'], recipients: ['player'], action: 'Anna promised to meet the player at the lake at dusk', commitment: { id: 'c1', by: 'anna', to: ['player'], what: 'meet at the lake at dusk' }, observers: here('anna', 'player') }, 1),
      ev({ type: 'promise.update', actors: ['anna'], action: 'Anna never came to the lake', commitmentUpdate: { id: 'c1', status: 'broken' }, observers: here('anna', 'player') }, 2),
    ]);
    expect(p.trust('player', 'anna')).toBeCloseTo(0.3, 5);
    expect(p.relation('player', 'anna').resentment).toBeGreaterThan(0.3);
    expect(authorize(p, persp('anna')).higher.some((h) => h.prop.p === 'broke_promise_to')).toBe(true);
  });
});
