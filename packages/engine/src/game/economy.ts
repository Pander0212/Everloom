/**
 * Economy: currencies and denominations, the ledger, banking and interest, loans, recurring bills
 * with missed-payment consequences, owned assets (upkeep and income), shops (hours, stock,
 * restocking, pricing by standing and haggling) and trade. Code keeps every number; the model only
 * narrates. All randomness is seeded from the state, so a replay gives the same result.
 */
import { clamp } from '../util/clamp.js';
import { createRng, seedFrom } from '../util/rng.js';
import { normalizeName, slugify } from '../util/text.js';
import { OpError } from './errors.js';
import { defaultEffects, defaultSlot, guessCategory, iconForItem } from './items.js';
import { findExact, findFuzzy, findItem, findNpc, nextCounter, uniqueId } from './resolve.js';
import type { Change } from './simulate.js';
import type { Account, Bill, BillKind, CampaignState, Denomination, Item, ItemCategory, Shop, ShopKind, ShopStock, Style } from './state.js';
import { checkOdds, tierFor } from './tick.js';
import { MIN_PER_DAY } from './calendar.js';

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const dayOf = (minute: number) => Math.floor(minute / MIN_PER_DAY);

// ------------------------------------------------------------------ money

/** "12g 3s 4c" with denominations, else "$12.34" / "12.34 cr". */
export function formatMoney(s: Pick<CampaignState, 'meta' | 'economy'>, amount: number): string {
  const neg = amount < 0;
  let rest = Math.round(Math.abs(amount) * 100);
  const den: Denomination[] = s.economy?.denominations ?? [];
  if (den.length > 1) {
    const parts: string[] = [];
    for (const d of [...den].sort((a, b) => b.value - a.value)) {
      const unit = Math.round(d.value * 100);
      if (unit <= 0) continue;
      const n = Math.floor(rest / unit);
      rest -= n * unit;
      if (n) parts.push(`${n}${d.symbol}`);
    }
    return `${neg ? '−' : ''}${parts.join(' ') || `0${den[den.length - 1]!.symbol}`}`;
  }
  const sym = s.meta.currency.symbol;
  const num = (rest / 100).toFixed(rest % 100 ? 2 : 0);
  return `${neg ? '−' : ''}${sym.length === 1 && /[$€£¥₹]/.test(sym) ? `${sym}${num}` : `${num} ${sym}`}`;
}

export function ledger(s: CampaignState, text: string, amount: number, where = 'wallet') {
  const n = nextCounter(s.counters, 'ledger');
  s.economy.ledger.push({ id: `tx_${n}`, at: s.time.minutes, text, amount: round2(amount), where });
  if (s.economy.ledger.length > 300) s.economy.ledger.splice(0, s.economy.ledger.length - 300);
}

/** Take money from the wallet; refuses (no partial payment) when there isn't enough. */
export function pay(s: CampaignState, amount: number, text: string, changes?: Change[]) {
  const a = round2(amount);
  if (a <= 0) return;
  if (s.player.currency + 1e-9 < a) throw new OpError(`Not enough money: ${formatMoney(s, a)} needed, ${formatMoney(s, s.player.currency)} in hand`);
  s.player.currency = round2(s.player.currency - a);
  ledger(s, text, -a);
  changes?.push({ key: 'currency', label: s.meta.currency.name, delta: -a, kind: 'currency' });
}

export function receive(s: CampaignState, amount: number, text: string, changes?: Change[]) {
  const a = round2(amount);
  if (a <= 0) return;
  s.player.currency = round2(s.player.currency + a);
  ledger(s, text, a);
  changes?.push({ key: 'currency', label: s.meta.currency.name, delta: a, kind: 'currency' });
}

/** Amount in main-currency units for an extra currency (or the main one: 'main'). */
export function toMain(s: CampaignState, currencyId: string, amount: number): number {
  if (currencyId === 'main') return amount;
  const c = s.economy.currencies[currencyId];
  if (!c) throw new OpError(`Unknown currency "${currencyId}"`);
  return amount * c.rate;
}

export const EXCHANGE_FEE = 0.02;

export function exchange(s: CampaignState, from: string, to: string, amount: number, changes: Change[]) {
  if (from === to) throw new OpError('Pick two different currencies');
  const a = round2(amount);
  if (a <= 0) throw new OpError('Amount must be positive');
  const bal = from === 'main' ? s.player.currency : (s.economy.wallet[from] ?? 0);
  if (bal + 1e-9 < a) throw new OpError('Not enough of that currency');
  const mainValue = toMain(s, from, a) * (1 - EXCHANGE_FEE);
  const got = round2(to === 'main' ? mainValue : mainValue / s.economy.currencies[to]!.rate);
  if (from === 'main') s.player.currency = round2(s.player.currency - a);
  else s.economy.wallet[from] = round2(bal - a);
  if (to === 'main') s.player.currency = round2(s.player.currency + got);
  else s.economy.wallet[to] = round2((s.economy.wallet[to] ?? 0) + got);
  const name = (id: string) => (id === 'main' ? s.meta.currency.name : s.economy.currencies[id]!.name);
  ledger(s, `Exchanged ${a} ${name(from)} for ${got} ${name(to)}`, from === 'main' ? -a : to === 'main' ? got : 0);
  changes.push({ key: 'exchange', label: 'Exchange', text: `${a} ${name(from)} → ${got} ${name(to)}`, kind: 'text' });
}

// ------------------------------------------------------------------ banking

export function atBank(s: CampaignState, account?: Account): boolean {
  const here = s.currentLocationId ? s.locations[s.currentLocationId] : null;
  if (!here) return false;
  if (account?.bankLocationId && account.bankLocationId === here.id) return true;
  return here.kind === 'bank' || here.tags.some((t) => /bank/i.test(t)) || /\bbank\b/i.test(here.name);
}

/** Banking needs a bank, or the phone app outside fantasy settings. */
export function canBank(s: CampaignState, account: Account | undefined, via: 'branch' | 'app'): string | null {
  if (via === 'app') return s.meta.style === 'fantasy' ? 'There is no banking app in this world; visit a bank.' : null;
  return atBank(s, account) ? null : 'You need to be at a bank.';
}

/** Daily compound interest on savings, for whole game days since the last accrual. */
export function accrueInterest(s: CampaignState, to: number) {
  const day = dayOf(to);
  for (const a of Object.values(s.economy.accounts)) {
    const days = day - a.lastAccrued;
    if (days <= 0) continue;
    a.lastAccrued = day;
    if (a.apr <= 0 || a.balance <= 0) continue;
    const gained = round2(a.balance * (Math.pow(1 + a.apr / 365, days) - 1));
    if (gained > 0) {
      a.balance = round2(a.balance + gained);
      ledger(s, `Interest on ${a.name}`, gained, a.id);
    }
  }
}

/** Equal installments that pay off `principal` at `apr` over `n` periods of `periodDays`. */
export function installment(principal: number, apr: number, periodDays: number, n: number): number {
  const r = (apr * periodDays) / 365;
  if (r <= 0) return round2(principal / n);
  return round2((principal * r) / (1 - Math.pow(1 + r, -n)));
}

// ------------------------------------------------------------------ bills

export const MISSED_STEPS = ['warning', 'late fee', 'final'] as const;

/**
 * Pays every bill that fell due between `from` and `to` (autopay from the wallet, then the
 * accounts), or applies the consequence ladder: 1st miss a warning, 2nd a late fee (and standing
 * loss with the payee), 3rd eviction or repossession.
 */
export function processBills(s: CampaignState, from: number, to: number, changes: Change[], notify: (text: string) => void) {
  for (const b of Object.values(s.economy.bills)) {
    let guard = 0;
    while (b.status === 'active' && b.nextDue > from && b.nextDue <= to && guard++ < 60) {
      const due = round2(b.amount + b.owed);
      if (b.autopay && tryAutopay(s, due, `${b.name} (automatic)`)) {
        settled(s, b, changes);
      } else missedPayment(s, b, changes, notify);
      b.nextDue += Math.max(1, b.periodDays) * MIN_PER_DAY;
    }
  }
}

function tryAutopay(s: CampaignState, amount: number, text: string): boolean {
  if (s.player.currency + 1e-9 >= amount) {
    s.player.currency = round2(s.player.currency - amount);
    ledger(s, text, -amount);
    return true;
  }
  const acc = Object.values(s.economy.accounts).find((a) => a.balance + 1e-9 >= amount);
  if (!acc) return false;
  acc.balance = round2(acc.balance - amount);
  ledger(s, text, -amount, acc.id);
  return true;
}

function settled(s: CampaignState, b: Bill, changes: Change[]) {
  b.missed = 0;
  b.owed = 0;
  changes.push({ key: `bill:${b.id}`, label: b.name, text: 'paid', kind: 'text' });
  if (b.loanId) {
    const loan = s.economy.loans[b.loanId];
    if (loan) {
      const interest = round2(loan.balance * ((loan.apr * loan.periodDays) / 365));
      loan.balance = round2(Math.max(0, loan.balance + interest - b.amount));
      if (loan.balance <= 0.01) {
        loan.status = 'paid';
        b.status = 'ended';
        changes.push({ key: `loan:${loan.id}`, label: loan.lender, text: 'loan repaid', kind: 'text' });
      }
    }
  }
}

function missedPayment(s: CampaignState, b: Bill, changes: Change[], notify: (text: string) => void) {
  b.missed += 1;
  const step = MISSED_STEPS[Math.min(b.missed, 3) - 1];
  if (step === 'warning') {
    notify(`${b.name} is overdue (${formatMoney(s, b.amount + b.owed)}). Pay soon to avoid a late fee.`);
  } else if (step === 'late fee') {
    const fee = round2(Math.max(0.01, b.amount * 0.1));
    b.owed = round2(b.owed + b.amount + fee);
    const org = b.orgId ? s.orgs[b.orgId] : null;
    if (org) org.standing = clamp(org.standing - 5, 0, 100);
    notify(`${b.name}: second missed payment. A late fee of ${formatMoney(s, fee)} was added${org ? `; ${org.name} thinks less of you` : ''}.`);
  } else {
    b.status = 'ended';
    const home = b.homeId ? s.homes[b.homeId] : null;
    const asset = b.assetId ? s.economy.assets[b.assetId] : null;
    const loan = b.loanId ? s.economy.loans[b.loanId] : null;
    if (home) {
      home.ownership = 'lost';
      home.primary = false;
      for (const it of Object.values(s.inventory)) if (it.holder && home.storage.some((st) => it.holder === `store:${st.id}`)) it.holder = null;
      notify(`Evicted from ${home.name} after three missed payments. What was stored there is back with you.`);
    } else if (asset) {
      asset.status = 'lost';
      notify(`${asset.name} was repossessed after three missed payments.`);
    } else if (loan) {
      loan.status = 'defaulted';
      s.player.reputation = clamp((s.player.reputation ?? 0) - 10, -100, 100);
      notify(`Defaulted on the loan from ${loan.lender}. Your reputation suffers.`);
    } else notify(`${b.name} was cancelled after three missed payments.`);
  }
  changes.push({ key: `bill:${b.id}`, label: b.name, text: `missed (${step})`, kind: 'text' });
}

export function addBill(s: CampaignState, b: Omit<Bill, 'id' | 'missed' | 'owed' | 'status'>): Bill {
  const id = uniqueId(s.economy.bills, 'bill', b.name);
  const bill: Bill = { ...b, id, missed: 0, owed: 0, status: 'active' };
  s.economy.bills[id] = bill;
  return bill;
}

export function payBill(s: CampaignState, b: Bill, changes: Change[]) {
  if (b.status !== 'active') throw new OpError(`${b.name} isn't active`);
  const due = round2(b.amount + b.owed);
  pay(s, due, `Paid ${b.name}`, changes);
  // Paying early covers the next due date.
  if (!b.missed) b.nextDue += Math.max(1, b.periodDays) * MIN_PER_DAY;
  settled(s, b, changes);
}

// ------------------------------------------------------------------ assets

export function processAssets(s: CampaignState, from: number, to: number, changes: Change[]) {
  for (const a of Object.values(s.economy.assets)) {
    let guard = 0;
    while (a.status === 'owned' && a.income > 0 && a.nextPayout > from && a.nextPayout <= to && guard++ < 60) {
      receive(s, a.income, `Income from ${a.name}`, changes);
      a.nextPayout += Math.max(1, a.periodDays) * MIN_PER_DAY;
    }
  }
}

/** Travel modes the player can use because they own, rent or borrow a vehicle or mount. */
export function ownedModes(s: CampaignState): string[] {
  return [...new Set(Object.values(s.economy.assets).filter((a) => a.status !== 'lost').flatMap((a) => a.modes))];
}

// ------------------------------------------------------------------ shops

type Catalog = Array<{ name: string; category: ItemCategory; price: number; qty?: number }>;
const T = (name: string, category: ItemCategory, price: number, qty = 5) => ({ name, category, price, qty });

const CATALOG: Record<Style, Partial<Record<ShopKind, Catalog>>> = {
  fantasy: {
    general: [T('Rope (15 m)', 'tool', 1), T('Torch', 'tool', 0.2, 10), T('Travel Rations', 'food', 0.5, 12), T('Waterskin', 'container', 0.8), T('Bedroll', 'tool', 1.2, 3), T('Backpack', 'container', 2, 3)],
    food: [T('Bread', 'food', 0.05, 20), T('Cheese Wedge', 'food', 0.2, 10), T('Apples', 'food', 0.05, 20), T('Salted Fish', 'food', 0.3, 8), T('Flour', 'material', 0.1, 10), T('Herbs', 'material', 0.1, 10)],
    tavern: [T('Hot Stew', 'food', 0.3, 10), T('Ale', 'drink', 0.1, 20), T('Mulled Wine', 'drink', 0.4, 10), T('Roast Chicken', 'food', 0.8, 6)],
    smith: [T('Iron Sword', 'weapon', 15, 2), T('Hand Axe', 'weapon', 8, 2), T('Leather Armor', 'armor', 10, 2), T('Iron Shield', 'armor', 7, 2), T('Iron Ingot', 'material', 1, 10), T('Whetstone', 'tool', 0.3, 5)],
    alchemist: [T('Healing Potion', 'medicine', 5, 5), T('Mana Tonic', 'consumable', 6, 4), T('Antidote', 'medicine', 3, 4), T('Moonpetal', 'material', 1, 8), T('Empty Vial', 'container', 0.2, 12)],
    clothier: [T('Wool Cloak', 'clothing', 3, 3), T('Linen Shirt', 'clothing', 1, 5), T('Leather Boots', 'clothing', 2.5, 3), T('Travel Hat', 'clothing', 1, 3)],
    books: [T('Map of the Region', 'book', 4, 2), T('Herbalist Primer', 'book', 6, 1), T('Book of Tales', 'book', 2, 3)],
    magic: [T('Arcane Dust', 'material', 3, 6), T('Minor Rune Stone', 'material', 12, 2), T('Scroll of Light', 'consumable', 8, 3)],
    market: [T('Carrots', 'food', 0.03, 30), T('Honey Jar', 'food', 0.5, 6), T('Wool Bundle', 'material', 0.4, 8), T('Clay Pot', 'container', 0.3, 6)],
    stable: [T('Horse Feed', 'material', 0.2, 10), T('Saddle', 'tool', 8, 2)],
  },
  modern: {
    general: [T('Flashlight', 'tool', 12), T('Phone Charger', 'tool', 15), T('Water Bottle', 'drink', 1.5, 20), T('Umbrella', 'tool', 10), T('Backpack', 'container', 35, 3)],
    food: [T('Sandwich', 'food', 6, 10), T('Coffee', 'drink', 3.5, 20), T('Instant Noodles', 'food', 1.5, 20), T('Eggs (dozen)', 'material', 4, 10), T('Rice (1 kg)', 'material', 3, 10), T('Vegetables', 'material', 4, 10)],
    tavern: [T('Burger', 'food', 12, 10), T('Beer', 'drink', 6, 20), T('Cocktail', 'drink', 11, 10), T('Fries', 'food', 5, 10)],
    clothier: [T('Hoodie', 'clothing', 45, 3), T('Jeans', 'clothing', 60, 3), T('Sneakers', 'clothing', 80, 2), T('Rain Jacket', 'clothing', 90, 2)],
    books: [T('City Guide', 'book', 18, 2), T('Paperback Novel', 'book', 12, 4), T('Cookbook', 'book', 25, 2)],
    tech: [T('Earbuds', 'accessory', 40, 3), T('Power Bank', 'tool', 30, 3), T('Used Laptop', 'tool', 350, 1), T('Prepaid SIM', 'tool', 10, 5)],
    pharmacy: [T('Painkillers', 'medicine', 8, 8), T('Bandages', 'medicine', 5, 10), T('Vitamins', 'medicine', 12, 5), T('Energy Drink', 'drink', 3, 12)],
    market: [T('Fresh Fruit', 'food', 5, 12), T('Flowers', 'misc', 15, 5), T('Local Honey', 'food', 9, 5)],
  },
  scifi: {
    general: [T('Ration Pack', 'food', 4, 20), T('Hydration Pouch', 'drink', 2, 20), T('Multitool', 'tool', 45, 3), T('Emergency Beacon', 'tool', 120, 2)],
    food: [T('Synth-Noodles', 'food', 5, 15), T('Protein Bar', 'food', 3, 20), T('Real Coffee', 'drink', 12, 6), T('Algae Flour', 'material', 4, 10)],
    tavern: [T('Station Stew', 'food', 9, 10), T('Nebula Fizz', 'drink', 7, 15), T('Orbital Whisky', 'drink', 25, 6)],
    tech: [T('Datapad', 'tool', 180, 2), T('Stim Injector', 'medicine', 60, 4), T('Shield Cell', 'consumable', 90, 3), T('Plasma Cutter', 'weapon', 400, 1)],
    smith: [T('Pulse Pistol', 'weapon', 650, 1), T('Composite Vest', 'armor', 480, 1), T('Alloy Plate', 'material', 30, 8)],
    pharmacy: [T('Medgel', 'medicine', 40, 6), T('Rad-Away', 'medicine', 55, 4)],
    clothier: [T('Flight Jacket', 'clothing', 140, 2), T('Mag Boots', 'clothing', 220, 2)],
  },
};

export function catalogFor(style: Style, kind: ShopKind): Catalog {
  return CATALOG[style]?.[kind] ?? CATALOG[style]?.general ?? CATALOG.fantasy.general!;
}

function stockEntry(name: string, category: ItemCategory, price: number, qty: number): ShopStock {
  return { id: slugify(name), name, category, basePrice: round2(price), qty, maxQty: qty, desc: '', effects: defaultEffects(name, category), slot: defaultSlot(name, category) };
}

/** Deterministic starting stock for a shop of this kind in this genre. */
export function generateStock(s: CampaignState, kind: ShopKind): Record<string, ShopStock> {
  const out: Record<string, ShopStock> = {};
  for (const c of catalogFor(s.meta.style, kind)) out[slugify(c.name)] = stockEntry(c.name, c.category, c.price, c.qty ?? 5);
  return out;
}

/** Refill stock toward its maximum once every `restockDays` (deterministic, from the game clock). */
export function restockShops(s: CampaignState, to: number) {
  for (const shop of Object.values(s.economy.shops)) {
    if (shop.restockDays <= 0) continue;
    if (dayOf(to) - dayOf(shop.lastRestock) < shop.restockDays) continue;
    shop.lastRestock = to;
    for (const st of Object.values(shop.stock)) st.qty = st.maxQty;
  }
}

export function shopOpen(s: CampaignState, shop: Shop, minute = s.time.minutes): boolean {
  if (shop.open === shop.close) return true;
  const tod = ((minute % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  const cal = s.meta.calendar;
  const weekday = (((dayOf(minute) + cal.epochWeekday) % cal.weekdays.length) + cal.weekdays.length) % cal.weekdays.length;
  if (shop.days.length && !shop.days.includes(weekday)) return false;
  return shop.close > shop.open ? tod >= shop.open && tod < shop.close : tod >= shop.open || tod < shop.close;
}

/**
 * Price multiplier: standing with the shop's organization (±25%), how the shopkeeper feels about
 * you (±10%), your public reputation (±5%) and today's haggling result. Buying costs more than the
 * base price and selling pays half, before those adjustments.
 */
export function priceFactor(s: CampaignState, shop: Shop, side: 'buy' | 'sell'): number {
  const org = shop.orgId ? s.orgs[shop.orgId] : null;
  // Standing runs 0..100 with 50 neutral.
  const standing = org ? (clamp(org.standing, 0, 100) - 50) / 50 : 0;
  const keeper = shop.npcId ? Object.values(s.relationships).find((r) => r.npcId === shop.npcId) : null;
  const liking = keeper ? clamp(keeper.affection, -100, 100) / 100 : 0;
  const rep = clamp(s.player.reputation ?? 0, -100, 100) / 100;
  const goodwill = standing * 0.25 + liking * 0.1 + rep * 0.05;
  const haggle = shop.haggle && shop.haggle.day === dayOf(s.time.minutes) ? shop.haggle.mult : 1;
  return side === 'buy' ? round2(Math.max(0.5, (1 - goodwill) * (2 - haggle))) : round2(Math.min(0.9, 0.5 * (1 + goodwill) * haggle));
}

export function priceOf(s: CampaignState, shop: Shop, base: number, side: 'buy' | 'sell', qty = 1): number {
  return round2(Math.max(0.01, base * priceFactor(s, shop, side)) * qty);
}

/**
 * Haggling: one dice check per shop per day. Level and the shopkeeper's liking help; success makes
 * today's prices 10% better (a critical 20%), failure 5% worse, a critical failure 10% worse.
 */
export function haggle(s: CampaignState, shop: Shop): { tier: string; mult: number; odds: number } {
  const day = dayOf(s.time.minutes);
  if (shop.haggle?.day === day) throw new OpError('You already haggled here today');
  const keeper = shop.npcId ? Object.values(s.relationships).find((r) => r.npcId === shop.npcId) : null;
  const gap = (s.player.level - 1) / 3 + (keeper?.affection ?? 0) / 25 + (s.player.reputation ?? 0) / 50;
  const odds = checkOdds(gap);
  const roll = createRng(seedFrom(s.meta.seed, 'haggle', shop.id, day)).next();
  const tier = tierFor(odds, roll);
  const mult = { 'critical success': 1.2, success: 1.1, failure: 0.95, 'critical failure': 0.9 }[tier];
  shop.haggle = { day, mult };
  return { tier, mult, odds };
}

export function findShop(s: CampaignState, name: string): Shop {
  const shop = s.economy.shops[name] ?? findExact(s.economy.shops, name) ?? findFuzzy(s.economy.shops, name);
  if (!shop) throw new OpError(`Unknown shop "${name}"`);
  return shop;
}

/** You have to be where the shop is (when it has a place), and it has to be open. */
export function assertCanShop(s: CampaignState, shop: Shop) {
  if (shop.locationId && s.currentLocationId !== shop.locationId) throw new OpError(`${shop.name} is at ${s.locations[shop.locationId]?.name ?? 'another place'}`);
  if (!shopOpen(s, shop)) throw new OpError(`${shop.name} is closed now`);
}

export function stockToItem(s: CampaignState, st: ShopStock, qty: number): Omit<Item, 'id'> {
  return {
    name: st.name,
    category: st.category,
    qty,
    desc: st.desc,
    icon: iconForItem(st.name, st.category),
    value: st.basePrice,
    equipped: false,
    slot: st.slot ?? null,
    effects: st.effects ?? {},
    stats: st.stats ?? {},
    containerId: null,
    locked: false,
    tags: [],
    addedAt: s.time.minutes,
    holder: null,
    capacity: st.category === 'container' ? 6 : undefined,
  };
}

// ------------------------------------------------------------------ trade

/** What an item is worth for trading (its value, or a category default). */
export function itemValue(it: Pick<Item, 'value' | 'category'>): number {
  if (it.value > 0) return it.value;
  return { weapon: 10, armor: 10, valuable: 20, tool: 2, book: 3, medicine: 3, clothing: 2, accessory: 5 }[it.category as string] ?? 0.5;
}

/** An NPC accepts when what they get is worth at least what they give, less a discount for goodwill. */
export function tradeAccepted(giveValue: number, getValue: number, affection: number): { ok: boolean; ratio: number } {
  const tolerance = clamp(affection, -100, 100) / 400; // up to 25% generosity (or stinginess)
  const need = getValue * (1 - tolerance);
  return { ok: giveValue + 1e-9 >= need, ratio: getValue > 0 ? giveValue / getValue : Infinity };
}

export function describeFairness(ratio: number): string {
  if (!Number.isFinite(ratio)) return 'a gift';
  if (ratio >= 1.3) return 'generous';
  if (ratio >= 0.95) return 'fair';
  if (ratio >= 0.75) return 'a little low';
  return 'unfair';
}

// ------------------------------------------------------------------ helpers used by several handlers

export function playerItem(s: CampaignState, name: string, holder: string | null = null): Item | undefined {
  const matches = Object.values(s.inventory).filter((i) => (i.holder ?? null) === holder);
  const pool = Object.fromEntries(matches.map((i) => [i.id, i]));
  return pool[name] ?? findItem(pool, name);
}

export function billKindFor(ownership: string): BillKind {
  return ownership === 'rented' ? 'rent' : 'upkeep';
}

export function npcIdByName(s: CampaignState, name: string | undefined | null): string | null {
  if (!name) return null;
  return findNpc(s, name)?.npc.id ?? null;
}

export const normalizeKey = (n: string) => normalizeName(n);
export { guessCategory };
