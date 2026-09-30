import { describe, expect, it } from 'vitest';
import {
  applyOp,
  applyOps,
  createInitialState,
  formatMoney,
  haggle,
  installment,
  invertOps,
  migrateState,
  OpSchemas,
  priceFactor,
  validateOps,
  type OpType,
  shopOpen,
  tradeAccepted,
  type CampaignState,
  type Op,
} from '../src/index.js';

const DAY = 1440;

function world(style: 'fantasy' | 'modern' = 'fantasy'): CampaignState {
  let s = createInitialState({ style, seed: 42 });
  const r = applyOps(
    s,
    ([
      { type: 'location.upsert', name: 'Millbrook', level: 'local', kind: 'town' },
      { type: 'location.upsert', name: 'Copper Kettle', level: 'local', kind: 'shop', parent: 'Millbrook' },
      { type: 'location.upsert', name: 'Guild Bank', level: 'local', kind: 'bank', parent: 'Millbrook' },
      { type: 'location.move', to: 'Copper Kettle' },
      { type: 'npc.upsert', name: 'Mara Quill', location: 'Copper Kettle', role: 'Shopkeeper' },
      { type: 'org.upsert', name: 'Merchants Guild', orgType: 'guild' },
      { type: 'shop.upsert', name: 'Copper Kettle', kind: 'general', npc: 'Mara Quill', location: 'Copper Kettle', org: 'Merchants Guild', open: 8 * 60, close: 20 * 60 },
    ] as unknown[]).map(v),
    { source: 'user' },
  );
  expect(r.errors).toEqual([]);
  s = r.state;
  return s;
}
// Ops go through the same validation as the server (schema defaults included).
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

describe('money', () => {
  it('formats with denominations (fantasy) or a symbol', () => {
    const f = createInitialState({ style: 'fantasy' });
    expect(formatMoney(f, 12.34)).toBe('12g 3s 4c');
    expect(formatMoney(f, 0.05)).toBe('5c');
    expect(formatMoney(f, 0)).toBe('0c');
    const m = createInitialState({ style: 'modern' });
    expect(formatMoney(m, 12.5)).toBe('$12.50');
    expect(formatMoney(m, 7)).toBe('$7');
    expect(formatMoney(createInitialState({ style: 'scifi' }), 40)).toBe('40 cr');
  });

  it('exchanges between currencies with a 2% fee, never going negative', () => {
    let s = world();
    s = ok(s, { type: 'currency.define', name: 'Elven Crowns', symbol: 'ec', rate: 5 });
    s = ok(s, { type: 'currency.exchange', from: 'main', to: 'Elven Crowns', amount: 50 });
    expect(s.player.currency).toBe(50);
    expect(Object.values(s.economy.wallet)).toEqual([9.8]);
    expect(err(s, { type: 'currency.exchange', from: 'ec', to: 'main', amount: 100 })).toMatch(/Not enough/);
  });
});

describe('banking', () => {
  it('needs a bank (or the app outside fantasy), and adds daily compound interest over whole days', () => {
    let s = world();
    s = ok(s, { type: 'bank.open', name: 'Savings', bank: 'Guild Bank', apr: 0.365 });
    expect(err(s, { type: 'bank.deposit', amount: 50 })).toMatch(/at a bank/);
    expect(err(s, { type: 'bank.deposit', amount: 50, via: 'app' })).toMatch(/no banking app/);
    s = ok(s, { type: 'location.move', to: 'Guild Bank' });
    s = ok(s, { type: 'bank.deposit', amount: 50 });
    expect(s.player.currency).toBe(50);
    s = ok(s, { type: 'time.advance', minutes: 10 * DAY });
    // 50 × (1.001^10 − 1) = 0.5022…
    expect(s.economy.accounts[Object.keys(s.economy.accounts)[0]!]!.balance).toBe(50.5);
    s = ok(s, { type: 'bank.withdraw', amount: 20 });
    expect(s.player.currency).toBe(70);
    expect(err(s, { type: 'bank.withdraw', amount: 1000 })).toMatch(/only holds/);
    let m = world('modern');
    m = ok(m, { type: 'bank.open', name: 'Checking', bank: 'Guild Bank' });
    expect(err(m, { type: 'bank.deposit', amount: 10, via: 'app' })).toBeUndefined();
  });

  it('amortizes loans into equal installments paid automatically', () => {
    expect(installment(1200, 0, 30, 12)).toBe(100);
    expect(installment(1000, 0.12, 30, 6)).toBeCloseTo(172.9, 0);
    let s = world();
    s.player.currency = 0;
    s = ok(s, { type: 'loan.take', lender: 'Merchants Guild', amount: 100, apr: 0, periodDays: 10, installments: 2 });
    expect(s.player.currency).toBe(100);
    s = ok(s, { type: 'time.advance', minutes: 10 * DAY });
    s = ok(s, { type: 'time.advance', minutes: 10 * DAY });
    const loan = Object.values(s.economy.loans)[0]!;
    expect(loan.status).toBe('paid');
    expect(s.player.currency).toBe(0);
  });
});

describe('bills', () => {
  it('autopays when it can; otherwise warns, then adds a late fee and costs standing, then evicts', () => {
    let s = world();
    s = ok(s, { type: 'home.add', name: 'Loft over the Kettle', kind: 'apartment', location: 'Copper Kettle', ownership: 'rented', rent: 10, periodDays: 7 });
    const home = Object.values(s.homes)[0]!;
    const bill = s.economy.bills[home.billId!]!;
    s = ok(s, { type: 'item.add', name: 'Silver Locket', qty: 1 });
    s = ok(s, { type: 'item.move', name: 'Silver Locket', to: home.storage[0]!.id });
    s.player.currency = 0;
    s = ok(s, { type: 'time.advance', minutes: 7 * DAY });
    expect(s.economy.bills[bill.id]!.missed).toBe(1);
    expect(s.worldLog.at(-1)!.text).toMatch(/overdue/);
    s = ok(s, { type: 'time.advance', minutes: 7 * DAY });
    expect(s.economy.bills[bill.id]!.missed).toBe(2);
    expect(s.economy.bills[bill.id]!.owed).toBe(11);
    s = ok(s, { type: 'time.advance', minutes: 7 * DAY });
    expect(s.homes[home.id]!.ownership).toBe('lost');
    expect(s.economy.bills[bill.id]!.status).toBe('ended');
    // What was stored there comes back to the player.
    expect(Object.values(s.inventory).find((i) => i.name === 'Silver Locket')!.holder).toBeNull();
  });

  it('paying catches up late fees and resets the ladder; autopay uses the wallet then accounts', () => {
    let s = world();
    s = ok(s, { type: 'bill.add', name: 'Guild dues', kind: 'dues', amount: 5, periodDays: 30, org: 'Merchants Guild' });
    const id = Object.keys(s.economy.bills)[0]!;
    s.player.currency = 0;
    s = ok(s, { type: 'time.advance', minutes: 60 * DAY });
    expect(s.economy.bills[id]!.missed).toBe(2);
    expect(Object.values(s.orgs)[0]!.standing).toBe(45);
    s.player.currency = 100;
    s = ok(s, { type: 'bill.pay', bill: 'Guild dues' });
    expect(s.player.currency).toBe(100 - 5 - 5.5);
    expect(s.economy.bills[id]!.missed).toBe(0);
    s = ok(s, { type: 'bill.set', bill: 'Guild dues', autopay: true });
    s = ok(s, { type: 'time.advance', minutes: 30 * DAY });
    expect(s.economy.bills[id]!.missed).toBe(0);
  });
});

describe('assets', () => {
  it('a business pays out on schedule; upkeep becomes a bill; vehicles give travel modes', () => {
    let s = world();
    s = ok(s, { type: 'asset.add', name: 'Riverside Bakery', kind: 'business', value: 200, income: 15, upkeep: 5, periodDays: 7, buy: false });
    s = ok(s, { type: 'asset.add', name: 'Chestnut Horse', kind: 'animal', value: 40, buy: true });
    expect(s.player.currency).toBe(60);
    const bakeryBill = Object.values(s.economy.bills).find((b) => b.name.startsWith('Riverside Bakery'))!;
    expect(bakeryBill.autopay).toBe(true);
    s = ok(s, { type: 'time.advance', minutes: 14 * DAY });
    expect(s.player.currency).toBe(60 + 30 - 10);
    expect(Object.values(s.economy.assets).find((a) => a.name === 'Chestnut Horse')!.modes).toEqual(['horse']);
    s = ok(s, { type: 'asset.sell', name: 'Chestnut Horse' });
    expect(s.player.currency).toBe(80 + 28);
  });
});

describe('shops', () => {
  it('opens by the clock, stocks by genre, and refuses when closed or elsewhere', () => {
    let s = world();
    const shop = Object.values(s.economy.shops)[0]!;
    expect(Object.values(shop.stock).map((x) => x.name)).toContain('Torch');
    expect(shopOpen(s, shop)).toBe(true); // 08:00
    s = ok(s, { type: 'time.until', hour: 21 });
    expect(err(s, { type: 'shop.buy', shop: 'Copper Kettle', item: 'Torch' })).toMatch(/closed/);
    s = ok(s, { type: 'time.until', hour: 9 });
    s = ok(s, { type: 'location.move', to: 'Guild Bank' });
    expect(err(s, { type: 'shop.buy', shop: 'Copper Kettle', item: 'Torch' })).toMatch(/is at Copper Kettle/);
  });

  it('prices follow standing, the shopkeeper and reputation; selling pays about half', () => {
    let s = world();
    const shop = () => Object.values(s.economy.shops)[0]!;
    expect(priceFactor(s, shop(), 'buy')).toBe(1);
    expect(priceFactor(s, shop(), 'sell')).toBe(0.5);
    s = ok(s, { type: 'org.standing', name: 'Merchants Guild', set: 100 });
    s = ok(s, { type: 'relationship.delta', name: 'Mara Quill', affection: 50 });
    expect(priceFactor(s, shop(), 'buy')).toBe(0.7);
    expect(priceFactor(s, shop(), 'sell')).toBe(0.65);
    s = ok(s, { type: 'shop.buy', shop: 'Copper Kettle', item: 'Torch', qty: 10 });
    expect(s.player.currency).toBe(100 - 1.4);
    expect(Object.values(s.inventory).find((i) => i.name === 'Torch')!.qty).toBe(10);
    expect(err(s, { type: 'shop.buy', shop: 'Copper Kettle', item: 'Torch' })).toMatch(/only has 0/);
    s = ok(s, { type: 'shop.sell', shop: 'Copper Kettle', item: 'Torch', qty: 4 });
    expect(s.player.currency).toBeCloseTo(99.12, 2);
    // Restock after the shop's interval.
    s = ok(s, { type: 'time.advance', minutes: 3 * DAY });
    expect(shop().stock['torch']!.qty).toBe(10);
  });

  it('haggling is one seeded check per shop per day, the same on every replay', () => {
    const s = world();
    const shop = structuredClone(Object.values(s.economy.shops)[0]!);
    const a = haggle(structuredClone(s), structuredClone(shop));
    const b = haggle(structuredClone(s), structuredClone(shop));
    expect(a).toEqual(b);
    const s2 = ok(s, { type: 'shop.haggle', shop: 'Copper Kettle' });
    expect(err(s2, { type: 'shop.haggle', shop: 'Copper Kettle' })).toMatch(/already haggled/);
    const f = priceFactor(s2, Object.values(s2.economy.shops)[0]!, 'buy');
    expect(f).toBe(Math.round((2 - Object.values(s2.economy.shops)[0]!.haggle!.mult) * 100) / 100);
  });
});

describe('trade', () => {
  it('accepts fair offers, more generously from people who like you', () => {
    expect(tradeAccepted(10, 10, 0).ok).toBe(true);
    expect(tradeAccepted(8, 10, 0).ok).toBe(false);
    expect(tradeAccepted(8, 10, 80).ok).toBe(true); // 20% goodwill
    let s = world();
    s = ok(s, { type: 'item.add', name: 'Iron Sword', qty: 1, category: 'weapon', value: 15 });
    expect(err(s, { type: 'trade.exchange', npc: 'Mara Quill', give: [{ name: 'Iron Sword', qty: 1 }], pay: 0, receive: [{ name: 'Enchanted Lute', qty: 1, value: 40 }] })).toMatch(/turns it down: the offer is unfair/);
    s = ok(s, { type: 'trade.exchange', npc: 'Mara Quill', give: [{ name: 'Iron Sword', qty: 1 }], pay: 25, receive: [{ name: 'Enchanted Lute', qty: 1, value: 40 }] });
    expect(Object.values(s.inventory).map((i) => i.name)).toEqual(['Enchanted Lute']);
    expect(s.player.currency).toBe(75);
  });
});

describe('item holders', () => {
  it('moves items between you, the party bag, a member and home storage (at home, within capacity)', () => {
    let s = world();
    s = ok(s, { type: 'party.add', name: 'Bram', role: 'guard' });
    s = ok(s, { type: 'location.upsert', name: 'Riverside Camp', level: 'local', kind: 'wilds', parent: 'Millbrook' });
    s = ok(s, { type: 'home.add', name: 'Camp', kind: 'campsite', location: 'Riverside Camp' });
    const store = Object.values(s.homes)[0]!.storage[0]!;
    s = ok(s, { type: 'item.add', name: 'Rope', qty: 3 });
    s = ok(s, { type: 'item.move', name: 'Rope', qty: 1, to: 'party' });
    s = ok(s, { type: 'item.move', name: 'Rope', qty: 1, to: 'Bram' });
    const holders = Object.values(s.inventory).map((i) => [i.holder ?? null, i.qty]);
    expect(holders).toEqual(expect.arrayContaining([[null, 1], ['party', 1], [expect.stringMatching(/^member:/), 1]]));
    expect(err(s, { type: 'item.move', name: 'Rope', to: store.id })).toMatch(/need to be at Camp/);
    s = ok(s, { type: 'location.move', to: 'Riverside Camp' });
    for (let i = 0; i < 4; i++) s = ok(s, { type: 'item.add', name: `Stone ${i}`, qty: 1 });
    for (let i = 0; i < 4; i++) s = ok(s, { type: 'item.move', name: `Stone ${i}`, to: store.id });
    s = ok(s, { type: 'item.add', name: 'Stone 9', qty: 1 });
    expect(err(s, { type: 'item.move', name: 'Stone 9', to: store.id })).toMatch(/full \(4 stacks\)/);
  });
});

describe('rollback', () => {
  it('every economy op is undone exactly by its inverse', () => {
    const s0 = world();
    const ops: unknown[] = [
      { type: 'currency.define', name: 'Crowns', symbol: 'cr', rate: 2 },
      { type: 'currency.exchange', from: 'main', to: 'Crowns', amount: 10 },
      { type: 'shop.buy', shop: 'Copper Kettle', item: 'Torch', qty: 2 },
      { type: 'shop.sell', shop: 'Copper Kettle', item: 'Torch', qty: 1 },
      { type: 'shop.haggle', shop: 'Copper Kettle' },
      { type: 'bill.add', name: 'Rent', kind: 'rent', amount: 5, periodDays: 1 },
      { type: 'asset.add', name: 'Cart', kind: 'vehicle', value: 10, income: 2, periodDays: 1 },
      { type: 'loan.take', lender: 'Merchants Guild', amount: 50, periodDays: 1, installments: 2 },
      { type: 'time.advance', minutes: 3 * DAY },
      { type: 'item.add', name: 'Rope', qty: 2 },
      { type: 'item.move', name: 'Rope', qty: 1, to: 'party' },
      { type: 'trade.exchange', npc: 'Mara Quill', give: [], pay: 5, receive: [{ name: 'Apple', qty: 1, value: 1 }] },
    ];
    const r = applyOps(s0, ops.map(v), { source: 'user' });
    expect(r.errors).toEqual([]);
    expect(invertOps(r.state, r.inverses)).toEqual(s0);
  });
});

describe('migration', () => {
  it('a Phase 2 campaign gains the economy without losing anything', () => {
    const old: any = createInitialState({ style: 'modern' });
    old.version = 2;
    for (const k of ['economy', 'homes', 'household', 'recipes', 'transit', 'travelLog', 'classes', 'skillTree', 'partyMeta', 'mail', 'feed']) delete old[k];
    old.party = { p1: { id: 'p1', name: 'Iris', npcId: null, characterId: null, role: 'support', level: 3, hp: 40, maxHp: 50, mp: 10, maxMp: 10, stats: { atk: 5, def: 5, spd: 5, mag: 5 }, equipment: {}, skills: [], sovereign: true } };
    old.inventory = { it: { id: 'it', name: 'Phone', category: 'tool', qty: 1, desc: '', icon: '', value: 100, equipped: false, slot: null, effects: {}, stats: {}, containerId: null, locked: false, tags: [], addedAt: 0 } };
    old.player.currency = 321;
    delete old.player.reputation;
    const s = migrateState(structuredClone(old));
    expect(s.version).toBe(3);
    expect(s.player.currency).toBe(321);
    expect(s.player.reputation).toBe(0);
    expect(s.economy.denominations).toEqual([]);
    expect(s.party.p1).toMatchObject({ name: 'Iris', level: 3, hp: 40, sovereign: true, row: 'front', active: true });
    expect(s.inventory.it).toMatchObject({ name: 'Phone', holder: null });
    expect(s.partyMeta).toEqual({ leader: 'player', maxActive: 4 });
  });
});
