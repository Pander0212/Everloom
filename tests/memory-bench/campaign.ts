/**
 * A deterministic synthetic campaign for the memory benchmark: 300+ turns across days and
 * places, a cast who come and go, secrets told in private, facts that change, and a question
 * set with known answers. Every event carries a unique "detail" phrase so an answer can be
 * checked by string match.
 */
import { createRng } from '@everloom/engine';

export const PLAYER_NAME = 'Anala';

export const CAST = [
  'Mara Voss', 'Tobias Moreno', 'Bram Keller', 'Iris Thorne', 'Kael Ashdown', 'Lena Brightwater',
  'Osric Hale', 'Petra Quill', 'Rowan Fitch', 'Selene Marsh', 'Dorian Vale', 'Yara Nightingale',
];
export const PLACES = ['The Lantern', 'Market Square', 'Old Pier', 'Temple of Dawn', 'Guild Hall', 'Northgate', 'Mill Road', 'Rosewood Manor'];
const ADJ = ['brass', 'silver', 'jade', 'crimson', 'ivory', 'cobalt', 'amber', 'onyx', 'copper', 'pearl', 'scarlet', 'violet', 'golden', 'ashen', 'frosted', 'emerald', 'rusted', 'gilded', 'obsidian', 'coral'];
const OBJ = ['key', 'locket', 'ledger', 'map', 'ring', 'seal', 'flute', 'letter', 'compass', 'dagger', 'lantern', 'mask', 'chalice', 'feather', 'coin', 'bell', 'mirror', 'scroll', 'thimble', 'harp'];
const SPOTS = ['a loose floorboard', 'the altar steps', 'a fishing net', 'a flour sack', 'the well', 'a hollow oak', 'the chimney', 'a rain barrel'];
const TASKS = ['guard the gate at dawn', 'sing at the harvest feast', 'find the missing ferryman', 'repair the chapel bell', 'carry a message north', 'keep the cellar locked'];
const SLOTS: Array<{ key: string; values: string[]; word: string }> = [
  { key: 'rank', values: ['squire', 'knight', 'captain'], word: 'rank' },
  { key: 'job', values: ['baker', 'smuggler', 'harbour master'], word: 'work' },
  { key: 'home', values: ['Mill Road', 'Rosewood Manor', 'the Old Pier'], word: 'lives' },
];

export interface BenchEvent {
  id: string;
  turn: number;
  text: string;
  detail: string;
  about: string[];
  /** Names who saw it (player included when present). */
  witnesses: string[];
  place: string;
  importance: 1 | 2 | 3;
  secret: boolean;
  to: string[];
}

export interface BenchFact {
  turn: number;
  about: string;
  key: string;
  value: string;
  previous: string | null;
  text: string;
  changed: boolean;
}

export interface BenchTurn {
  n: number;
  userText: string;
  story: string;
  place: string;
  present: string[];
  minutes: number;
  ops: unknown[];
  events: BenchEvent[];
  facts: BenchFact[];
}

export type QuestionKind = 'recall-lexical' | 'recall-entity' | 'person' | 'leak' | 'fact';

export interface BenchQuestion {
  kind: QuestionKind;
  /** Asked just after this turn. */
  after: number;
  cue: string;
  /** The phrase that must (or, for leaks, must not) reach the scene. */
  expect: string;
  /** Other phrases that also count as a hit. */
  anyOf?: string[];
  /** For person/leak questions: whose knowledge. */
  viewer?: string;
  /** For fact questions: the outdated value. */
  stale?: string;
  eventId?: string;
}

export interface BenchCampaign {
  turns: BenchTurn[];
  events: BenchEvent[];
  facts: BenchFact[];
  questions: BenchQuestion[];
}

export function generateCampaign(opts: { turns?: number; seed?: number } = {}): BenchCampaign {
  const total = opts.turns ?? 320;
  const rng = createRng(opts.seed ?? 20260929);
  const details = rng.shuffle(ADJ.flatMap((a) => OBJ.map((o) => `${a} ${o}`)));
  let di = 0;
  const nextDetail = () => details[di++ % details.length];
  const npcAt = new Map<string, string>();
  let place = PLACES[0];
  let present: string[] = [];
  const turns: BenchTurn[] = [];
  const events: BenchEvent[] = [];
  const facts: BenchFact[] = [];
  const slotValue = new Map<string, number>();
  let clock = 8 * 60;

  for (let n = 1; n <= total; n++) {
    const ops: unknown[] = [];
    // A new scene every ~6 turns: move, sometimes sleep to the next morning.
    if (n === 1 || rng.chance(0.17)) {
      const next = rng.pick(PLACES.filter((p) => p !== place));
      if (n === 1) for (const p of PLACES) ops.push({ type: 'location.upsert', name: p, kind: 'district' });
      place = n === 1 ? PLACES[0] : next;
      ops.push({ type: 'location.move', to: place });
      const count = rng.int(2, 4);
      present = rng.shuffle(CAST).slice(0, count);
      for (const name of present) if (npcAt.get(name) !== place) {
        npcAt.set(name, place);
        ops.push({ type: 'npc.upsert', name, location: place });
      }
      // Whoever was "here" before but isn't now has gone elsewhere.
      for (const [name, at] of npcAt) if (at === place && !present.includes(name)) {
        const away = rng.pick(PLACES.filter((p) => p !== place));
        npcAt.set(name, away);
        ops.push({ type: 'npc.upsert', name, location: away });
      }
      if (n > 1 && rng.chance(0.3)) {
        const toMorning = 24 * 60 - (clock % (24 * 60)) + 8 * 60;
        clock += toMorning;
        ops.push({ type: 'time.advance', minutes: toMorning });
      }
    }
    const step = rng.int(15, 50);
    clock += step;
    ops.push({ type: 'time.advance', minutes: step });

    const turnEvents: BenchEvent[] = [];
    const turnFacts: BenchFact[] = [];
    const a = rng.pick(present);
    const b = rng.pick(present.filter((x) => x !== a).concat(PLAYER_NAME));
    const detail = nextDetail();
    const roll = rng.next();
    let text: string;
    let importance: 1 | 2 | 3 = 1;
    let secret = false;
    let to: string[] = [];
    if (roll < 0.14) {
      secret = true;
      importance = 2;
      to = [a];
      text = `${a} whispered to ${PLAYER_NAME} that the ${detail} is hidden under ${rng.pick(SPOTS)}.`;
    } else if (roll < 0.18) {
      importance = 3;
      text = `${a} swore a blood oath over the ${detail} to protect ${b}.`;
    } else if (roll < 0.4) {
      importance = 2;
      text = `${a} promised ${b} to ${rng.pick(TASKS)}, sealing it with the ${detail}.`;
    } else if (roll < 0.6) {
      text = `${a} gave ${b} the ${detail}.`;
    } else if (roll < 0.8) {
      text = `${a} found the ${detail} under ${rng.pick(SPOTS)}.`;
    } else {
      text = `${a} and ${b} argued about the ${detail}.`;
    }
    const ev: BenchEvent = { id: `e${n}`, turn: n, text, detail, about: [a, ...(b === PLAYER_NAME || secret ? [] : [b])], witnesses: secret ? [PLAYER_NAME, a] : [PLAYER_NAME, ...present], place, importance, secret, to };
    turnEvents.push(ev);

    // Standing facts: set early, changed later.
    if (n % 9 === 4) {
      const who = rng.pick(present);
      const slot = SLOTS[(n / 9) % SLOTS.length | 0];
      const k = `${who}|${slot.key}`;
      const prev = slotValue.get(k);
      const idx = prev === undefined ? 0 : Math.min(slot.values.length - 1, prev + 1);
      if (prev === undefined || idx !== prev) {
        slotValue.set(k, idx);
        const value = slot.values[idx];
        const changed = prev !== undefined;
        const ftext = changed ? `${who} became a ${value}` : `${who} is a ${value}`;
        const f: BenchFact = { turn: n, about: who, key: slot.key, value, previous: changed ? slot.values[prev!] : null, text: slot.key === 'home' ? `${who} ${changed ? 'moved to' : 'lives at'} ${value}` : ftext, changed };
        turnFacts.push(f);
      }
    }

    const story = [
      ...turnEvents.map((e) => (e.secret ? `*${e.text.replace(' whispered to ', ' leans close and whispers to ')}*` : e.text)),
      ...turnFacts.map((f) => `${f.text}.`),
      `The light shifts over ${place}.`,
    ].join(' ');
    turns.push({ n, userText: `I watch ${a} closely.`, story, place, present: [...present], minutes: clock, ops, events: turnEvents, facts: turnFacts });
    events.push(...turnEvents);
    facts.push(...turnFacts);
  }

  // Questions: from turn 40, every 4 turns, rotating kinds. Targets are at least 20 turns old so
  // they're out of the verbatim history and memory must carry them.
  const questions: BenchQuestion[] = [];
  const kinds: QuestionKind[] = ['recall-lexical', 'recall-entity', 'person', 'leak', 'fact'];
  let k = 0;
  for (let t = 40; t <= total; t += 4) {
    const kind = kinds[k++ % kinds.length];
    const turn = turns[t - 1];
    const old = events.filter((e) => e.turn <= t - 20);
    const q = makeQuestion(kind, t, turn, old, facts, rng);
    if (q) questions.push(q);
  }
  return { turns, events, facts, questions };
}

function makeQuestion(kind: QuestionKind, t: number, turn: BenchTurn, old: BenchEvent[], facts: BenchFact[], rng: ReturnType<typeof createRng>): BenchQuestion | null {
  if (kind === 'recall-lexical') {
    const e = rng.pick(old.filter((x) => !x.secret));
    const [adj, obj] = e.detail.split(' ');
    return { kind, after: t, cue: `Where did I last hear of the ${adj} ${obj}?`, expect: e.detail, eventId: e.id };
  }
  if (kind === 'recall-entity') {
    // Someone here, and an older moment with them at a place: the cue names both, not the object.
    const here = old.filter((x) => !x.secret && x.about.some((p) => turn.present.includes(p)));
    if (!here.length) return null;
    const e = rng.pick(here);
    const who = e.about.find((p) => turn.present.includes(p))!;
    // Any moment with them at that place is a right answer.
    const also = here.filter((x) => x.place === e.place && x.about.includes(who)).map((x) => x.detail);
    return { kind, after: t, cue: `I remember ${who} back at ${e.place}. What happened there?`, expect: e.detail, anyOf: also, eventId: e.id };
  }
  if (kind === 'person') {
    const seen = old.filter((x) => !x.secret && turn.present.some((p) => x.witnesses.includes(p)));
    if (!seen.length) return null;
    const e = rng.pick(seen);
    const viewer = turn.present.find((p) => e.witnesses.includes(p))!;
    return { kind, after: t, cue: `${viewer}, do you remember the ${e.detail}?`, expect: e.detail, viewer, eventId: e.id };
  }
  if (kind === 'leak') {
    const secrets = old.filter((x) => x.secret && turn.present.some((p) => !x.witnesses.includes(p)));
    if (!secrets.length) return null;
    const e = rng.pick(secrets);
    const viewer = turn.present.find((p) => !e.witnesses.includes(p))!;
    return { kind, after: t, cue: `${viewer} asks me about the ${e.detail}.`, expect: e.detail, viewer, eventId: e.id };
  }
  const changed = facts.filter((f) => f.changed && f.turn <= t - 10);
  if (!changed.length) return null;
  const f = rng.pick(changed);
  // The latest value as of this turn.
  const latest = facts.filter((x) => x.about === f.about && x.key === f.key && x.turn <= t).at(-1)!;
  const word = f.key === 'rank' ? 'rank' : f.key === 'job' ? 'work' : 'home';
  return { kind: 'fact', after: t, cue: `What is ${f.about}'s ${word} these days?`, expect: latest.value, stale: latest.previous ?? undefined };
}
