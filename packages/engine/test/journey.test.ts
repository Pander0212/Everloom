import { describe, expect, it } from 'vitest';
import {
  applyOp,
  applyOps,
  buildSceneBlock,
  checkRequirement,
  createInitialState,
  invertOps,
  nextDeparture,
  OpSchemas,
  planTrip,
  recentPlaces,
  travelOptions,
  validateOps,
  type CampaignState,
  type Op,
  type OpType,
} from '../src/index.js';

const DAY = 1440;
const ALL = Object.keys(OpSchemas) as OpType[];
const v = (op: unknown): Op => {
  const r = validateOps([op], ALL);
  if (!r.ok.length) throw new Error(`invalid op: ${r.rejected[0]?.error}`);
  return r.ok[0]!;
};
const ok = (s: CampaignState, op: unknown) => {
  const r = applyOp(s, v(op), { source: 'user' });
  if (r.error) throw new Error(r.error);
  return r.state;
};
const err = (s: CampaignState, op: unknown) => applyOp(s, v(op), { source: 'user' }).error;
const here = (s: CampaignState) => s.locations[s.currentLocationId!]!.name;

/** A modern city at 07:00 with a three-stop train line and a guarded palace. */
function city(): CampaignState {
  let s = createInitialState({ style: 'modern', seed: 9 });
  s.player.currency = 100;
  const ops: unknown[] = [
    { type: 'location.upsert', name: 'Greenmarch', level: 'region', kind: 'region' },
    { type: 'location.upsert', name: 'Northcrest', level: 'local', kind: 'station', parent: 'Greenmarch', x: 100, y: 100 },
    { type: 'location.upsert', name: 'Eastport', level: 'local', kind: 'station', parent: 'Greenmarch', x: 400, y: 100 },
    { type: 'location.upsert', name: 'Gull Bay', level: 'local', kind: 'station', parent: 'Greenmarch', x: 700, y: 100 },
    { type: 'location.move', to: 'Northcrest' },
    { type: 'time.until', hour: 7 },
    { type: 'transit.add', name: 'Coast Line', mode: 'train', stops: ['Northcrest', 'Eastport', 'Gull Bay'], first: '06:00', last: '22:00', every: 60, hop: 40, fare: 3, farePerStop: 1 },
  ];
  const r = applyOps(s, ops.map(v), { source: 'user' });
  expect(r.errors).toEqual([]);
  s = r.state;
  return s;
}

describe('transit', () => {
  it('timetable: next departure, both directions, and the fare by stops', () => {
    const s = city();
    const line = Object.values(s.transit)[0]!;
    const t0 = s.time.minutes; // 07:00
    // Forward from the first stop leaves on the hour.
    expect(nextDeparture(s, line, 0, 2, t0)! - t0).toBe(0);
    // From the middle stop going forward: 40 minutes after each first-stop departure.
    expect(nextDeparture(s, line, 1, 2, t0)! - t0).toBe(40);
    // From the middle stop going back: 40 minutes after each departure from the far end.
    expect(nextDeparture(s, line, 1, 0, t0)! - t0).toBe(40);
    const trip = planTrip(s, line, s.currentLocationId!, Object.values(s.locations).find((l) => l.name === 'Gull Bay')!.id)!;
    expect(trip).toMatchObject({ stops: 2, ride: 80, wait: 0, fare: 4 });
  });

  it('after the last departure the next one is tomorrow morning', () => {
    let s = city();
    s = ok(s, { type: 'time.until', hour: 23 });
    const line = Object.values(s.transit)[0]!;
    const next = nextDeparture(s, line, 0, 1, s.time.minutes)!;
    expect(next - s.time.minutes).toBe(7 * 60);
  });

  it('riding pays the fare, waits for the departure and arrives on time', () => {
    let s = city();
    s = ok(s, { type: 'time.advance', minutes: 10 }); // 07:10, next at 08:00
    const t0 = s.time.minutes;
    s = ok(s, { type: 'transit.ride', line: 'Coast Line', to: 'Eastport' });
    expect(here(s)).toBe('Eastport');
    expect(s.time.minutes - t0).toBe(50 + 40);
    expect(s.player.currency).toBe(97);
    expect(s.travelLog.at(-1)).toMatchObject({ mode: 'train', cost: 3 });
    expect(s.arrival?.locationId).toBe(s.currentLocationId);
  });

  it('a ticket is used instead of paying, and bought only at a stop', () => {
    let s = city();
    s = ok(s, { type: 'transit.ticket', line: 'Coast Line', qty: 2 });
    expect(s.player.currency).toBe(92); // two tickets at the longest ride: 3 + 1
    s = ok(s, { type: 'transit.ride', line: 'Coast Line', to: 'Gull Bay' });
    expect(s.player.currency).toBe(92);
    expect(Object.values(s.inventory).find((i) => i.name === 'Ticket: Coast Line')?.qty).toBe(1);
    s = ok(s, { type: 'location.upsert', name: 'Farm', level: 'local', kind: 'village', parent: 'Greenmarch' });
    s = ok(s, { type: 'location.move', to: 'Farm' });
    expect(err(s, { type: 'transit.ticket', line: 'Coast Line' })).toMatch(/at one of its stops/);
    expect(err(s, { type: 'transit.ride', line: 'Coast Line', to: 'Eastport' })).toMatch(/not at a Coast Line stop/);
  });

  it('not enough money explains the gap and suggests the bank', () => {
    let s = city();
    s.player.currency = 1;
    s = ok(s, { type: 'bank.open', name: 'Checking' });
    s.economy.accounts[Object.keys(s.economy.accounts)[0]!]!.balance = 50;
    expect(err(s, { type: 'transit.ride', line: 'Coast Line', to: 'Gull Bay' })).toMatch(/Costs \$4; you have \$1\. Withdraw \$3 from Checking/);
  });

  it('removing a stop shortens the line; a line under two stops is gone', () => {
    let s = city();
    s = ok(s, { type: 'location.remove', name: 'Eastport' });
    expect(Object.values(s.transit)[0]!.stops).toHaveLength(2);
    s = ok(s, { type: 'location.remove', name: 'Gull Bay' });
    expect(Object.values(s.transit)).toHaveLength(0);
  });
});

describe('requirements', () => {
  it('each kind blocks with a reason and a fix, and passes when met', () => {
    let s = city();
    s = ok(s, { type: 'org.upsert', name: 'Royal Guard', orgType: 'military' });
    s = ok(s, { type: 'quest.add', title: 'The Missing Seal', objectives: ['Find it'] });
    const chk = (req: any) => checkRequirement(s, req);
    expect(chk({ kind: 'standing', org: 'Royal Guard', min: 70 })).toMatchObject({ ok: false, fix: 'Help Royal Guard to raise your standing by 20.' });
    expect(chk({ kind: 'quest', title: 'The Missing Seal', state: 'done' })).toMatchObject({ ok: false, fix: 'Finish "The Missing Seal".' });
    expect(chk({ kind: 'quest', title: 'The Missing Seal', state: 'active' }).ok).toBe(true);
    expect(chk({ kind: 'item', name: 'Palace Pass' })).toMatchObject({ ok: false, reason: 'Needs Palace Pass' });
    expect(chk({ kind: 'vehicle', mode: 'car' }).ok).toBe(false);
    expect(chk({ kind: 'reputation', min: 10 }).ok).toBe(false);
    expect(chk({ kind: 'notWanted', max: 0 }).ok).toBe(true);
    expect(chk({ kind: 'partySize', max: 1 }).ok).toBe(true);
    expect(chk({ kind: 'weather', not: ['storm'] }).ok).toBe(true);
    // 07:00, open 08:00–18:00 → wait an hour.
    expect(chk({ kind: 'hours', open: 480, close: 1080 })).toMatchObject({ ok: false, wait: 60, fix: 'Wait until 8:00 AM.' });
    s = ok(s, { type: 'item.add', name: 'Palace Pass' });
    s = ok(s, { type: 'asset.add', name: 'Hatchback', kind: 'vehicle', modes: ['car'] });
    s.player.wanted = 2;
    s.weather.kind = 'storm';
    expect(checkRequirement(s, { kind: 'item', name: 'Palace Pass' }).ok).toBe(true);
    expect(checkRequirement(s, { kind: 'vehicle', mode: 'car' }).ok).toBe(true);
    expect(checkRequirement(s, { kind: 'notWanted', max: 0 }).ok).toBe(false);
    expect(checkRequirement(s, { kind: 'weather', not: ['storm'] }).ok).toBe(false);
  });

  it('route requirements block travel by code until met', () => {
    let s = city();
    s = ok(s, { type: 'location.upsert', name: 'Palace', level: 'local', kind: 'landmark', parent: 'Greenmarch', x: 120, y: 120 });
    s = ok(s, { type: 'route.require', from: 'Northcrest', to: 'Palace', requires: [{ kind: 'hours', open: '08:00', close: '18:00' }, { kind: 'item', name: 'Palace Pass' }] });
    expect(err(s, { type: 'travel', to: 'Palace', mode: 'walk' })).toBe('Closed until 8:00 AM. Wait until 8:00 AM.');
    s = ok(s, { type: 'time.until', hour: 9 });
    expect(err(s, { type: 'travel', to: 'Palace', mode: 'walk' })).toMatch(/Needs Palace Pass/);
    s = ok(s, { type: 'item.add', name: 'Palace Pass' });
    s = ok(s, { type: 'travel', to: 'Palace', mode: 'walk' });
    expect(here(s)).toBe('Palace');
  });

  it('a party larger than the transit allows must leave people in reserve', () => {
    let s = city();
    s = ok(s, { type: 'transit.add', name: 'Cable Car', mode: 'bus', stops: ['Northcrest', 'Eastport'], requires: [{ kind: 'partySize', max: 2 }] });
    for (const n of ['Iris', 'Tobias']) s = ok(s, { type: 'party.add', name: n });
    expect(err(s, { type: 'transit.ride', line: 'Cable Car', to: 'Eastport' })).toMatch(/Room for 2; your group is 3\. Move 1 companion to the reserve/);
  });
});

describe('history and arrival', () => {
  it('recent places come from the travel log, newest first, without the current place', () => {
    let s = city();
    s = ok(s, { type: 'transit.ride', line: 'Coast Line', to: 'Eastport' });
    s = ok(s, { type: 'transit.ride', line: 'Coast Line', to: 'Gull Bay' });
    expect(recentPlaces(s).map((l) => l.name)).toEqual(['Eastport', 'Northcrest']);
    expect(s.travelLog).toHaveLength(2);
  });

  it('arrival notes who is there and flags checkpoints when wanted; the same on replay', () => {
    let s = city();
    s = ok(s, { type: 'npc.upsert', name: 'Mara Quill', location: 'Gull Bay' });
    s.player.wanted = 5;
    const a = ok(s, { type: 'transit.ride', line: 'Coast Line', to: 'Gull Bay' });
    const b = ok(s, { type: 'transit.ride', line: 'Coast Line', to: 'Gull Bay' });
    expect(a.arrival!.notes).toContain('Here: Mara Quill');
    expect(a.arrival!.notes.some((n) => n.startsWith('Checkpoint:'))).toBe(true);
    expect(b.arrival).toEqual(a.arrival);
    const scene = buildSceneBlock(a).text;
    expect(scene).toContain('JUST ARRIVED (by train): Here: Mara Quill');
    expect(scene).toContain('TRANSIT: Coast Line (train) to Northcrest, Eastport');
  });

  it('long overland trips sometimes meet something on the way (seeded)', () => {
    let hits = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let s = createInitialState({ style: 'fantasy', seed });
      const r = applyOps(
        s,
        ([
          { type: 'location.upsert', name: 'Vale', level: 'region', kind: 'region' },
          { type: 'location.upsert', name: 'Ashford', level: 'local', kind: 'town', parent: 'Vale', x: 0, y: 0 },
          { type: 'location.upsert', name: 'Deepwood', level: 'local', kind: 'wilds', parent: 'Vale', x: 1000, y: 1000 },
          { type: 'location.move', to: 'Ashford' },
        ] as unknown[]).map(v),
        { source: 'user' },
      );
      s = r.state;
      s.trackers = {};
      s = ok(s, { type: 'travel', to: 'Deepwood', mode: 'walk' });
      if (s.arrival!.notes.some((n) => n.startsWith('On the way:'))) hits++;
    }
    expect(hits).toBeGreaterThan(3);
    expect(hits).toBeLessThan(25);
  });

  it('travel options include the genre modes', () => {
    const f = createInitialState({ style: 'fantasy' });
    const m = createInitialState({ style: 'modern' });
    const modes = (s: CampaignState) => travelOptions({ ...s, locations: {} } as CampaignState, null, 'x').map((o) => o.mode);
    expect(modes(f)).toEqual(expect.arrayContaining(['walk', 'horse', 'caravan', 'airship']));
    expect(modes(m)).toEqual(expect.arrayContaining(['walk', 'bus', 'subway', 'car', 'motorcycle', 'boat']));
    expect(modes(f)).toContain('boat');
    expect(modes(f)).not.toContain('motorcycle');
  });

  it('events on the way can be turned off; who is there is still noted', () => {
    let s = city();
    s = ok(s, { type: 'npc.upsert', name: 'Mara Quill', location: 'Gull Bay' });
    s.player.wanted = 5;
    s = ok(s, { type: 'meta.update', arrivalEvents: false });
    const a = ok(s, { type: 'transit.ride', line: 'Coast Line', to: 'Gull Bay' });
    expect(a.arrival!.notes).toContain('Here: Mara Quill');
    expect(a.arrival!.notes.some((n) => n.startsWith('Checkpoint:'))).toBe(false);
    const on = ok(ok(s, { type: 'meta.update', arrivalEvents: true }), { type: 'transit.ride', line: 'Coast Line', to: 'Gull Bay' });
    expect(on.arrival!.notes.some((n) => n.startsWith('Checkpoint:'))).toBe(true);
  });
});

describe('rollback', () => {
  it('every travel op is undone exactly by its inverse', () => {
    const s0 = city();
    const ops: unknown[] = [
      { type: 'transit.ticket', line: 'Coast Line' },
      { type: 'transit.ride', line: 'Coast Line', to: 'Gull Bay' },
      { type: 'transit.add', name: 'Harbour Bus', mode: 'bus', stops: ['Gull Bay', 'Eastport'] },
      { type: 'route.require', from: 'Gull Bay', to: 'Eastport', requires: [{ kind: 'weather', not: ['storm'] }] },
      { type: 'travel', to: 'Eastport', mode: 'walk' },
      { type: 'transit.remove', line: 'Harbour Bus' },
    ];
    const r = applyOps(s0, ops.map(v), { source: 'user' });
    expect(r.errors).toEqual([]);
    expect(invertOps(r.state, r.inverses)).toEqual(s0);
  });
});
