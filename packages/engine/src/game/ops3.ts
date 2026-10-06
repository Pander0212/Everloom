/** Phase 3 op schemas: economy, homes and household, crafting. Merged into OpSchemas in ops.ts. */
import { z } from 'zod';

const name = z.string().trim().min(1).max(120);
const shortText = z.string().trim().max(400);
const num = z.coerce.number().refine(Number.isFinite, 'must be a finite number');
const int = z.coerce.number().int();
const money = num.min(0).max(1e9);
const category = z.enum(['food', 'drink', 'weapon', 'armor', 'clothing', 'accessory', 'key', 'tool', 'material', 'consumable', 'medicine', 'book', 'container', 'quest', 'valuable', 'misc']);
const slot = z.enum(['head', 'body', 'legs', 'feet', 'hands', 'weapon', 'offhand', 'accessory', 'back']);
const stats = z.object({ atk: num.optional(), def: num.optional(), spd: num.optional(), mag: num.optional() }).partial();
const effects = z.object({ trackers: z.record(z.string().max(40), num).optional(), bars: z.record(z.string().max(40), num).optional(), status: shortText.optional() });
const scheduleSlot = z.object({
  days: z.array(int.min(0).max(13)).max(14).default([]),
  from: int.min(0).max(1439),
  to: int.min(0).max(1440),
  activity: shortText.default(''),
  location: name.nullable().optional(),
});
const shopKind = z.enum(['general', 'food', 'tavern', 'smith', 'alchemist', 'clothier', 'books', 'magic', 'tech', 'pharmacy', 'market', 'stable', 'other']);
const homeKind = z.enum(['house', 'apartment', 'room', 'guild', 'castle', 'cabin', 'campsite', 'cave', 'vehicle', 'other']);
const clock = z.union([int.min(0).max(1440), z.string().regex(/^\d{1,2}:\d{2}$/)]).transform((v) => (typeof v === 'number' ? v : Number(v.split(':')[0]) * 60 + Number(v.split(':')[1])));
const weatherKind = z.enum(['clear', 'cloudy', 'overcast', 'rain', 'storm', 'snow', 'fog', 'wind', 'heat']);
/** A condition code checks before travel. */
export const requirement = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('discovered') }),
  z.object({ kind: z.literal('fare'), amount: money }),
  z.object({ kind: z.literal('vehicle'), mode: z.string().trim().min(1).max(30) }),
  z.object({ kind: z.literal('item'), name }),
  z.object({ kind: z.literal('standing'), org: name, min: num.min(0).max(100) }),
  z.object({ kind: z.literal('reputation'), min: num.min(-100).max(100) }),
  z.object({ kind: z.literal('quest'), title: name, state: z.enum(['active', 'done']).default('done') }),
  z.object({ kind: z.literal('partySize'), max: int.min(1).max(20) }),
  z.object({ kind: z.literal('notWanted'), max: int.min(0).max(5).default(0) }),
  z.object({ kind: z.literal('hours'), open: clock, close: clock }),
  z.object({ kind: z.literal('weather'), not: z.array(weatherKind).min(1).max(9) }),
]);
const discipline = z.enum(['cooking', 'alchemy', 'forge', 'enchantment', 'general']);

export const OpSchemas3 = {
  // ---- money
  'currency.define': z.object({ type: z.literal('currency.define'), name, symbol: z.string().trim().min(1).max(8), rate: num.min(0.000001).max(1e6) }),
  'currency.exchange': z.object({ type: z.literal('currency.exchange'), from: name, to: name, amount: money }),
  'bank.open': z.object({ type: z.literal('bank.open'), name: name.optional(), bank: name.optional(), apr: num.min(0).max(1).optional() }),
  'bank.deposit': z.object({ type: z.literal('bank.deposit'), account: name.optional(), amount: money, via: z.enum(['branch', 'app']).default('branch') }),
  'bank.withdraw': z.object({ type: z.literal('bank.withdraw'), account: name.optional(), amount: money, via: z.enum(['branch', 'app']).default('branch') }),
  'loan.take': z.object({ type: z.literal('loan.take'), lender: name, amount: money.min(1), apr: num.min(0).max(2).default(0.12), periodDays: int.min(1).max(365).default(30), installments: int.min(1).max(120).default(6) }),
  'bill.add': z.object({
    type: z.literal('bill.add'),
    name,
    kind: z.enum(['rent', 'subscription', 'dues', 'upkeep', 'loan', 'other']).default('other'),
    amount: money,
    periodDays: int.min(1).max(3650).default(30),
    dueInDays: num.min(0).max(3650).optional(),
    autopay: z.boolean().default(false),
    home: name.optional(),
    asset: name.optional(),
    org: name.optional(),
  }),
  'bill.pay': z.object({ type: z.literal('bill.pay'), bill: name }),
  'bill.set': z.object({ type: z.literal('bill.set'), bill: name, autopay: z.boolean().optional(), amount: money.optional(), end: z.boolean().optional() }),
  'asset.add': z.object({
    type: z.literal('asset.add'),
    name,
    kind: z.enum(['property', 'vehicle', 'business', 'animal', 'other']).default('other'),
    value: money.default(0),
    upkeep: money.default(0),
    income: money.default(0),
    periodDays: int.min(1).max(365).default(30),
    location: name.optional(),
    modes: z.array(z.string().max(30)).max(6).optional(),
    status: z.enum(['owned', 'rented', 'borrowed']).default('owned'),
    /** Buy it now at `value` (the player's own purchase). */
    buy: z.boolean().default(false),
  }),
  'asset.sell': z.object({ type: z.literal('asset.sell'), name }),
  // ---- shops and trade
  'shop.upsert': z.object({
    type: z.literal('shop.upsert'),
    name,
    kind: shopKind.optional(),
    npc: name.optional(),
    location: name.optional(),
    org: name.optional(),
    open: int.min(0).max(1440).optional(),
    close: int.min(0).max(1440).optional(),
    days: z.array(int.min(0).max(13)).max(14).optional(),
    restockDays: int.min(0).max(365).optional(),
    stock: z.array(z.object({ name, category: category.optional(), price: money, qty: int.min(0).max(9999).default(5), desc: shortText.optional(), slot: slot.optional(), stats: stats.optional(), effects: effects.optional() })).max(40).optional(),
  }),
  'shop.buy': z.object({ type: z.literal('shop.buy'), shop: name, item: name, qty: int.min(1).max(999).default(1) }),
  'shop.sell': z.object({ type: z.literal('shop.sell'), shop: name, item: name, qty: int.min(1).max(999).default(1) }),
  'shop.haggle': z.object({ type: z.literal('shop.haggle'), shop: name }),
  'trade.exchange': z.object({
    type: z.literal('trade.exchange'),
    npc: name,
    give: z.array(z.object({ name, qty: int.min(1).max(9999).default(1) })).max(12).default([]),
    /** Money the player adds (negative = money the NPC adds). */
    pay: num.min(-1e9).max(1e9).default(0),
    receive: z.array(z.object({ name, qty: int.min(1).max(9999).default(1), value: money.optional(), category: category.optional() })).max(12).default([]),
  }),
  /** Move an item between the player, the party bag, a party member and home storage. */
  'item.move': z.object({ type: z.literal('item.move'), name, qty: int.min(1).max(1_000_000).optional(), to: name }),
  // ---- homes and household
  'home.add': z.object({
    type: z.literal('home.add'),
    name,
    kind: homeKind.default('house'),
    location: name.optional(),
    ownership: z.enum(['owned', 'rented', 'borrowed']).default('owned'),
    rent: money.optional(),
    periodDays: int.min(1).max(365).default(30),
    primary: z.boolean().optional(),
  }),
  'home.update': z.object({ type: z.literal('home.update'), home: name, name: name.optional(), primary: z.boolean().optional(), notes: z.string().max(2000).optional() }),
  'home.remove': z.object({ type: z.literal('home.remove'), home: name }),
  'room.add': z.object({ type: z.literal('room.add'), home: name, name, purpose: shortText.optional(), amenities: z.array(z.string().max(30)).max(8).optional() }),
  'room.update': z.object({
    type: z.literal('room.update'),
    home: name,
    room: name,
    name: name.optional(),
    addAmenity: z.string().max(30).optional(),
    removeAmenity: z.string().max(30).optional(),
    upgrade: z.boolean().optional(),
    remove: z.boolean().optional(),
  }),
  'storage.add': z.object({ type: z.literal('storage.add'), home: name, name, capacity: int.min(1).max(500).default(10) }),
  'household.add': z.object({
    type: z.literal('household.add'),
    name,
    home: name,
    npc: name.optional(),
    role: z.enum(['head', 'resident', 'dependent', 'guardian', 'guest']).default('resident'),
    relation: shortText.default(''),
    schedule: z.array(scheduleSlot).max(12).optional(),
  }),
  'household.update': z.object({
    type: z.literal('household.update'),
    member: name,
    home: name.optional(),
    role: z.enum(['head', 'resident', 'dependent', 'guardian', 'guest']).optional(),
    relation: shortText.optional(),
    schedule: z.array(scheduleSlot).max(12).optional(),
  }),
  'household.remove': z.object({ type: z.literal('household.remove'), member: name }),
  /** Invite someone over: they visit your current home for a few hours from now. */
  'home.invite': z.object({ type: z.literal('home.invite'), npc: name, hours: num.min(0.5).max(72).default(3) }),
  // ---- crafting
  'recipe.add': z.object({
    type: z.literal('recipe.add'),
    name,
    discipline,
    ingredients: z.array(z.object({ name, qty: int.min(1).max(99).default(1) })).min(1).max(8),
    station: z.string().max(30).nullable().optional(),
    level: int.min(0).max(20).default(0),
    minutes: int.min(5).max(24 * 60).default(60),
    difficulty: z.enum(['easy', 'normal', 'hard', 'very hard']).default('normal'),
    result: z.object({ name, qty: int.min(1).max(99).default(1), category: category.default('misc'), value: money.default(0), effects: effects.optional(), stats: stats.optional(), slot: slot.nullable().optional() }),
    enchant: z.object({ effect: shortText, stats: stats.optional() }).nullable().optional(),
    source: z.enum(['ai', 'user']).default('user'),
  }),
  'recipe.remove': z.object({ type: z.literal('recipe.remove'), recipe: name }),
  craft: z.object({ type: z.literal('craft'), recipe: name, target: name.optional() }),
  // ---- party and progression
  'party.leader': z.object({ type: z.literal('party.leader'), name }),
  'party.formation': z.object({ type: z.literal('party.formation'), name, row: z.enum(['front', 'back']).optional(), active: z.boolean().optional() }),
  'party.tactics': z.object({
    type: z.literal('party.tactics'),
    name,
    roleKind: z.enum(['tank', 'healer', 'damage', 'support', 'scout']).nullable().optional(),
    preset: z.enum(['balanced', 'aggressive', 'defensive', 'heal-first', 'conserve']).optional(),
    rules: z
      .array(z.object({ when: z.enum(['allyHpBelow', 'selfHpBelow', 'enemyBroken', 'always']), value: num.min(0).max(100).default(0), do: z.enum(['heal', 'defend', 'attackWeakest', 'attackStrongest', 'skill']), skill: z.string().max(80).optional() }))
      .max(8)
      .optional(),
  }),
  'party.meta': z.object({
    type: z.literal('party.meta'),
    curve: z.enum(['gentle', 'standard', 'steep']).optional(),
    maxActive: int.min(1).max(7).optional(),
    xpSources: z.object({ battle: z.boolean(), quests: z.boolean(), discovery: z.boolean(), crafting: z.boolean() }).partial().optional(),
  }),
  'party.vital': z.object({ type: z.literal('party.vital'), name, id: z.string().trim().max(30).optional(), label: z.string().trim().min(1).max(30), cur: num.optional(), max: num.min(1).max(1e6).optional(), remove: z.boolean().optional() }),
  'party.injury': z.object({ type: z.literal('party.injury'), name, injury: shortText, remove: z.boolean().optional() }),
  'class.define': z.object({
    type: z.literal('class.define'),
    name,
    desc: shortText.default(''),
    growth: stats.default({}),
    hpPerLevel: int.min(0).max(1000).default(10),
    mpPerLevel: int.min(0).max(1000).default(5),
  }),
  'class.set': z.object({ type: z.literal('class.set'), who: name.optional(), class: name }),
  'skillnode.add': z.object({
    type: z.literal('skillnode.add'),
    name,
    desc: shortText.default(''),
    class: name.nullable().optional(),
    kind: z.enum(['attack', 'heal', 'buff', 'debuff', 'utility']).default('attack'),
    cost: int.min(0).max(1000).default(10),
    costType: z.enum(['mp', 'ap', 'none']).default('mp'),
    power: num.min(0).max(1000).default(12),
    element: z.string().trim().max(20).nullable().optional(),
    target: z.enum(['single', 'all', 'row', 'random', 'self', 'ally', 'allies']).default('single'),
    maxRank: int.min(1).max(5).default(3),
    level: int.min(1).max(999).default(1),
    after: z.array(name).max(4).optional(),
    item: name.optional(),
    quest: name.optional(),
  }),
  'skill.learn': z.object({ type: z.literal('skill.learn'), who: name.optional(), skill: name }),
  'stats.spend': z.object({ type: z.literal('stats.spend'), who: name.optional(), stat: z.enum(['atk', 'def', 'spd', 'mag', 'hp', 'mp']), points: int.min(1).max(99).default(1) }),
  // ---- mail, feed, phone
  'mail.send': z.object({
    type: z.literal('mail.send'),
    kind: z.enum(['letter', 'email']).default('letter'),
    to: name,
    subject: z.string().trim().max(160).default(''),
    body: z.string().trim().min(1).max(8000),
    courier: z.enum(['post', 'courier', 'bird', 'express']).optional(),
    expectReply: z.boolean().default(true),
  }),
  'mail.receive': z.object({
    type: z.literal('mail.receive'),
    kind: z.enum(['letter', 'email']).default('letter'),
    from: name,
    subject: z.string().trim().max(160).default(''),
    body: z.string().trim().max(8000).optional(),
    courier: z.enum(['post', 'courier', 'bird', 'express']).optional(),
  }),
  'mail.write': z.object({ type: z.literal('mail.write'), id: z.string().max(80), body: z.string().trim().min(1).max(8000) }),
  'mail.read': z.object({ type: z.literal('mail.read'), id: z.string().max(80) }),
  'mail.delete': z.object({ type: z.literal('mail.delete'), id: z.string().max(80) }),
  'feed.post': z.object({ type: z.literal('feed.post'), text: z.string().trim().min(1).max(1000), author: name.optional() }),
  'feed.like': z.object({ type: z.literal('feed.like'), id: z.string().max(80) }),
  'feed.comment': z.object({ type: z.literal('feed.comment'), id: z.string().max(80), text: z.string().trim().min(1).max(500), author: name.optional() }),
  'phone.group': z.object({ type: z.literal('phone.group'), name, members: z.array(name).max(12).default([]), remove: z.boolean().optional() }),
  'phone.app': z.object({ type: z.literal('phone.app'), name, icon: z.string().trim().max(30).default('sparkles'), prompt: z.string().trim().max(1500).default(''), remove: z.boolean().optional() }),
  // ---- stage and audio
  'fx.play': z.object({
    type: z.literal('fx.play'),
    effect: z.enum(['shake', 'flash', 'fade', 'blur', 'vignette', 'heartbeat', 'sparkle', 'rain', 'snow', 'glitch', 'fog', 'embers', 'lightning']),
    intensity: num.min(0).max(1).default(0.6),
    seconds: num.min(0.2).max(10).default(1.2),
  }),
  'stage.layer': z.object({
    type: z.literal('stage.layer'),
    character: name,
    position: z.enum(['left', 'center', 'right', 'off']).optional(),
    expression: z.string().trim().max(30).nullable().optional(),
    anim: z.enum(['none', 'bounce', 'nod', 'shake', 'slide-in', 'fade-in']).default('none'),
  }),
  'stage.clear': z.object({ type: z.literal('stage.clear') }),
  'cutscene.add': z.object({
    type: z.literal('cutscene.add'),
    name,
    steps: z
      .array(
        z.object({
          text: z.string().trim().min(1).max(2000),
          speaker: z.string().trim().max(80).optional(),
          background: z.string().max(80).nullable().optional(),
          fx: z.enum(['shake', 'flash', 'fade', 'blur', 'vignette', 'heartbeat', 'sparkle', 'rain', 'snow', 'glitch', 'fog', 'embers', 'lightning']).optional(),
          mood: z.string().trim().max(30).optional(),
          seconds: num.min(1).max(30).optional(),
        }),
      )
      .min(1)
      .max(40),
    source: z.enum(['user', 'ai']).default('user'),
  }),
  'cutscene.play': z.object({ type: z.literal('cutscene.play'), name }),
  'cutscene.stop': z.object({ type: z.literal('cutscene.stop') }),
  'cutscene.remove': z.object({ type: z.literal('cutscene.remove'), name }),
  'music.set': z.object({ type: z.literal('music.set'), playlist: z.string().trim().max(80).nullable().optional(), mood: z.string().trim().max(30).nullable().optional() }),
  'ambient.set': z.object({ type: z.literal('ambient.set'), kind: z.enum(['auto', 'none', 'rain', 'storm', 'wind', 'city', 'crowd', 'forest', 'sea', 'fire', 'night']) }),
  // ---- 3D characters (Phase 5): what a character does and wears on the stage
  'avatar.emote': z.object({ type: z.literal('avatar.emote'), who: name, emote: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{0,39}$/) }),
  'avatar.pose': z.object({ type: z.literal('avatar.pose'), who: name, pose: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{0,39}$/).nullable() }),
  'avatar.outfit': z.object({ type: z.literal('avatar.outfit'), who: name, outfit: z.string().trim().max(60).nullable() }),
  // ---- transit
  'transit.add': z.object({
    type: z.literal('transit.add'),
    name,
    mode: z.string().trim().min(1).max(30).default('train'),
    stops: z.array(name).min(2).max(24),
    first: clock.default(360),
    last: clock.default(1320),
    every: int.min(5).max(24 * 60).default(60),
    days: z.array(int.min(0).max(13)).max(14).default([]),
    hop: int.min(1).max(24 * 60 * 7).default(30),
    fare: money.default(0),
    farePerStop: money.default(0),
    requires: z.array(requirement).max(8).default([]),
  }),
  'transit.remove': z.object({ type: z.literal('transit.remove'), line: name }),
  'transit.ticket': z.object({ type: z.literal('transit.ticket'), line: name, qty: int.min(1).max(20).default(1) }),
  'transit.ride': z.object({ type: z.literal('transit.ride'), line: name, to: name }),
  'route.require': z.object({ type: z.literal('route.require'), from: name, to: name, mode: z.enum(['road', 'trail', 'rail', 'water', 'air', 'space', 'portal']).optional(), requires: z.array(requirement).max(8) }),
} as const;

/** Phase 3 ops the model may emit: things the story establishes, never the player's own money moves. */
export const AI_OPS3 = ['currency.define', 'shop.upsert', 'bill.add', 'asset.add', 'home.add', 'room.add', 'household.add', 'household.update', 'transit.add', 'route.require', 'mail.receive', 'feed.post', 'fx.play', 'stage.layer', 'cutscene.play', 'music.set', 'ambient.set', 'avatar.emote', 'avatar.pose', 'avatar.outfit'] as const;
