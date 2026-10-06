/**
 * Every op rolls back exactly: one long, realistic story touches every op type, and after each
 * step its inverse patches must restore the state from just before it. A new op type without a
 * step here fails the coverage check.
 */
import { describe, expect, it } from 'vitest';
import { applyOps, createInitialState, diffToPatches, invertOps, OpSchemas, registerExtOps, type CampaignState, type Op } from '../src/index.js';

registerExtOps('town-rep', [{ name: 'change', label: 'Reputation', params: { town: { type: 'string' }, amount: { type: 'integer', min: -50, max: 50 } }, steps: [{ do: 'add', path: '/towns/{town}', value: '{amount}', min: -100, max: 100 }] }]);

type Step = Record<string, unknown> | ((s: CampaignState) => Record<string, unknown>);

const idOf = (rec: Record<string, { id: string; name?: string; title?: string; text?: string }>, label: string) =>
  Object.values(rec).find((x) => (x.name ?? x.title ?? x.text) === label)!.id;

const STEPS: Step[] = [
  // ---- world and player
  { type: 'meta.update', style: 'fantasy' },
  { type: 'weather.set', kind: 'rain', tempC: 12 },
  { type: 'time.advance', minutes: 30 },
  { type: 'time.until', hour: 9 },
  { type: 'tracker.define', id: 'thirst', label: 'Thirst', max: 100, value: 10, perHour: 2, direction: 'need' },
  { type: 'tracker.delta', id: 'thirst', delta: 5 },
  { type: 'tracker.set', id: 'thirst', value: 30 },
  { type: 'bar.set', id: 'hp', cur: 80, max: 120 },
  { type: 'bar.delta', id: 'hp', delta: -10 },
  { type: 'currency.delta', amount: 500 },
  { type: 'xp.add', amount: 40 },
  { type: 'player.update', appearance: 'A tall traveller in a grey cloak' },
  { type: 'item.add', name: 'Iron Sword', qty: 1, category: 'weapon', value: 15 },
  { type: 'item.update', name: 'Iron Sword', desc: 'Notched but sharp' },
  { type: 'item.equip', name: 'Iron Sword', equipped: true },
  { type: 'item.add', name: 'Bread', qty: 3, category: 'food' },
  { type: 'item.use', name: 'Bread' },
  { type: 'item.remove', name: 'Bread', qty: 1 },
  { type: 'status.add', name: 'Well rested', kind: 'buff', minutes: 120 },
  { type: 'status.remove', name: 'Well rested' },
  { type: 'skill.add', name: 'Whistle', kind: 'utility' },
  { type: 'skill.remove', name: 'Whistle' },
  { type: 'outfit.set', who: 'player', text: 'a rain-dark cloak' },
  // ---- places
  { type: 'location.upsert', name: 'Millbrook', level: 'local', kind: 'town' },
  { type: 'location.upsert', name: 'Copper Kettle', level: 'local', kind: 'shop', parent: 'Millbrook' },
  { type: 'location.upsert', name: 'Guild Bank', level: 'local', kind: 'bank', parent: 'Millbrook' },
  { type: 'location.upsert', name: 'Old Pier', level: 'local', kind: 'dock', parent: 'Millbrook' },
  { type: 'location.upsert', name: 'Eastport', level: 'local', kind: 'town' },
  { type: 'location.upsert', name: 'Rose Cottage', level: 'local', kind: 'building', parent: 'Millbrook' },
  { type: 'location.upsert', name: 'Shed', level: 'local', kind: 'building' },
  (s) => ({ type: 'location.set', id: idOf(s.locations as any, 'Shed'), patch: { name: 'Old Shed' } }),
  { type: 'location.remove', name: 'Old Shed' },
  { type: 'route.add', from: 'Millbrook', to: 'Eastport' },
  { type: 'route.require', from: 'Millbrook', to: 'Eastport', requires: [{ kind: 'hours', open: '06:00', close: '22:00' }] },
  { type: 'location.move', to: 'Copper Kettle' },
  { type: 'travel', to: 'Old Pier', mode: 'walk' },
  { type: 'location.move', to: 'Copper Kettle' },
  // ---- people and groups
  { type: 'npc.upsert', name: 'Mara Quill', location: 'Copper Kettle', role: 'Shopkeeper' },
  { type: 'npc.upsert', name: 'Tobias Moreno', location: 'Copper Kettle', role: 'Musician' },
  { type: 'npc.upsert', name: 'The Fiddler', location: 'Old Pier' },
  { type: 'npc.upsert', name: 'Patron A', location: 'Copper Kettle' },
  (s) => ({ type: 'npc.set', id: idOf(s.npcs as any, 'Patron A'), patch: { role: 'Regular' } }),
  (s) => ({ type: 'npc.merge', into: idOf(s.npcs as any, 'Tobias Moreno'), from: idOf(s.npcs as any, 'The Fiddler') }),
  { type: 'npc.move', name: 'Tobias Moreno', location: 'Old Pier' },
  { type: 'npc.schedule', name: 'Tobias Moreno', slots: [{ days: [], from: '9:00', to: '17:00', activity: 'Busking', location: 'Old Pier' }] },
  { type: 'npc.vitals', name: 'Patron A', state: 'unconscious' },
  { type: 'npc.remove', name: 'Patron A' },
  { type: 'relationship.delta', name: 'Mara Quill', affection: 10, trust: 5 },
  { type: 'relationship.memory', name: 'Mara Quill', text: 'Shared bread on a rainy morning' },
  { type: 'bond.delta', from: 'Mara Quill', to: 'Tobias Moreno', affinity: 20, kind: 'friend' },
  { type: 'goal.set', npc: 'Tobias Moreno', text: 'Find a singer', target: 'Copper Kettle' },
  { type: 'org.upsert', name: 'Merchants Guild', orgType: 'guild' },
  { type: 'org.upsert', name: 'The Ravens', location: 'Old Pier' },
  (s) => ({ type: 'org.set', id: idOf(s.orgs as any, 'The Ravens'), patch: { purpose: 'Smuggling' } }),
  { type: 'org.standing', name: 'Merchants Guild', delta: 10 },
  { type: 'org.member', org: 'The Ravens', npc: 'Tobias Moreno', rank: 'Lookout' },
  { type: 'org.runin', org: 'The Ravens', text: 'Caught snooping at the pier' },
  { type: 'org.rule', org: 'The Ravens', text: 'Never talk to the watch' },
  { type: 'org.influence', org: 'The Ravens', location: 'Old Pier', strength: 60 },
  (s) => ({ type: 'org.remove', id: idOf(s.orgs as any, 'The Ravens') }),
  // ---- story
  { type: 'quest.add', title: 'Find the Lute', objectives: ['Ask Tobias'] },
  { type: 'quest.update', title: 'Find the Lute', status: 'active' },
  { type: 'quest.add', title: 'Scratch quest' },
  { type: 'quest.remove', title: 'Scratch quest' },
  { type: 'databank.add', title: 'Millbrook', text: 'A mill town on a slow river' },
  (s) => ({ type: 'databank.update', id: Object.keys(s.databank)[0], text: 'A mill town on a slow, brown river' }),
  (s) => ({ type: 'databank.remove', id: Object.keys(s.databank)[0] }),
  { type: 'thread.add', text: 'The missing ferryman', turn: 1, pace: 0.4 },
  { type: 'thread.resolve', text: 'The missing ferryman' },
  { type: 'event.add', title: 'Gig night', inMinutes: 60 * 30 },
  { type: 'event.add', title: 'Scratch event', inMinutes: 60 },
  { type: 'event.remove', title: 'Scratch event' },
  { type: 'world.log', text: 'The bridge is out', kind: 'rumor' },
  { type: 'world.seen' },
  { type: 'phone.notify', npc: 'Mara Quill', reason: 'a delivery came in' },
  { type: 'phone.read', npc: 'Mara Quill' },
  { type: 'activity', kind: 'rest', hours: 1 },
  { type: 'patch', patches: [] },
  // ---- economy
  { type: 'currency.define', name: 'Elven Crowns', symbol: 'ec', rate: 5 },
  { type: 'currency.exchange', from: 'main', to: 'Elven Crowns', amount: 50 },
  { type: 'shop.upsert', name: 'Copper Kettle', kind: 'general', npc: 'Mara Quill', location: 'Copper Kettle', org: 'Merchants Guild', open: 8 * 60, close: 20 * 60 },
  { type: 'shop.buy', shop: 'Copper Kettle', item: 'Torch', qty: 2 },
  { type: 'shop.sell', shop: 'Copper Kettle', item: 'Torch', qty: 1 },
  { type: 'shop.haggle', shop: 'Copper Kettle' },
  { type: 'trade.exchange', npc: 'Mara Quill', give: [{ name: 'Torch', qty: 1 }], pay: 30, receive: [{ name: 'Enchanted Lute', qty: 1, value: 25 }] },
  { type: 'location.move', to: 'Guild Bank' },
  { type: 'bank.open', name: 'Savings', bank: 'Guild Bank', apr: 0.05 },
  { type: 'bank.deposit', amount: 50 },
  { type: 'bank.withdraw', amount: 20 },
  { type: 'loan.take', lender: 'Merchants Guild', amount: 100, apr: 0, periodDays: 10, installments: 2 },
  { type: 'bill.add', name: 'Guild dues', kind: 'dues', amount: 5, periodDays: 30, org: 'Merchants Guild' },
  { type: 'bill.set', bill: 'Guild dues', autopay: true },
  { type: 'bill.pay', bill: 'Guild dues' },
  { type: 'asset.add', name: 'Chestnut Horse', kind: 'vehicle', value: 60, buy: false },
  { type: 'asset.sell', name: 'Chestnut Horse' },
  // ---- home and crafting
  { type: 'home.add', name: 'Rose Cottage', kind: 'house', location: 'Rose Cottage' },
  { type: 'home.update', home: 'Rose Cottage', primary: true },
  { type: 'room.add', home: 'Rose Cottage', name: 'Pantry', amenities: ['hearth'] },
  { type: 'room.update', home: 'Rose Cottage', room: 'Pantry', upgrade: true },
  { type: 'storage.add', home: 'Rose Cottage', name: 'Cellar', capacity: 30 },
  { type: 'location.move', to: 'Rose Cottage' },
  (s) => ({ type: 'item.move', name: 'Bread', to: Object.values(s.homes).find((h) => h.name === 'Rose Cottage')!.storage[0]!.id }),
  { type: 'household.add', name: 'Grandma Ilse', home: 'Rose Cottage', role: 'head', relation: 'grandparent' },
  { type: 'household.update', member: 'Grandma Ilse', relation: 'great-aunt' },
  { type: 'household.remove', member: 'Grandma Ilse' },
  { type: 'home.add', name: 'Tent', kind: 'campsite' },
  { type: 'home.remove', home: 'Tent' },
  { type: 'home.invite', npc: 'Mara Quill', hours: 2 },
  { type: 'item.add', name: 'Flour', qty: 2 },
  { type: 'recipe.add', name: 'Flatbread', discipline: 'cooking', ingredients: [{ name: 'Flour', qty: 1 }], result: { name: 'Flatbread', category: 'food' } },
  { type: 'craft', recipe: 'Flatbread' },
  { type: 'recipe.remove', recipe: 'Flatbread' },
  // ---- party and progression
  { type: 'party.add', name: 'Mara Quill', role: 'Healer' },
  { type: 'party.add', name: 'Tobias Moreno', role: 'Bard' },
  { type: 'party.update', name: 'Mara Quill', sovereign: true },
  { type: 'party.leader', name: 'Mara Quill' },
  { type: 'party.formation', name: 'Tobias Moreno', row: 'back' },
  { type: 'party.tactics', name: 'Mara Quill', roleKind: 'healer', preset: 'heal-first' },
  { type: 'party.meta', xpSources: { quests: false } },
  { type: 'party.vital', name: 'Tobias Moreno', label: 'Nerve', max: 50 },
  { type: 'party.injury', name: 'Tobias Moreno', injury: 'Sprained wrist' },
  { type: 'party.remove', name: 'Tobias Moreno' },
  { type: 'class.define', name: 'Bard', growth: { mag: 1, spd: 2 } },
  { type: 'class.set', class: 'Bard' },
  { type: 'skillnode.add', name: 'Lullaby', class: 'Bard', kind: 'debuff', element: 'sound', target: 'all' },
  { type: 'xp.add', amount: 400 },
  { type: 'skill.learn', skill: 'Lullaby' },
  { type: 'stats.spend', stat: 'hp', points: 1 },
  { type: 'battle.start', enemies: [{ name: 'Wolf', level: 1, count: 2 }] },
  (s) => ({ type: 'battle.action', action: 'attack', target: Object.keys(s.battle!.combatants).find((k) => k.startsWith('enemy_')) }),
  { type: 'battle.end' },
  // ---- communication
  { type: 'mail.send', to: 'Mara Quill', subject: 'Hello', body: 'Are you well?', courier: 'post' },
  { type: 'mail.receive', from: 'Mara Quill', subject: 'News', body: 'The bridge is out.' },
  { type: 'time.advance', minutes: 7 * 24 * 60 },
  (s) => ({ type: 'mail.read', id: Object.values(s.mail).at(-1)!.id }),
  (s) => ({ type: 'mail.write', id: Object.values(s.mail).at(-1)!.id, body: 'Thank you for telling me.' }),
  (s) => ({ type: 'mail.delete', id: Object.values(s.mail)[0]!.id }),
  { type: 'feed.post', author: 'Mara Quill', text: 'Fresh bread today!' },
  (s) => ({ type: 'feed.like', id: s.feed[0]!.id }),
  (s) => ({ type: 'feed.comment', id: s.feed[0]!.id, text: 'Saving me a loaf?' }),
  { type: 'phone.group', name: 'Kettle crew', members: ['Mara Quill', 'Tobias Moreno'] },
  { type: 'phone.app', name: 'Tide tables', prompt: 'High and low tide times for the coast' },
  // ---- stage
  { type: 'fx.play', effect: 'flash' },
  { type: 'stage.layer', character: 'Mara Quill', position: 'left', expression: 'joy', anim: 'bounce' },
  { type: 'stage.clear' },
  { type: 'cutscene.add', name: 'Dawn', steps: [{ text: 'Light over the river.' }] },
  { type: 'cutscene.play', name: 'Dawn' },
  { type: 'cutscene.stop' },
  { type: 'cutscene.remove', name: 'Dawn' },
  { type: 'music.set', mood: 'calm' },
  { type: 'ambient.set', kind: 'rain' },
  { type: 'avatar.pose', who: 'Mara', pose: 'sit' },
  { type: 'avatar.emote', who: 'Mara', emote: 'wave' },
  { type: 'avatar.outfit', who: 'Mara', outfit: 'Rain gear' },
  // ---- transit
  { type: 'location.move', to: 'Millbrook' },
  { type: 'transit.add', name: 'River Coach', mode: 'caravan', stops: ['Millbrook', 'Eastport'], first: '06:00', last: '22:00', every: 60, hop: 40, fare: 3 },
  { type: 'transit.ticket', line: 'River Coach', qty: 1 },
  { type: 'transit.ride', line: 'River Coach', to: 'Eastport' },
  { type: 'transit.add', name: 'Ferry', mode: 'boat', stops: ['Eastport', 'Millbrook'] },
  { type: 'transit.remove', line: 'Ferry' },
  { type: 'ext.op', ext: 'town-rep', name: 'change', args: { town: 'Eastport', amount: 12 } },
  // ---- sleep last: the long tick runs bills, mail, restocks, schedules
  { type: 'activity', kind: 'sleep', hours: 8 },
];

describe('every op rolls back exactly', () => {
  it('each step’s inverse restores the state before it', () => {
    let s = createInitialState({ seed: 7, playerName: 'Anala' });
    const done = new Set<string>();
    const failures: string[] = [];
    for (const [i, step] of STEPS.entries()) {
      let raw: Record<string, unknown>;
      try {
        raw = typeof step === 'function' ? step(s) : step;
      } catch (e) {
        failures.push(`#${i} (step ${String(step).slice(6, 60)}): ${(e as Error).message}`);
        continue;
      }
      const parsed = (OpSchemas as any)[raw.type as string]?.safeParse(raw);
      if (!parsed?.success) {
        failures.push(`#${i} ${raw.type}: invalid (${parsed?.error?.issues?.[0]?.message ?? 'unknown type'})`);
        continue;
      }
      const before = structuredClone(s);
      const r = applyOps(s, [parsed.data as Op], { source: 'user' });
      if (r.errors.length) {
        failures.push(`#${i} ${raw.type}: ${JSON.stringify(r.errors[0])}`);
        continue;
      }
      expect(invertOps(r.state, r.inverses)).toEqual(before);
      done.add(raw.type as string);
      s = r.state;
    }
    expect(failures).toEqual([]);
    const missing = Object.keys(OpSchemas).filter((t) => !done.has(t));
    expect(missing).toEqual([]);
  });
});

describe('upgrade pins (diffToPatches)', () => {
  it('a patch op built from the diff turns one state into the other, and rolls back', () => {
    const a = createInitialState({ seed: 3, style: 'fantasy' });
    let b = applyOps(a, [{ type: 'item.add', name: 'Rope', qty: 2 } as Op, { type: 'bar.delta', id: 'hp', delta: -7 } as Op, { type: 'quest.add', title: 'Climb' } as Op], { source: 'user' }).state;
    b = { ...b, counters: { ...b.counters } };
    delete (b.counters as Record<string, number>).nope;
    const patches = diffToPatches(a, b);
    expect(patches.length).toBeGreaterThan(0);
    const r = applyOps(a, [{ type: 'patch', patches } as Op], { source: 'system' });
    expect(r.errors).toEqual([]);
    expect(r.state).toEqual(b);
    expect(invertOps(r.state, r.inverses)).toEqual(a);
    expect(diffToPatches(b, b)).toEqual([]);
  });
});
