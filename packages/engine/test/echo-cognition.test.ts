/** ECHO §8.3 belief-conditioned decisions, §10 consolidation, paired behavior tests. */
import { describe, expect, it } from 'vitest';
import { echo } from '../src/index.js';
import { ev, here, P, persp } from './echo-helpers.js';

const options: echo.ActionOption[] = [
  { id: 'sneak', label: 'sneak past the guard to the vault', goals: { loot: 1 }, traits: { bold: 1 }, risks: [{ prop: P('guard', 'state', 'awake'), harm: 2 }], benefit: 1, cost: 0.2 },
  { id: 'wait', label: 'wait until the shift changes', goals: { loot: 0.3 }, traits: { bold: -0.5 }, cost: 0.1 },
];
const profile: echo.DecisionProfile = { goals: { loot: 1 }, traits: { bold: 0.3 } };

describe('ECHO cognition', () => {
  it('risk comes from what the character believes, not from hidden truth (paired test)', () => {
    // Truth: the guard is awake. Anna was told (a lie) that he sleeps.
    const truth = ev({ visibility: 'secret', action: 'The guard is wide awake behind the door', establishes: [P('guard', 'state', 'awake')], observers: [] }, 1);
    const lie = ev({ type: 'speech', actors: ['ben'], recipients: ['anna'], action: 'Ben told Anna the guard is asleep', claims: [{ prop: P('guard', 'state', 'asleep'), text: 'the guard is asleep' }], sincere: false, observers: here('ben', 'anna') }, 2);
    const fooled = echo.decide(echo.authorize(echo.project([truth, lie]), persp('anna')), 'anna', options, profile);
    expect(fooled[0].option.id).toBe('sneak');
    expect(fooled[0].parts.risk).toBeGreaterThan(-0.2);
    // Change exactly one belief: Anna saw the guard awake herself → she waits.
    const saw = ev({ actors: ['anna'], action: 'Anna peeked and saw the guard awake', establishes: [P('guard', 'state', 'awake')], observers: here('anna') }, 3);
    const warned = echo.decide(echo.authorize(echo.project([truth, lie, saw]), persp('anna')), 'anna', options, profile);
    expect(warned[0].option.id).toBe('wait');
    expect(warned.find((p) => p.option.id === 'sneak')!.because.length).toBeGreaterThan(0);
    // Ben's knowledge of the truth (he lied) doesn't change Anna's choice: same as the first case.
    const benKnows = ev({ actors: ['ben'], action: 'Ben checked: the guard is awake', establishes: [P('guard', 'state', 'awake')], observers: here('ben') }, 1.5);
    expect(echo.decide(echo.authorize(echo.project([truth, benKnows, lie]), persp('anna')), 'anna', options, profile)[0].option.id).toBe('sneak');
  });

  it('relationships weigh in: hurting someone you are attached to costs utility', () => {
    const bond = ev({ actors: ['anna'], targets: ['ben'], action: 'Ben saved Anna from drowning', observers: here('anna', 'ben'), relations: [{ from: 'anna', to: 'ben', attachment: 0.8, trust: 0.3 }] }, 1);
    const v = echo.authorize(echo.project([bond]), persp('anna'));
    const r = echo.decide(v, 'anna', [{ id: 'betray', label: 'sell Ben out', benefit: 0.8, affects: [{ actor: 'ben', effect: -1 }] }, { id: 'cover', label: 'cover for Ben', benefit: 0.2, affects: [{ actor: 'ben', effect: 1 }] }], { goals: {}, traits: {} });
    expect(r[0].option.id).toBe('cover');
  });

  it('consolidation: repeated ordinary episodes collapse into one pattern line', () => {
    const dinners = Array.from({ length: 6 }, (_, i) => ev({ actors: ['player'], targets: ['anna'], locationId: 'inn', action: `Mara and Anna had dinner at the inn and talked about the harvest (${i})`, observers: here('player', 'anna') }, i + 1));
    const p = echo.project(dinners, { names: { anna: 'Anna', player: 'Mara' } });
    const v = echo.authorize(p, persp('player'));
    const pats = echo.patternsOf(v.units);
    expect(pats).toHaveLength(1);
    expect(pats[0].count).toBe(6);
    const pkt = echo.compilePacket({ view: v, query: echo.understand('dinner with Anna at the inn, the harvest talk', { entities: { anna: ['Anna'] } }, 1000), scene: { now: 1000, present: ['player'], locationId: 'square' }, names: { anna: 'Anna', player: 'Mara' } });
    const mem = pkt.lines.filter((l) => l.section === 'memories');
    expect(mem).toHaveLength(1);
    expect(mem[0].text).toContain('one of 6 similar times');
  });

  it('paired behavior: one changed memory changes the packet only where it should', () => {
    const base = [
      ev({ actors: ['player'], targets: ['daniel'], action: 'Mara and Daniel fixed the fishing nets together', observers: here('player', 'daniel') }, 1),
      ev({ actors: ['player'], targets: ['iris'], action: 'Iris sang at the harvest festival', observers: here('player', 'iris') }, 2),
    ];
    const betrayal = ev({ actors: ['daniel'], action: 'Daniel sold Mara out to the guard captain', observers: here('player', 'daniel'), relations: [{ from: 'player', to: 'daniel', trust: -0.5, resentment: 0.6 }] }, 3);
    const names = { daniel: 'Daniel', iris: 'Iris', player: 'Mara' };
    const pk = (events: echo.EchoEvent[], present: string[]) => echo.compilePacket({ view: echo.authorize(echo.project(events, { names }), persp('player')), query: echo.understand('Hello there.', { entities: {} }, 900), scene: { now: 900, present, locationId: 'harbor' }, names }).text;
    // With Daniel present, the betrayal changes behavior; with Iris present, nothing changes.
    expect(pk(base, ['player', 'daniel'])).not.toContain('guarded');
    expect(pk([...base, betrayal], ['player', 'daniel'])).toContain('guarded');
    expect(pk([...base, betrayal], ['player', 'iris'])).toBe(pk(base, ['player', 'iris']));
  });
});
