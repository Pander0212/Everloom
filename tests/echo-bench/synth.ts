/**
 * Synthetic ECHO stories for recall evaluation (§12). Deterministic per seed and size.
 *
 * A long story of ordinary, deliberately similar distractor events (dinners at the inn, walks,
 * errands, small talk with the same few people) with planted target events that each recall test
 * must find later — far back, through a paraphrase, an object, a place, a promise, a multi-hop
 * association, among near-duplicates, as exact words — plus cues that must find nothing.
 */
import { echo } from '../../packages/engine/src/index.js';
import { createRng } from '../../packages/engine/src/util/rng.js';

export const NAMES: Record<string, string> = { player: 'Mara', anna: 'Anna Vey', ben: 'Ben Hollis', clara: 'Clara Hollis', daniel: 'Daniel Rook', iris: 'Iris Thorne', tobias: 'Tobias Moreno' };
export const PLACES = ['inn', 'market', 'harbor', 'lighthouse', 'chapel', 'mill', 'lake', 'square'];

export interface BenchQuery {
  id: string;
  kind: string;
  text: string;
  scene: echo.SceneCues;
  /** Events that must be recalled (empty: nothing should be). */
  expect: string[];
  actor: string;
}

const here = (actors: string[]): echo.ObserverState[] => actors.map((actor) => ({ actor, place: 'here', sight: true, hearing: 'clear', awake: true, impairment: 0, attention: 1 }));

function base(id: string, seq: number, p: Partial<echo.EchoEvent> & { action: string }): echo.EchoEvent {
  return {
    id,
    storyId: 'bench',
    messageId: `m${Math.floor(seq)}`,
    swipeId: 0,
    seq,
    type: 'action',
    occurredAt: seq * 45,
    recordedAt: 0,
    locationId: 'inn',
    actors: ['player'],
    targets: [],
    attempted: false,
    outcome: 'success',
    visibility: 'public',
    cues: [],
    observers: here(['player']),
    recipients: [],
    importance: 1,
    causes: [],
    sourceMessageIds: [],
    provenance: 'manual',
    schemaVersion: 1,
    ...p,
  };
}

const DISTRACTORS = [
  (a: string, pl: string) => `Mara and ${a} had dinner at the ${pl} and talked about the harvest`,
  (a: string, pl: string) => `Mara walked with ${a} past the ${pl}, chatting about prices`,
  (a: string, pl: string) => `${a} complained to Mara about the noise near the ${pl}`,
  (a: string, pl: string) => `Mara bought bread and candles near the ${pl} while ${a} waited`,
  (a: string, pl: string) => `${a} and Mara watched the boats from the ${pl} for a while`,
  (a: string, pl: string) => `Mara helped ${a} carry crates to the ${pl}`,
  (a: string, pl: string) => `${a} told Mara a long story about a cousin who lives by the ${pl}`,
];

export function generateStory(size: number, seed = 7): { events: echo.EchoEvent[]; queries: BenchQuery[]; names: Record<string, string> } {
  const rng = createRng(seed);
  const people = ['anna', 'ben', 'clara', 'daniel', 'iris', 'tobias'];
  const events: echo.EchoEvent[] = [];
  const targets = new Map<number, echo.EchoEvent>();
  const at = (frac: number) => Math.max(2, Math.floor(size * frac));
  const plant = (frac: number, e: (seq: number) => echo.EchoEvent) => targets.set(at(frac), e(at(frac)));
  plant(0.02, (s) => base('t_compass', s, { actors: ['iris', 'player'], action: 'Iris gave Mara a brass compass with a cracked lid', establishes: [echo.prop('player', 'has', 'brass compass')], importance: 2, observers: here(['player', 'iris']) }));
  plant(0.05, (s) => base('t_mill', s, { actors: ['tobias', 'player'], type: 'speech', action: 'Tobias confessed to Mara that he set the old mill on fire years ago', locationId: 'harbor', importance: 3, observers: here(['player', 'tobias']), emotions: [{ actor: 'player', emotion: 'shock', intensity: 0.7 }] }));
  plant(0.08, (s) => base('t_locket', s, { actors: ['player'], action: "Mara swore on her grandmother's silver locket to find the thief", locationId: 'chapel', importance: 2 }));
  plant(0.11, (s) => base('t_lighthouse', s, { actors: ['daniel', 'player'], action: 'Daniel kissed Mara on the stairs of the lighthouse during the storm', locationId: 'lighthouse', importance: 3, observers: here(['player', 'daniel']), emotions: [{ actor: 'player', emotion: 'love', intensity: 0.8 }] }));
  plant(0.14, (s) => base('t_promise', s, { type: 'promise', actors: ['anna', 'player'], action: 'Anna promised to teach Mara to sail before the autumn races', locationId: 'harbor', commitment: { id: 'sail', by: 'anna', to: ['player'], what: 'teach Mara to sail before the autumn races' }, importance: 2, observers: here(['player', 'anna']) }));
  plant(0.17, (s) => base('t_siblings', s, { actors: ['ben', 'clara'], action: 'Ben introduced Clara Hollis to Mara as his younger sister', locationId: 'square', observers: here(['player', 'ben', 'clara']) }));
  plant(0.2, (s) => base('t_map', s, { actors: ['clara'], action: 'Clara hid the smuggler map behind the chapel altar while Mara kept watch', locationId: 'chapel', importance: 2, observers: here(['player', 'clara']) }));
  plant(0.23, (s) => base('t_flood', s, { actors: ['anna', 'player'], action: 'Mara and Anna had dinner at the inn the night the storm flooded the cellar', locationId: 'inn', importance: 2, observers: here(['player', 'anna']) }));
  plant(0.26, (s) => base('t_key', s, { type: 'speech', actors: ['anna'], recipients: ['player'], action: 'Anna told Mara where the spare key to the boathouse is hidden', quote: '"Under the third stone from the door, the one with the moss. Tell no one."', locationId: 'harbor', importance: 2, observers: here(['player', 'anna']) }));
  plant(0.29, (s) => base('t_lake_summer', s, { actors: ['iris', 'player'], action: 'Mara and Iris swam in the lake on a hot summer afternoon', locationId: 'lake', observers: here(['player', 'iris']) }));
  plant(0.32, (s) => base('t_lake_winter', s, { actors: ['iris', 'player'], action: 'Mara and Iris skated on the frozen lake one winter evening', locationId: 'lake', observers: here(['player', 'iris']) }));
  plant(0.35, (s) => base('t_bakery', s, { actors: ['player'], action: 'Mara smelled cinnamon bread from the old bakery the day her father left', locationId: 'square', importance: 2, emotions: [{ actor: 'player', emotion: 'grief', intensity: 0.6 }], cues: [{ channel: 'smell', detail: 'the smell of cinnamon bread from the old bakery', salience: 0.8, reveals: 'content' }] }));

  for (let i = 1; i <= size; i++) {
    const t = targets.get(i);
    if (t) {
      events.push(t);
      continue;
    }
    const a = rng.pick(people);
    const pl = rng.pick(PLACES);
    const text = rng.pick(DISTRACTORS)(NAMES[a].split(' ')[0], pl);
    events.push(base(`d${i}`, i, { actors: ['player'], targets: [a], action: text, locationId: pl, observers: here(['player', a]) }));
  }
  const now = (size + 5) * 45;
  const scene = (p: Partial<echo.SceneCues> = {}): echo.SceneCues => ({ now, present: ['player'], locationId: 'nowhere', ...p });
  const q = (id: string, kind: string, text: string, expect: string[], sc: Partial<echo.SceneCues> = {}): BenchQuery => ({ id, kind, text, scene: scene(sc), expect, actor: 'player' });
  const queries: BenchQuery[] = [
    q('q1', 'exact-far', 'Do you still carry the brass compass Iris gave you?', ['t_compass']),
    q('q2', 'paraphrase', 'Who was it that set fire to the old mill back then?', ['t_mill']),
    // A pure paraphrase (no shared content word but "mill"): needs embeddings; reported, not asserted.
    q('q2b', 'pure-paraphrase', 'Who started the blaze that burned down the mill?', ['t_mill']),
    q('q3', 'object', 'I turn it over in my fingers and say nothing.', ['t_locket'], { objects: ['silver locket'] }),
    q('q4', 'location', 'We climb the stairs again, slowly.', ['t_lighthouse'], { locationId: 'lighthouse' }),
    q('q5', 'promise', 'Good morning, Anna.', ['t_promise'], { present: ['player', 'anna'], locationId: 'square' }),
    q('q6', 'multi-hop', "Ask Ben where his sister hid it.", ['t_map'], { present: ['player', 'ben'] }),
    q('q7', 'similar', 'Remember the dinner when the cellar flooded?', ['t_flood']),
    q('q9', 'exact-words', 'What exactly did Anna say about the boathouse key?', ['t_key']),
    q('q10', 'missing', 'Remember when we rode camels across the desert?', []),
    q('q11', 'unrelated', 'The weather is nice. I would like to buy some fish.', []),
    q('q12a', 'interference', 'The lake in winter, when everything was frozen.', ['t_lake_winter']),
    q('q12b', 'interference', 'That summer at the lake, swimming in the heat.', ['t_lake_summer']),
    q('q13', 'sensory', 'Something smells of cinnamon bread here.', ['t_bakery'], { sensory: ['cinnamon bread'], locationId: 'square' }),
  ];
  return { events, queries, names: NAMES };
}

/** Names index for query understanding. */
export function nameIndex(names: Record<string, string>): echo.NameIndex {
  return { entities: Object.fromEntries(Object.entries(names).filter(([id]) => id !== 'player').map(([id, n]) => [id, [n, n.split(' ')[0]]])) };
}
