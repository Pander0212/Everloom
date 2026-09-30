/**
 * State-change operations. Every change to campaign state is one of these.
 * The schemas are lenient on input (coercion, defaults) and strict on shape.
 */
import { z } from 'zod';
import { AI_OPS3, OpSchemas3 } from './ops3.js';

const name = z.string().trim().min(1).max(120);
const text = z.string().trim().max(4000);
const shortText = z.string().trim().max(400);
const num = z.coerce.number().refine(Number.isFinite, 'must be a finite number');
const int = z.coerce.number().int();
const numMap = z.record(z.string().max(40), num);

const itemCategory = z.enum([
  'food', 'drink', 'weapon', 'armor', 'clothing', 'accessory', 'key', 'tool', 'material',
  'consumable', 'medicine', 'book', 'container', 'quest', 'valuable', 'misc',
]);
const slot = z.enum(['head', 'body', 'legs', 'feet', 'hands', 'weapon', 'offhand', 'accessory', 'back']);
const level = z.enum(['world', 'region', 'local', 'nearby', 'area']);
const locKind = z.enum([
  'city', 'town', 'village', 'district', 'building', 'room', 'wilds', 'road', 'station', 'dock',
  'landmark', 'shop', 'service', 'danger', 'interior', 'home', 'vehicle', 'region', 'realm', 'other',
  'airport', 'portal', 'stable', 'taxi', 'bank',
]);
const weather = z.enum(['clear', 'cloudy', 'overcast', 'rain', 'storm', 'snow', 'fog', 'wind', 'heat']);
const statsPartial = z.object({ atk: num.optional(), def: num.optional(), spd: num.optional(), mag: num.optional() }).partial();

export const OpSchemas = {
  'time.advance': z.object({ type: z.literal('time.advance'), minutes: int.min(0).max(60 * 24 * 60) }),
  'time.until': z.object({ type: z.literal('time.until'), hour: int.min(0).max(23), minute: int.min(0).max(59).default(0) }),
  'weather.set': z.object({ type: z.literal('weather.set'), kind: weather, tempC: num.optional() }),
  'tracker.delta': z.object({ type: z.literal('tracker.delta'), id: z.string().trim().min(1).max(40), delta: num }),
  'tracker.set': z.object({ type: z.literal('tracker.set'), id: z.string().trim().min(1).max(40), value: num }),
  'tracker.define': z.object({
    type: z.literal('tracker.define'),
    id: z.string().trim().min(1).max(40),
    label: shortText.optional(),
    max: num.optional(),
    value: num.optional(),
    perHour: num.optional(),
    direction: z.enum(['need', 'fill']).optional(),
    visible: z.boolean().optional(),
    remove: z.boolean().optional(),
  }),
  'bar.delta': z.object({ type: z.literal('bar.delta'), id: z.string().trim().min(1).max(40), delta: num, target: name.optional() }),
  'bar.set': z.object({ type: z.literal('bar.set'), id: z.string().trim().min(1).max(40), cur: num.optional(), max: num.optional(), label: shortText.optional() }),
  'currency.delta': z.object({ type: z.literal('currency.delta'), amount: num }),
  'xp.add': z.object({ type: z.literal('xp.add'), amount: num.min(0).max(1_000_000) }),
  'item.add': z.object({
    type: z.literal('item.add'),
    name,
    qty: int.min(1).max(100000).default(1),
    category: itemCategory.optional(),
    desc: text.optional(),
    icon: z.string().max(60).optional(),
    value: num.optional(),
    slot: slot.optional(),
    effects: z.object({ trackers: numMap.optional(), bars: numMap.optional(), status: shortText.optional() }).optional(),
    stats: statsPartial.optional(),
    container: name.optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
  }),
  'item.remove': z.object({ type: z.literal('item.remove'), name, qty: int.min(1).max(100000).default(1) }),
  'item.use': z.object({ type: z.literal('item.use'), name }),
  'item.equip': z.object({ type: z.literal('item.equip'), name, equipped: z.boolean().default(true) }),
  'item.update': z.object({
    type: z.literal('item.update'),
    name,
    rename: name.optional(),
    category: itemCategory.optional(),
    desc: text.optional(),
    icon: z.string().max(60).optional(),
    value: num.optional(),
    slot: slot.nullable().optional(),
    locked: z.boolean().optional(),
    container: name.nullable().optional(),
    effects: z.object({ trackers: numMap.optional(), bars: numMap.optional(), status: shortText.optional() }).optional(),
  }),
  'status.add': z.object({
    type: z.literal('status.add'),
    name,
    kind: z.enum(['buff', 'debuff', 'neutral']).default('neutral'),
    desc: text.optional(),
    minutes: int.min(1).max(60 * 24 * 365).optional(),
    perHour: numMap.optional(),
  }),
  'status.remove': z.object({ type: z.literal('status.remove'), name }),
  'skill.add': z.object({
    type: z.literal('skill.add'),
    name,
    desc: text.optional(),
    kind: z.enum(['attack', 'heal', 'buff', 'debuff', 'utility']).default('utility'),
    cost: num.min(0).max(1000).default(0),
    costType: z.enum(['mp', 'ap', 'none']).default('none'),
    power: num.min(0).max(1000).default(10),
  }),
  'skill.remove': z.object({ type: z.literal('skill.remove'), name }),
  'player.update': z.object({
    type: z.literal('player.update'),
    name: name.optional(),
    className: shortText.optional(),
    age: int.min(0).max(10000).nullable().optional(),
    ageStage: shortText.optional(),
    appearance: text.optional(),
    stats: statsPartial.optional(),
    level: int.min(1).max(999).optional(),
  }),
  'location.upsert': z.object({
    type: z.literal('location.upsert'),
    name,
    level: level.optional(),
    parent: name.nullable().optional(),
    kind: locKind.optional(),
    description: text.optional(),
    customs: text.optional(),
    x: num.min(0).max(1000).optional(),
    y: num.min(0).max(1000).optional(),
    discovered: z.boolean().optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
  }),
  'location.move': z.object({ type: z.literal('location.move'), to: name }),
  'location.remove': z.object({ type: z.literal('location.remove'), name }),
  travel: z.object({ type: z.literal('travel'), to: name, mode: z.string().max(30).optional() }),
  'route.add': z.object({
    type: z.literal('route.add'),
    from: name,
    to: name,
    mode: z.enum(['road', 'trail', 'rail', 'water', 'air', 'space', 'portal']).default('road'),
    minutes: int.min(1).max(60 * 24 * 60).optional(),
  }),
  'npc.upsert': z.object({
    type: z.literal('npc.upsert'),
    name,
    aliases: z.array(name).max(10).optional(),
    role: shortText.optional(),
    title: shortText.optional(),
    age: int.min(0).max(10000).nullable().optional(),
    location: name.nullable().optional(),
    appearance: text.optional(),
    personality: text.optional(),
    notes: text.optional(),
    org: name.optional(),
    rank: shortText.optional(),
    status: z.enum(['alive', 'dead', 'missing']).optional(),
    phone: z.boolean().optional(),
    rumor: shortText.optional(),
    secret: shortText.optional(),
  }),
  'npc.set': z.object({
    type: z.literal('npc.set'),
    id: z.string().max(80),
    patch: z
      .object({
        name: name.optional(),
        aliases: z.array(name).max(20).optional(),
        role: shortText.optional(),
        title: shortText.optional(),
        age: int.min(0).max(10000).nullable().optional(),
        locationId: z.string().max(80).nullable().optional(),
        appearance: text.optional(),
        personality: text.optional(),
        notes: text.optional(),
        rumors: z.array(shortText).max(50).optional(),
        secrets: z.array(shortText).max(50).optional(),
        orgs: z.array(z.object({ orgId: z.string().max(80), rank: shortText })).max(20).optional(),
        status: z.enum(['alive', 'dead', 'missing']).optional(),
        phone: z.boolean().optional(),
        locked: z.boolean().optional(),
        characterId: z.string().max(80).nullable().optional(),
        portrait: z.string().max(80).nullable().optional(),
        birthday: z.object({ month: int.min(0).max(23), day: int.min(1).max(60) }).nullable().optional(),
        schedule: z
          .array(z.object({ id: z.string().max(40).optional(), days: z.array(int.min(0).max(13)).max(14), from: int.min(0).max(1439), to: int.min(0).max(1439), activity: shortText, locationId: z.string().max(80).nullable() }))
          .max(24)
          .optional(),
      })
      .strict(),
  }),
  'npc.merge': z.object({ type: z.literal('npc.merge'), into: z.string().max(80), from: z.string().max(80) }),
  'npc.move': z.object({ type: z.literal('npc.move'), name, location: name.nullable() }),
  'npc.remove': z.object({ type: z.literal('npc.remove'), name }),
  'npc.schedule': z.object({
    type: z.literal('npc.schedule'),
    name,
    slots: z
      .array(
        z.object({
          days: z.array(int.min(0).max(13)).max(14).default([]),
          from: z.union([int.min(0).max(1439), z.string().max(10)]),
          to: z.union([int.min(0).max(1439), z.string().max(10)]),
          activity: shortText,
          location: name.nullable().optional(),
        }),
      )
      .max(24),
  }),
  'org.upsert': z.object({
    type: z.literal('org.upsert'),
    name,
    orgType: shortText.optional(),
    purpose: text.optional(),
    location: name.nullable().optional(),
    leaderTitle: shortText.optional(),
    leader: name.nullable().optional(),
    influenceScale: z.enum(['local', 'regional', 'national', 'global']).optional(),
    standing: num.optional(),
  }),
  'org.set': z.object({
    type: z.literal('org.set'),
    id: z.string().max(80),
    patch: z
      .object({
        name: name.optional(),
        type: shortText.optional(),
        purpose: text.optional(),
        mainLocationId: z.string().max(80).nullable().optional(),
        standing: num.min(0).max(100).optional(),
        influenceScale: z.enum(['local', 'regional', 'national', 'global']).optional(),
        leaderTitle: shortText.optional(),
        leaderNpcId: z.string().max(80).nullable().optional(),
        subLeaders: z.array(shortText).max(20).optional(),
        rules: z.array(shortText).max(50).optional(),
        influence: z.array(z.object({ locationId: z.string().max(80), strength: num.min(0).max(100) })).max(50).optional(),
        members: z.array(z.object({ npcId: z.string().max(80).nullable(), name: shortText, rank: shortText })).max(200).optional(),
        locked: z.boolean().optional(),
      })
      .strict(),
  }),
  'org.remove': z.object({ type: z.literal('org.remove'), id: z.string().max(80) }),
  'location.set': z.object({
    type: z.literal('location.set'),
    id: z.string().max(80),
    patch: z
      .object({
        name: name.optional(),
        kind: locKind.optional(),
        level: level.optional(),
        parentId: z.string().max(80).nullable().optional(),
        description: text.optional(),
        customs: text.optional(),
        x: num.min(0).max(1000).optional(),
        y: num.min(0).max(1000).optional(),
        discovered: z.boolean().optional(),
        locked: z.boolean().optional(),
        image: z.string().max(80).nullable().optional(),
      })
      .strict(),
  }),
  'org.standing': z.object({ type: z.literal('org.standing'), name, delta: num.optional(), set: num.optional() }),
  'org.member': z.object({ type: z.literal('org.member'), org: name, npc: name, rank: shortText.optional(), remove: z.boolean().optional() }),
  'org.runin': z.object({ type: z.literal('org.runin'), org: name, text: shortText }),
  'org.rule': z.object({ type: z.literal('org.rule'), org: name, text: shortText, remove: z.boolean().optional() }),
  'org.influence': z.object({ type: z.literal('org.influence'), org: name, location: name, strength: num.min(0).max(100).default(50) }),
  'quest.add': z.object({
    type: z.literal('quest.add'),
    title: name,
    desc: text.optional(),
    objectives: z.array(shortText).max(20).optional(),
    giver: shortText.optional(),
    reward: shortText.optional(),
  }),
  'quest.update': z.object({
    type: z.literal('quest.update'),
    title: name,
    status: z.enum(['active', 'done', 'failed']).optional(),
    objective: shortText.optional(),
    done: z.boolean().optional(),
    addObjective: shortText.optional(),
    desc: text.optional(),
  }),
  'databank.add': z.object({ type: z.literal('databank.add'), text: shortText, title: shortText.optional(), tags: z.array(z.string().max(40)).max(12).optional() }),
  'databank.update': z.object({ type: z.literal('databank.update'), id: z.string().max(80), text: shortText.optional(), title: shortText.optional(), tags: z.array(z.string().max(40)).max(12).optional() }),
  'quest.remove': z.object({ type: z.literal('quest.remove'), title: name }),
  'databank.remove': z.object({ type: z.literal('databank.remove'), id: z.string().max(80) }),
  'relationship.delta': z.object({
    type: z.literal('relationship.delta'),
    name,
    affection: num.min(-100).max(100).optional(),
    trust: num.min(-100).max(100).optional(),
    desire: num.min(-100).max(100).optional(),
    tension: num.min(-100).max(100).optional(),
    label: shortText.optional(),
  }),
  'relationship.memory': z.object({ type: z.literal('relationship.memory'), name, text: shortText }),
  /** What someone is wearing now ("player" for the player). */
  'outfit.set': z.object({ type: z.literal('outfit.set'), who: name, text: shortText }),
  /** Knocked out, woken up, or killed (never the player). */
  'npc.vitals': z.object({ type: z.literal('npc.vitals'), name, state: z.enum(['awake', 'unconscious', 'dead']) }),
  /** How one NPC feels about another (directional). */
  'bond.delta': z.object({
    type: z.literal('bond.delta'),
    from: name,
    to: name,
    affinity: num.min(-100).max(100).optional(),
    trust: num.min(-100).max(100).optional(),
    desire: num.min(-100).max(100).optional(),
    tension: num.min(-100).max(100).optional(),
    kind: shortText.optional(),
  }),
  /** Something an NPC wants; "acting" goals with a place are pursued off-screen. */
  'goal.set': z.object({
    type: z.literal('goal.set'),
    npc: name,
    text: shortText,
    state: z.enum(['dormant', 'acting', 'blocked', 'resolved', 'failed']).default('acting'),
    urgency: num.min(0).max(10).optional(),
    target: name.nullable().optional(),
  }),
  /** An off-screen storyline that climbs from rumour to something unmistakable. */
  'thread.add': z.object({ type: z.literal('thread.add'), text: shortText, stages: z.array(shortText).min(2).max(6).optional(), place: name.nullable().optional(), pace: num.min(0.05).max(0.9).optional(), turn: int.min(0).optional() }),
  'thread.resolve': z.object({ type: z.literal('thread.resolve'), text: shortText }),
  'event.add': z.object({
    type: z.literal('event.add'),
    title: name,
    kind: z.enum(['event', 'birthday', 'reminder', 'holiday']).default('event'),
    at: int.min(0).optional(),
    inMinutes: int.min(0).max(60 * 24 * 3650).optional(),
    date: z.object({ year: int.optional(), month: int.min(1).max(24), day: int.min(1).max(60), hour: int.min(0).max(23).default(9), minute: int.min(0).max(59).default(0) }).optional(),
    recurring: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly']).default('none'),
    notes: shortText.optional(),
    npc: name.optional(),
  }),
  'event.remove': z.object({ type: z.literal('event.remove'), title: name }),
  'world.log': z.object({ type: z.literal('world.log'), text: shortText, kind: z.enum(['event', 'rumor', 'note']).default('note') }),
  'world.seen': z.object({ type: z.literal('world.seen') }),
  'party.add': z.object({ type: z.literal('party.add'), name, role: shortText.optional(), level: int.min(1).max(999).optional() }),
  'party.remove': z.object({ type: z.literal('party.remove'), name }),
  'party.update': z.object({
    type: z.literal('party.update'),
    name,
    sovereign: z.boolean().optional(),
    role: shortText.optional(),
    equip: z.object({ slot, item: name.nullable() }).optional(),
    hp: num.optional(),
    mp: num.optional(),
  }),
  'battle.start': z.object({
    type: z.literal('battle.start'),
    enemies: z
      .array(
        z.object({
          name,
          level: int.min(1).max(999).optional(),
          hp: num.min(1).max(1_000_000).optional(),
          atk: num.optional(),
          def: num.optional(),
          spd: num.optional(),
          mag: num.optional(),
          count: int.min(1).max(8).optional(),
        }),
      )
      .min(1)
      .max(8),
  }),
  'battle.action': z.object({
    type: z.literal('battle.action'),
    action: z.enum(['attack', 'skill', 'item', 'defend', 'flee']),
    actor: z.string().max(80).optional(),
    target: z.string().max(80).optional(),
    skill: name.optional(),
    item: name.optional(),
  }),
  'battle.end': z.object({ type: z.literal('battle.end'), outcome: z.enum(['won', 'lost', 'fled']).optional() }),
  'phone.notify': z.object({ type: z.literal('phone.notify'), npc: name, reason: shortText.optional() }),
  'phone.read': z.object({ type: z.literal('phone.read'), npc: name }),
  activity: z.object({
    type: z.literal('activity'),
    kind: z.enum(['sleep', 'nap', 'work', 'train', 'cook', 'bathe', 'rest', 'study', 'explore']),
    hours: num.min(0.25).max(24).optional(),
  }),
  'meta.update': z.object({
    type: z.literal('meta.update'),
    title: shortText.optional(),
    style: z.enum(['fantasy', 'modern', 'scifi']).optional(),
    currencyName: shortText.optional(),
    currencySymbol: z.string().max(8).optional(),
    dayLengthMode: z.enum(['turns', 'realtime']).optional(),
    realMinutesPerDay: num.min(1).max(1440).optional(),
    calendar: z.any().optional(),
  }),
  /** Internal: immer patches, used for inverses. Never accepted from the AI. */
  patch: z.object({ type: z.literal('patch'), patches: z.array(z.any()) }),
  ...OpSchemas3,
} as const;

export type OpType = keyof typeof OpSchemas;
export type Op = { [K in OpType]: z.infer<(typeof OpSchemas)[K]> }[OpType];
export type OpOf<K extends OpType> = z.infer<(typeof OpSchemas)[K]>;

/** Op types the tracker model / helper may emit. */
const P3_TYPES = new Set(Object.keys(OpSchemas3));
export const AI_OP_TYPES: OpType[] = (Object.keys(OpSchemas) as OpType[]).filter(
  (t) => (!P3_TYPES.has(t) || (AI_OPS3 as readonly string[]).includes(t)) && !['patch', 'battle.action', 'meta.update', 'world.seen', 'phone.read', 'databank.remove', 'databank.update', 'location.remove', 'npc.set', 'npc.merge', 'quest.remove', 'org.set', 'org.remove', 'location.set', 'thread.add'].includes(t),
);

export const OpSchema = z.discriminatedUnion(
  'type',
  Object.values(OpSchemas) as unknown as [typeof OpSchemas['time.advance'], ...Array<(typeof OpSchemas)[OpType]>],
);

/** Common aliases models produce for op types. */
const TYPE_ALIASES: Record<string, OpType> = {
  'inventory.add': 'item.add',
  add_item: 'item.add',
  'inventory.remove': 'item.remove',
  remove_item: 'item.remove',
  'time.pass': 'time.advance',
  advance_time: 'time.advance',
  'stat.delta': 'tracker.delta',
  'npc.add': 'npc.upsert',
  'npc.update': 'npc.upsert',
  'location.set': 'location.move',
  move: 'location.move',
  'faction.standing': 'org.standing',
  'quest.new': 'quest.add',
  'fact.add': 'databank.add',
  'hp.delta': 'bar.delta',
  'money.delta': 'currency.delta',
  'gold.delta': 'currency.delta',
};

export interface ValidatedOps {
  ok: Op[];
  rejected: Array<{ op: unknown; error: string }>;
}

/** Validate an array of loosely-shaped op objects; invalid ones are reported, valid ones kept. */
export function validateOps(input: unknown, allowed: readonly OpType[] = AI_OP_TYPES): ValidatedOps {
  const list: unknown[] = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as any).ops)
      ? (input as any).ops
      : input && typeof input === 'object' && (input as any).type
        ? [input]
        : [];
  const ok: Op[] = [];
  const rejected: ValidatedOps['rejected'] = [];
  for (const raw of list.slice(0, 64)) {
    if (!raw || typeof raw !== 'object') {
      rejected.push({ op: raw, error: 'not an object' });
      continue;
    }
    const obj = { ...(raw as Record<string, unknown>) };
    const t = String(obj.type ?? obj.op ?? '').trim();
    obj.type = (TYPE_ALIASES[t] ?? t) as string;
    delete obj.op;
    if (!allowed.includes(obj.type as OpType)) {
      rejected.push({ op: raw, error: `op type "${t}" not allowed` });
      continue;
    }
    const schema = OpSchemas[obj.type as OpType];
    const parsed = schema.safeParse(obj);
    if (parsed.success) ok.push(parsed.data as Op);
    else rejected.push({ op: raw, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  }
  return { ok, rejected };
}

/** Compact op reference for the tracker prompt. */
export const OP_REFERENCE = `Allowed ops (JSON objects with "type"):
- {"type":"time.advance","minutes":20}  time that passed in the scene
- {"type":"time.until","hour":7,"minute":0}  skip to the next 07:00
- {"type":"weather.set","kind":"rain"}  kinds: clear, cloudy, overcast, rain, storm, snow, fog, wind, heat
- {"type":"tracker.delta","id":"hunger","delta":-10}  trackers: hunger (higher = hungrier), energy, hygiene
- {"type":"bar.delta","id":"hp","delta":-5}  bars: hp, mp, ap
- {"type":"currency.delta","amount":-3}
- {"type":"xp.add","amount":10}
- {"type":"item.add","name":"Iced Lemon Tea","qty":1,"category":"drink"}  categories: food, drink, weapon, armor, clothing, accessory, key, tool, material, consumable, medicine, book, container, quest, valuable, misc
- {"type":"item.remove","name":"Iced Lemon Tea","qty":1}   {"type":"item.use","name":"Bread"}   {"type":"item.equip","name":"Sword","equipped":true}
- {"type":"status.add","name":"Soaked","kind":"debuff","minutes":60}   {"type":"status.remove","name":"Soaked"}
- {"type":"skill.add","name":"Fireball","kind":"attack","cost":10,"costType":"mp","power":25}
- {"type":"location.upsert","name":"Old Mill","level":"local","parent":"Riverside","kind":"building","description":"..."}
- {"type":"location.move","to":"Old Mill"}  the player moved there
- {"type":"npc.upsert","name":"Tobias Moreno","role":"Band leader","location":"Old Mill","appearance":"...","personality":"...","org":"The Ravens","rank":"Leader"}
- {"type":"npc.move","name":"Tobias","location":"Market"}
- {"type":"org.upsert","name":"The Ravens","orgType":"band","purpose":"..."}   {"type":"org.standing","name":"The Ravens","delta":5}   {"type":"org.runin","org":"The Ravens","text":"..."}
- {"type":"quest.add","title":"Find a vocalist","objectives":["Ask around the market"]}   {"type":"quest.update","title":"Find a vocalist","objective":"Ask around the market","done":true}
- {"type":"databank.add","text":"The bridge closes at midnight.","tags":["town"]}
- {"type":"relationship.delta","name":"Iris Thorne","affection":2,"trust":1}   {"type":"relationship.memory","name":"Iris Thorne","text":"Shared tea on the roof."}
- {"type":"event.add","title":"Band rehearsal","inMinutes":1440}
- {"type":"battle.start","enemies":[{"name":"Wolf","level":2,"count":2}]}
- {"type":"party.add","name":"Iris Thorne","role":"support"}
- {"type":"outfit.set","who":"Iris Thorne","text":"green raincoat over a band t-shirt"}  also "who":"player"; only when clothing is described or changes
- {"type":"npc.vitals","name":"Bram","state":"unconscious"}  states: awake, unconscious, dead (never the player)
- {"type":"bond.delta","from":"Iris Thorne","to":"Tobias Moreno","affinity":3,"tension":-2}  how one person feels about another; small steps
- {"type":"goal.set","npc":"Tobias Moreno","text":"Find a singer before Friday","target":"Market Square"}
- {"type":"thread.resolve","text":"The missing ferryman"}  an ongoing storyline was settled
- {"type":"shop.upsert","name":"Copper Kettle","kind":"general","npc":"Mara Quill","location":"Market Square","open":480,"close":1200}  a shop the story establishes (kinds: general, food, tavern, smith, alchemist, clothier, books, magic, tech, pharmacy, market, stable); purchases happen in the shop screen, not through ops
- {"type":"home.add","name":"Loft over the Kettle","kind":"apartment","location":"Market Square","ownership":"rented","rent":10}  the player gains a place to live (kinds: house, apartment, room, guild, castle, cabin, campsite, cave, vehicle)
- {"type":"household.add","name":"Pip","home":"Rose Cottage","role":"dependent","relation":"child"}  someone lives at (or, role "guest", regularly visits) one of the player's homes
- {"type":"bill.add","name":"Guild dues","kind":"dues","amount":5,"periodDays":30,"org":"Merchants Guild"}  a recurring payment the player agreed to
- {"type":"asset.add","name":"Chestnut Horse","kind":"animal","value":40}  the player comes to own property, a vehicle, a business or an animal`;
