/**
 * Phase 3 op handlers (economy, homes, crafting). The reducer hands these ops over with a small kit
 * of its own helpers, so time, XP and item creation behave exactly like the rest of the engine.
 */
import { normalizeName, slugify } from '../util/text.js';
import { applyQuality, craftCheck, craftOutcome, DISCIPLINES, findRecipe, QUALITY_MULT, xpForCraftLevel } from './craft.js';
import {
  addBill,
  assertCanShop,
  canBank,
  dayOf,
  describeFairness,
  exchange,
  findShop,
  formatMoney,
  generateStock,
  haggle,
  installment,
  itemValue,
  ledger,
  pay,
  payBill,
  playerItem,
  priceOf,
  receive,
  round2,
  stockToItem,
  tradeAccepted,
} from './economy.js';
import { OpError } from './errors.js';
import { arrive, blockers, carries, checkRequirements, linesAt, logTrip, planTrip, ticketName, ticketPrice } from './journey.js';
import { allClasses, findClass, findNode, learn, learnProblems, xpSourceOn, xpToNext, type Who } from './progress.js';
import { logWorld } from './simulate.js';
import { courierFor, deliveryMinutes, hasEmail, mailKm, newMailId, replyDelay } from './comms.js';
import { MIN_PER_DAY } from './calendar.js';
import { AMENITIES, currentHome, defaultRooms, defaultStorage, findStorage, isAtHome, storedIn } from './home.js';
import { defaultEffects, defaultSlot, guessCategory, iconForItem } from './items.js';
import type { ApplyContext } from './reducer.js';
import type { OpOf, OpType } from './ops.js';
import { findExact, findFuzzy, findItem, findNpc, nextCounter, uniqueId } from './resolve.js';
import type { Change } from './simulate.js';
import type { Account, CampaignState, Home, HouseholdMember, Item, Location, Mail, PartyMember, Route, ScheduleSlot } from './state.js';

export interface Kit {
  ctx: ApplyContext;
  changes: Change[];
  advanceTime: (minutes: number) => void;
  addXp: (amount: number) => void;
  ensureLocation: (name: string) => Location;
  notify: (text: string) => void;
}

type Handler<K extends OpType> = (s: CampaignState, op: OpOf<K>, kit: Kit) => void;
type Handlers = { [K in OpType]?: Handler<K> };

const text = (changes: Change[], key: string, label: string, t: string) => changes.push({ key, label, text: t, kind: 'text' });

// ------------------------------------------------------------------ lookups

function findHome(s: CampaignState, nameOrId: string): Home {
  const h = s.homes[nameOrId] ?? findExact(s.homes, nameOrId) ?? findFuzzy(s.homes, nameOrId);
  if (!h) throw new OpError(`Unknown home "${nameOrId}"`);
  return h;
}

function findLine(s: CampaignState, nameOrId: string) {
  const l = s.transit[nameOrId] ?? findExact(s.transit, nameOrId) ?? findFuzzy(s.transit, nameOrId);
  if (!l) throw new OpError(`No transit line "${nameOrId}"`);
  return l;
}

const isPlayerName = (s: CampaignState, n?: string) => !n || /^(player|me|you|self)$/i.test(n.trim()) || normalizeName(n) === normalizeName(s.player.name);

function findMember3(s: CampaignState, nameOrId: string): PartyMember {
  const m = s.party[nameOrId] ?? Object.values(s.party).find((x) => x.id === nameOrId) ?? findFuzzy(s.party, nameOrId);
  if (!m) throw new OpError(`${nameOrId} isn't in the party`);
  return m;
}

function whoOf(s: CampaignState, n?: string): Who {
  return isPlayerName(s, n) ? { kind: 'player' } : { kind: 'member', m: findMember3(s, n!) };
}

function findMember(s: CampaignState, nameOrId: string): HouseholdMember {
  const m = s.household[nameOrId] ?? findExact(s.household, nameOrId) ?? findFuzzy(s.household, nameOrId);
  if (!m) throw new OpError(`"${nameOrId}" isn't in a household`);
  return m;
}

function findAccount(s: CampaignState, nameOrId?: string): Account {
  const list = Object.values(s.economy.accounts);
  const a = nameOrId ? (s.economy.accounts[nameOrId] ?? findExact(s.economy.accounts, nameOrId) ?? findFuzzy(s.economy.accounts, nameOrId)) : list[0];
  if (!a) throw new OpError(nameOrId ? `No account called "${nameOrId}"` : 'Open an account first');
  return a;
}

function findBill(s: CampaignState, nameOrId: string) {
  const b = s.economy.bills[nameOrId] ?? findExact(s.economy.bills, nameOrId) ?? findFuzzy(s.economy.bills, nameOrId);
  if (!b) throw new OpError(`Unknown bill "${nameOrId}"`);
  return b;
}

function findAsset(s: CampaignState, nameOrId: string) {
  const a = s.economy.assets[nameOrId] ?? findExact(s.economy.assets, nameOrId) ?? findFuzzy(s.economy.assets, nameOrId);
  if (!a) throw new OpError(`Unknown asset "${nameOrId}"`);
  return a;
}

function currencyId(s: CampaignState, n: string): string {
  if (/^(main|wallet)$/i.test(n) || normalizeName(n) === normalizeName(s.meta.currency.name) || n === s.meta.currency.symbol) return 'main';
  const c = s.economy.currencies[n] ?? Object.values(s.economy.currencies).find((x) => normalizeName(x.name) === normalizeName(n) || x.symbol === n);
  if (!c) throw new OpError(`Unknown currency "${n}"`);
  return c.id;
}

function schedule(s: CampaignState, slots: Array<{ days: number[]; from: number; to: number; activity: string; location?: string | null }> | undefined, kit: Kit, prefix: string): ScheduleSlot[] {
  return (slots ?? []).map((sl, i) => ({ id: `${prefix}_${i + 1}`, days: sl.days, from: sl.from, to: sl.to % 1440, activity: sl.activity, locationId: sl.location ? kit.ensureLocation(sl.location).id : null }));
}

// ------------------------------------------------------------------ items: holders and containers

/** Stacks inside a container or storage (one level of nesting). */
const stacksIn = (s: CampaignState, pred: (i: Item) => boolean) => Object.values(s.inventory).filter(pred).length;

/** Take `qty` of a carried item (splitting a stack if needed); returns the moved/removed part. */
function takeItem(s: CampaignState, it: Item, qty: number): Item {
  if (qty >= it.qty) return it;
  it.qty -= qty;
  const id = uniqueId(s.inventory, 'item', it.name);
  const part: Item = { ...(JSON.parse(JSON.stringify(it)) as Item), id, qty, equipped: false, containerId: null };
  s.inventory[id] = part;
  return part;
}

/** Adds an item stack to a holder, merging with an identical stack. */
export function giveItem(s: CampaignState, base: Omit<Item, 'id'>, changes: Change[]): Item {
  const holder = base.holder ?? null;
  const same = Object.values(s.inventory).find((i) => (i.holder ?? null) === holder && !i.containerId && i.name === base.name && (i.quality ?? null) === (base.quality ?? null) && !i.enchantments?.length && !base.enchantments?.length);
  if (same) {
    same.qty += base.qty;
    changes.push({ key: `item:${same.id}`, label: same.name, delta: base.qty, kind: 'item' });
    return same;
  }
  const id = uniqueId(s.inventory, 'item', base.name);
  s.inventory[id] = { ...base, id } as Item;
  changes.push({ key: `item:${id}`, label: base.name, delta: base.qty, kind: 'item' });
  return s.inventory[id]!;
}

function removeQty(s: CampaignState, name: string, qty: number, changes: Change[]) {
  let left = qty;
  const stacks = Object.values(s.inventory).filter((i) => (i.holder ?? null) === null && i.name.trim().toLowerCase() === name.trim().toLowerCase() && !i.equipped);
  for (const it of stacks) {
    if (left <= 0) break;
    const take = Math.min(left, it.qty);
    it.qty -= take;
    left -= take;
    if (it.qty <= 0) delete s.inventory[it.id];
  }
  if (left > 0) throw new OpError(`Not enough ${name}`);
  changes.push({ key: `item:${slugify(name)}`, label: name, delta: -qty, kind: 'item' });
}

/** Resolve an item.move destination to a holder string. */
function holderFor(s: CampaignState, to: string, kit: Kit): { holder: string | null; label: string; capacity: number | null; home: Home | null } {
  const t = to.trim();
  if (/^(me|player|you|carried|carry|inventory)$/i.test(t)) return { holder: null, label: 'you', capacity: null, home: null };
  if (/^(party|party bag|bag)$/i.test(t)) return { holder: 'party', label: 'the party bag', capacity: null, home: null };
  const member = Object.values(s.party).find((m) => m.id === t || normalizeName(m.name) === normalizeName(t.replace(/^member:/, '')));
  if (member) return { holder: `member:${member.id}`, label: member.name, capacity: null, home: null };
  const st = findStorage(s, t.replace(/^store:/, ''));
  if (st) return { holder: `store:${st.storage.id}`, label: `${st.storage.name} (${st.home.name})`, capacity: st.storage.capacity, home: st.home };
  void kit;
  throw new OpError(`Nowhere called "${to}" to put it`);
}

// ------------------------------------------------------------------ handlers

export const HANDLERS3: Handlers = {
  // ---------------- money
  'currency.define': (s, op, { changes }) => {
    const id = slugify(op.name);
    s.economy.currencies[id] = { id, name: op.name, symbol: op.symbol, rate: op.rate };
    s.economy.wallet[id] ??= 0;
    text(changes, `cur:${id}`, op.name, `Currency: ${op.name}`);
  },
  'currency.exchange': (s, op, { changes }) => {
    exchange(s, currencyId(s, op.from), currencyId(s, op.to), op.amount, changes);
  },
  'bank.open': (s, op, kit) => {
    const bank = op.bank ? kit.ensureLocation(op.bank) : s.currentLocationId ? s.locations[s.currentLocationId] : null;
    const name = op.name ?? `${bank?.name ?? 'Bank'} account`;
    const id = uniqueId(s.economy.accounts, 'acct', name);
    s.economy.accounts[id] = { id, name, bankLocationId: bank?.id ?? null, balance: 0, apr: op.apr ?? 0.02, lastAccrued: dayOf(s.time.minutes) };
    text(kit.changes, `acct:${id}`, name, 'Account opened');
  },
  'bank.deposit': (s, op, { changes, ctx }) => {
    const a = findAccount(s, op.account);
    const why = ctx.source === 'user' ? canBank(s, a, op.via) : null;
    if (why) throw new OpError(why);
    pay(s, op.amount, `Deposit to ${a.name}`, changes);
    a.balance = round2(a.balance + op.amount);
    ledger(s, `Deposit`, op.amount, a.id);
  },
  'bank.withdraw': (s, op, { changes, ctx }) => {
    const a = findAccount(s, op.account);
    const why = ctx.source === 'user' ? canBank(s, a, op.via) : null;
    if (why) throw new OpError(why);
    if (a.balance + 1e-9 < op.amount) throw new OpError(`${a.name} only holds ${formatMoney(s, a.balance)}`);
    a.balance = round2(a.balance - op.amount);
    ledger(s, `Withdrawal`, -op.amount, a.id);
    receive(s, op.amount, `Withdrawn from ${a.name}`, changes);
  },
  'loan.take': (s, op, { changes }) => {
    const per = installment(op.amount, op.apr, op.periodDays, op.installments);
    const id = uniqueId(s.economy.loans, 'loan', op.lender);
    const bill = addBill(s, { name: `Loan from ${op.lender}`, kind: 'loan', amount: per, periodDays: op.periodDays, nextDue: s.time.minutes + op.periodDays * MIN_PER_DAY, autopay: true, homeId: null, assetId: null, loanId: id, orgId: findExact(s.orgs, op.lender)?.id ?? null });
    s.economy.loans[id] = { id, lender: op.lender, principal: op.amount, balance: op.amount, apr: op.apr, installment: per, periodDays: op.periodDays, status: 'active', billId: bill.id };
    receive(s, op.amount, `Loan from ${op.lender}`, changes);
    text(changes, `loan:${id}`, op.lender, `Loan: ${op.installments} × ${formatMoney(s, per)} every ${op.periodDays} days`);
  },
  'bill.add': (s, op, { changes }) => {
    const home = op.home ? findHome(s, op.home) : null;
    const asset = op.asset ? findAsset(s, op.asset) : null;
    const org = op.org ? (findExact(s.orgs, op.org) ?? findFuzzy(s.orgs, op.org)) : null;
    const b = addBill(s, {
      name: op.name,
      kind: op.kind,
      amount: op.amount,
      periodDays: op.periodDays,
      nextDue: s.time.minutes + Math.round((op.dueInDays ?? op.periodDays) * MIN_PER_DAY),
      autopay: op.autopay,
      homeId: home?.id ?? null,
      assetId: asset?.id ?? null,
      loanId: null,
      orgId: org?.id ?? null,
    });
    if (home && !home.billId) home.billId = b.id;
    if (asset && !asset.billId) asset.billId = b.id;
    text(changes, `bill:${b.id}`, b.name, `New bill: ${formatMoney(s, b.amount)} every ${b.periodDays} days`);
  },
  'bill.pay': (s, op, { changes }) => payBill(s, findBill(s, op.bill), changes),
  'bill.set': (s, op, { changes }) => {
    const b = findBill(s, op.bill);
    if (op.autopay !== undefined) b.autopay = op.autopay;
    if (op.amount !== undefined) b.amount = round2(op.amount);
    if (op.end) {
      if (b.owed > 0) throw new OpError(`${b.name} still has ${formatMoney(s, b.owed)} owed`);
      b.status = 'ended';
      text(changes, `bill:${b.id}`, b.name, 'Cancelled');
    }
  },
  'asset.add': (s, op, kit) => {
    if (op.buy) pay(s, op.value, `Bought ${op.name}`, kit.changes);
    const id = uniqueId(s.economy.assets, 'asset', op.name);
    const modes = op.modes ?? (op.kind === 'vehicle' ? [slugify(op.name).includes('bike') ? 'bike' : slugify(op.name).includes('boat') ? 'ship' : 'car'] : op.kind === 'animal' && /horse|pony|mare|stallion/i.test(op.name) ? ['horse'] : []);
    s.economy.assets[id] = {
      id,
      name: op.name,
      kind: op.kind,
      value: op.value,
      upkeep: op.upkeep,
      income: op.income,
      periodDays: op.periodDays,
      nextPayout: s.time.minutes + op.periodDays * MIN_PER_DAY,
      locationId: op.location ? kit.ensureLocation(op.location).id : null,
      modes,
      status: op.status,
      billId: null,
    };
    if (op.upkeep > 0) {
      const b = addBill(s, { name: `${op.name} ${op.status === 'rented' ? 'rent' : 'upkeep'}`, kind: op.status === 'rented' ? 'rent' : 'upkeep', amount: op.upkeep, periodDays: op.periodDays, nextDue: s.time.minutes + op.periodDays * MIN_PER_DAY, autopay: true, homeId: null, assetId: id, loanId: null, orgId: null });
      s.economy.assets[id]!.billId = b.id;
    }
    text(kit.changes, `asset:${id}`, op.name, op.buy ? 'Bought' : 'Acquired');
  },
  'asset.sell': (s, op, { changes }) => {
    const a = findAsset(s, op.name);
    if (a.status !== 'owned') throw new OpError(`You don't own ${a.name}`);
    receive(s, round2(a.value * 0.7), `Sold ${a.name}`, changes);
    if (a.billId && s.economy.bills[a.billId]) s.economy.bills[a.billId]!.status = 'ended';
    delete s.economy.assets[a.id];
  },

  // ---------------- shops and trade
  'shop.upsert': (s, op, kit) => {
    const existing = findExact(s.economy.shops, op.name) ?? findFuzzy(s.economy.shops, op.name);
    const id = existing?.id ?? uniqueId(s.economy.shops, 'shop', op.name);
    const loc = op.location ? kit.ensureLocation(op.location) : existing ? null : s.currentLocationId ? s.locations[s.currentLocationId] : null;
    const npcId = op.npc ? (findNpc(s, op.npc)?.npc.id ?? null) : null;
    const org = op.org ? (findExact(s.orgs, op.org) ?? findFuzzy(s.orgs, op.org)) : null;
    const kind = op.kind ?? existing?.kind ?? 'general';
    const shop = (s.economy.shops[id] ??= {
      id,
      name: op.name,
      kind,
      npcId: null,
      locationId: null,
      orgId: null,
      open: 8 * 60,
      close: 20 * 60,
      days: [],
      stock: {},
      restockDays: 3,
      lastRestock: s.time.minutes,
      haggle: null,
    });
    if (op.kind) shop.kind = op.kind;
    if (loc) shop.locationId = loc.id;
    if (npcId) shop.npcId = npcId;
    if (org) shop.orgId = org.id;
    if (op.open !== undefined) shop.open = op.open;
    if (op.close !== undefined) shop.close = op.close;
    if (op.days) shop.days = op.days;
    if (op.restockDays !== undefined) shop.restockDays = op.restockDays;
    if (op.stock?.length) {
      shop.stock = {};
      for (const st of op.stock) {
        const cat = st.category ?? guessCategory(st.name);
        shop.stock[slugify(st.name)] = { id: slugify(st.name), name: st.name, category: cat, basePrice: round2(st.price), qty: st.qty, maxQty: Math.max(st.qty, 1), desc: st.desc ?? '', effects: st.effects ?? defaultEffects(st.name, cat), slot: st.slot ?? defaultSlot(st.name, cat), stats: st.stats };
      }
    } else if (!Object.keys(shop.stock).length) shop.stock = generateStock(s, shop.kind);
    if (!existing) text(kit.changes, `shop:${id}`, shop.name, 'New shop');
  },
  'shop.buy': (s, op, { changes, ctx }) => {
    const shop = findShop(s, op.shop);
    if (ctx.source === 'user') assertCanShop(s, shop);
    const st = shop.stock[op.item] ?? findExact(shop.stock, op.item) ?? findFuzzy(shop.stock, op.item);
    if (!st) throw new OpError(`${shop.name} doesn't sell "${op.item}"`);
    if (st.qty < op.qty) throw new OpError(`${shop.name} only has ${st.qty}× ${st.name}`);
    const price = priceOf(s, shop, st.basePrice, 'buy', op.qty);
    pay(s, price, `Bought ${op.qty}× ${st.name} at ${shop.name}`, changes);
    st.qty -= op.qty;
    giveItem(s, stockToItem(s, st, op.qty), changes);
  },
  'shop.sell': (s, op, { changes, ctx }) => {
    const shop = findShop(s, op.shop);
    if (ctx.source === 'user') assertCanShop(s, shop);
    const it = playerItem(s, op.item);
    if (!it) throw new OpError(`You aren't carrying "${op.item}"`);
    if (it.locked || it.category === 'quest') throw new OpError(`${it.name} can't be sold`);
    if (it.qty < op.qty) throw new OpError(`You only have ${it.qty}× ${it.name}`);
    const base = itemValue(it) * (it.quality ? QUALITY_MULT[it.quality] : 1);
    const price = priceOf(s, shop, base, 'sell', op.qty);
    it.qty -= op.qty;
    if (it.qty <= 0) delete s.inventory[it.id];
    changes.push({ key: `item:${it.id}`, label: it.name, delta: -op.qty, kind: 'item' });
    receive(s, price, `Sold ${op.qty}× ${it.name} to ${shop.name}`, changes);
    const st = (shop.stock[slugify(it.name)] ??= { id: slugify(it.name), name: it.name, category: it.category, basePrice: round2(base), qty: 0, maxQty: 0, desc: it.desc, effects: it.effects, slot: it.slot, stats: it.stats });
    st.qty += op.qty;
  },
  'shop.haggle': (s, op, { changes, ctx }) => {
    const shop = findShop(s, op.shop);
    if (ctx.source === 'user') assertCanShop(s, shop);
    const r = haggle(s, shop);
    const pct = Math.round(Math.abs(r.mult - 1) * 100);
    text(changes, `haggle:${shop.id}`, shop.name, `${r.tier}: prices ${r.mult >= 1 ? `${pct}% better` : `${pct}% worse`} today (${Math.round(r.odds * 100)}% odds)`);
  },
  'trade.exchange': (s, op, { changes }) => {
    const npc = findNpc(s, op.npc)?.npc;
    if (!npc) throw new OpError(`Unknown person "${op.npc}"`);
    const rel = Object.values(s.relationships).find((r) => r.npcId === npc.id);
    let giveValue = Math.max(0, op.pay);
    let getValue = Math.max(0, -op.pay);
    for (const g of op.give) {
      const it = playerItem(s, g.name);
      if (!it || it.qty < g.qty) throw new OpError(`You don't have ${g.qty}× ${g.name}`);
      if (it.locked || it.category === 'quest') throw new OpError(`${it.name} can't be traded`);
      giveValue += itemValue(it) * g.qty;
    }
    for (const r of op.receive) getValue += (r.value ?? itemValue({ value: 0, category: r.category ?? guessCategory(r.name) })) * r.qty;
    const verdict = tradeAccepted(giveValue, getValue, rel?.affection ?? 0);
    if (!verdict.ok) throw new OpError(`${npc.name} turns it down: the offer is ${describeFairness(verdict.ratio)}`);
    for (const g of op.give) removeQty(s, playerItem(s, g.name)!.name, g.qty, changes);
    if (op.pay > 0) pay(s, op.pay, `Paid ${npc.name} in a trade`, changes);
    if (op.pay < 0) receive(s, -op.pay, `Received from ${npc.name} in a trade`, changes);
    for (const r of op.receive) {
      const cat = r.category ?? guessCategory(r.name);
      giveItem(s, { name: r.name, category: cat, qty: r.qty, desc: '', icon: iconForItem(r.name, cat), value: r.value ?? 0, equipped: false, slot: defaultSlot(r.name, cat), effects: defaultEffects(r.name, cat), stats: {}, containerId: null, locked: false, tags: [], addedAt: s.time.minutes, holder: null }, changes);
    }
    text(changes, `trade:${npc.id}`, npc.name, `Traded (${describeFairness(verdict.ratio)})`);
  },
  'item.move': (s, op, kit) => {
    const all = Object.values(s.inventory);
    const it = s.inventory[op.name] ?? findItem(Object.fromEntries(all.map((i) => [i.id, i])), op.name);
    if (!it) throw new OpError(`Unknown item "${op.name}"`);
    const dest = holderFor(s, op.to, kit);
    const src = it.holder ?? null;
    if (src === dest.holder) return;
    if (it.equipped) throw new OpError(`Unequip ${it.name} first`);
    // Home storage needs you there; the Home screen itself can be opened anywhere.
    const touchesHome = (h: string | null) => h?.startsWith('store:') ?? false;
    if (kit.ctx.source === 'user') {
      const homes = [dest.home, src && touchesHome(src) ? findStorage(s, src.slice(6))?.home : null].filter(Boolean) as Home[];
      for (const h of homes) if (!isAtHome(s, h)) throw new OpError(`You need to be at ${h.name} to use its storage`);
    }
    if (dest.capacity !== null) {
      const used = stacksIn(s, (i) => i.holder === dest.holder);
      if (used >= dest.capacity) throw new OpError(`${dest.label} is full (${dest.capacity} stacks)`);
    }
    const part = takeItem(s, it, op.qty ?? it.qty);
    part.holder = dest.holder;
    part.containerId = null;
    // Contents travel with a moved container.
    for (const inner of Object.values(s.inventory)) if (inner.containerId === part.id) inner.holder = dest.holder;
    text(kit.changes, `move:${part.id}`, part.name, `→ ${dest.label}`);
  },

  // ---------------- homes and household
  'home.add': (s, op, kit) => {
    const loc = op.location ? kit.ensureLocation(op.location) : s.currentLocationId ? s.locations[s.currentLocationId]! : kit.ensureLocation(op.name);
    const id = uniqueId(s.homes, 'home', op.name);
    const primary = op.primary ?? !Object.values(s.homes).some((h) => h.primary && h.ownership !== 'lost');
    if (primary) for (const h of Object.values(s.homes)) h.primary = false;
    let n = 0;
    const home: Home = {
      id,
      name: op.name,
      kind: op.kind,
      locationId: loc.id,
      ownership: op.ownership,
      primary,
      rooms: defaultRooms(op.kind, (nm) => `${id}_${slugify(nm)}_${++n}`),
      storage: defaultStorage(op.kind, `${id}_store_1`),
      billId: null,
      notes: '',
    };
    s.homes[id] = home;
    if (loc.kind === 'other') loc.kind = 'home';
    if (op.ownership === 'rented' && op.rent) {
      const b = addBill(s, { name: `Rent: ${op.name}`, kind: 'rent', amount: op.rent, periodDays: op.periodDays, nextDue: s.time.minutes + op.periodDays * MIN_PER_DAY, autopay: false, homeId: id, loanId: null, assetId: null, orgId: null });
      home.billId = b.id;
    }
    text(kit.changes, `home:${id}`, op.name, primary ? 'New home (primary)' : 'New home');
  },
  'home.update': (s, op, { changes }) => {
    const h = findHome(s, op.home);
    if (op.name) h.name = op.name;
    if (op.notes !== undefined) h.notes = op.notes;
    if (op.primary) {
      if (h.ownership === 'lost') throw new OpError(`${h.name} is no longer yours`);
      for (const other of Object.values(s.homes)) other.primary = other.id === h.id;
      text(changes, `home:${h.id}`, h.name, 'Now your primary home');
    }
  },
  'home.remove': (s, op, { changes }) => {
    const h = findHome(s, op.home);
    for (const st of h.storage) for (const it of storedIn(s, st.id)) it.holder = null;
    if (h.billId && s.economy.bills[h.billId]) s.economy.bills[h.billId]!.status = 'ended';
    for (const m of Object.values(s.household)) if (m.homeId === h.id) delete s.household[m.id];
    delete s.homes[h.id];
    text(changes, `home:${h.id}`, h.name, 'Removed (stored items are back with you)');
  },
  'room.add': (s, op, { changes }) => {
    const h = findHome(s, op.home);
    const amenities = (op.amenities ?? []).filter((a) => AMENITIES.some((x) => x.id === a));
    h.rooms.push({ id: `${h.id}_${slugify(op.name)}_${h.rooms.length + 1}`, name: op.name, purpose: op.purpose ?? '', amenities, level: 1 });
    text(changes, `home:${h.id}`, h.name, `New room: ${op.name}`);
  },
  'room.update': (s, op, { changes, ctx }) => {
    const h = findHome(s, op.home);
    const r = h.rooms.find((x) => x.id === op.room || x.name.toLowerCase() === op.room.toLowerCase());
    if (!r) throw new OpError(`${h.name} has no room "${op.room}"`);
    if (op.remove) {
      h.rooms = h.rooms.filter((x) => x !== r);
      return;
    }
    if (op.name) r.name = op.name;
    if (op.addAmenity) {
      if (!AMENITIES.some((a) => a.id === op.addAmenity)) throw new OpError(`Unknown amenity "${op.addAmenity}"`);
      if (!r.amenities.includes(op.addAmenity)) r.amenities.push(op.addAmenity);
    }
    if (op.removeAmenity) r.amenities = r.amenities.filter((a) => a !== op.removeAmenity);
    if (op.upgrade) {
      if (r.level >= 3) throw new OpError(`${r.name} is fully upgraded`);
      // Upgrades cost money scaled to the genre's prices.
      const cost = upgradeCost(s, r.level);
      if (ctx.source === 'user') pay(s, cost, `Upgraded ${r.name} (${h.name})`, changes);
      r.level += 1;
      text(changes, `room:${r.id}`, r.name, `Upgraded to level ${r.level}`);
    }
  },
  'storage.add': (s, op, { changes }) => {
    const h = findHome(s, op.home);
    h.storage.push({ id: `${h.id}_store_${h.storage.length + 1}`, name: op.name, capacity: op.capacity });
    text(changes, `home:${h.id}`, h.name, `New storage: ${op.name}`);
  },
  'household.add': (s, op, kit) => {
    const h = findHome(s, op.home);
    const npcId = op.npc ? (findNpc(s, op.npc)?.npc.id ?? null) : (findNpc(s, op.name)?.npc.id ?? null);
    const existing = Object.values(s.household).find((m) => m.homeId === h.id && (npcId ? m.npcId === npcId : normalizeName(m.name) === normalizeName(op.name)));
    if (existing) throw new OpError(`${op.name} is already in ${h.name}'s household`);
    const id = uniqueId(s.household, 'hh', op.name);
    s.household[id] = { id, name: op.name, npcId, homeId: h.id, role: op.role, relation: op.relation, schedule: schedule(s, op.schedule, kit, id) };
    text(kit.changes, `hh:${id}`, op.name, `${op.role === 'guest' ? 'Visits' : 'Lives at'} ${h.name}`);
  },
  'household.update': (s, op, kit) => {
    const m = findMember(s, op.member);
    if (op.home) m.homeId = findHome(s, op.home).id;
    if (op.role) m.role = op.role;
    if (op.relation !== undefined) m.relation = op.relation;
    if (op.schedule) m.schedule = schedule(s, op.schedule, kit, m.id);
  },
  'household.remove': (s, op, { changes }) => {
    const m = findMember(s, op.member);
    delete s.household[m.id];
    text(changes, `hh:${m.id}`, m.name, 'Left the household');
  },
  'home.invite': (s, op, kit) => {
    const home = currentHome(s);
    if (!home) throw new OpError('Invite people over when you are at one of your homes');
    const npc = findNpc(s, op.npc)?.npc;
    if (!npc) throw new OpError(`Unknown person "${op.npc}"`);
    const from = s.time.minutes % 1440;
    const to = (from + Math.round(op.hours * 60)) % 1440;
    const day = (Math.floor(s.time.minutes / 1440) + s.meta.calendar.epochWeekday) % (s.meta.calendar.weekdays.length || 7);
    const slot: ScheduleSlot = { id: `visit_${nextCounter(s.counters, 'visit')}`, days: [day], from, to, activity: 'visiting you', locationId: home.locationId };
    const existing = Object.values(s.household).find((m) => m.npcId === npc.id && m.homeId === home.id);
    if (existing) existing.schedule = [...existing.schedule.filter((x) => !x.id.startsWith('visit_')), slot];
    else {
      const id = uniqueId(s.household, 'hh', npc.name);
      s.household[id] = { id, name: npc.name, npcId: npc.id, homeId: home.id, role: 'guest', relation: 'visitor', schedule: [slot] };
    }
    npc.locationId = home.locationId;
    text(kit.changes, `invite:${npc.id}`, npc.name, `Comes over to ${home.name}`);
  },

  // ---------------- crafting
  'recipe.add': (s, op, { changes }) => {
    const id = uniqueId(s.recipes, 'recipe', op.name);
    s.recipes[id] = {
      id,
      name: op.name,
      discipline: op.discipline,
      ingredients: op.ingredients,
      station: op.station ?? null,
      level: op.level,
      minutes: op.minutes,
      difficulty: op.difficulty,
      result: { ...op.result, slot: op.result.slot ?? null },
      enchant: op.enchant ?? null,
      source: op.source,
    };
    text(changes, `recipe:${id}`, op.name, 'New recipe');
  },
  'recipe.remove': (s, op) => {
    const r = findExact(s.recipes, op.recipe) ?? findFuzzy(s.recipes, op.recipe);
    if (!r) throw new OpError(`Unknown recipe "${op.recipe}" (built-in recipes can't be removed)`);
    delete s.recipes[r.id];
  },
  // ---------------- party and progression
  'party.leader': (s, op, { changes }) => {
    if (isPlayerName(s, op.name)) s.partyMeta.leader = 'player';
    else {
      const m = findMember3(s, op.name);
      if (m.active === false) throw new OpError(`${m.name} is in the reserve; make them active first`);
      s.partyMeta.leader = m.id;
    }
    text(changes, 'party:leader', 'Leader', `${s.partyMeta.leader === 'player' ? 'You lead' : `${s.party[s.partyMeta.leader]!.name} leads`} the party`);
  },
  'party.formation': (s, op) => {
    const m = findMember3(s, op.name);
    if (op.row) m.row = op.row;
    if (op.active !== undefined && op.active !== (m.active !== false)) {
      if (op.active) {
        const n = Object.values(s.party).filter((x) => x.active !== false).length;
        if (n >= s.partyMeta.maxActive) throw new OpError(`Only ${s.partyMeta.maxActive} can be active; move someone to the reserve first`);
      } else if (s.partyMeta.leader === m.id) s.partyMeta.leader = 'player';
      m.active = op.active;
    }
  },
  'party.tactics': (s, op) => {
    const m = findMember3(s, op.name);
    if (op.roleKind !== undefined) m.roleKind = op.roleKind;
    const tactics = (m.tactics ??= { preset: 'balanced', rules: [] });
    if (op.preset) tactics.preset = op.preset;
    if (op.rules) tactics.rules = op.rules.map((r) => ({ when: r.when, value: r.value, do: r.do, ...(r.skill ? { skill: r.skill } : {}) }));
  },
  'party.meta': (s, op) => {
    if (op.curve) {
      s.partyMeta.curve = op.curve;
      const xp = s.player.bars.xp;
      if (xp) xp.max = xpToNext(s.player.level, op.curve);
    }
    if (op.maxActive) s.partyMeta.maxActive = op.maxActive;
    if (op.xpSources) s.partyMeta.xpSources = { ...s.partyMeta.xpSources, ...op.xpSources };
  },
  'party.vital': (s, op) => {
    const m = findMember3(s, op.name);
    const id = op.id ?? slugify(op.label);
    const vitals = (m.vitals ??= {});
    if (op.remove) {
      delete vitals[id];
      return;
    }
    const v = (vitals[id] ??= { label: op.label, cur: op.max ?? 100, max: op.max ?? 100 });
    v.label = op.label;
    if (op.max !== undefined) v.max = op.max;
    if (op.cur !== undefined) v.cur = Math.max(0, Math.min(v.max, op.cur));
  },
  'party.injury': (s, op, { changes }) => {
    const m = findMember3(s, op.name);
    m.injuries ??= [];
    if (op.remove) m.injuries = m.injuries.filter((x) => normalizeName(x) !== normalizeName(op.injury));
    else if (!m.injuries.some((x) => normalizeName(x) === normalizeName(op.injury))) {
      m.injuries.push(op.injury);
      text(changes, `injury:${m.id}`, m.name, op.injury);
    }
  },
  'class.define': (s, op, { changes }) => {
    const existing = Object.values(s.classes).find((c) => normalizeName(c.name) === normalizeName(op.name));
    const id = existing?.id ?? uniqueId(s.classes, 'class', op.name);
    s.classes[id] = { id, name: op.name, desc: op.desc, growth: op.growth, hpPerLevel: op.hpPerLevel, mpPerLevel: op.mpPerLevel, builtin: false };
    if (!existing) text(changes, `class:${id}`, op.name, 'New class');
  },
  'class.set': (s, op, { changes }) => {
    const cls = findClass(s, op.class) ?? findFuzzy(Object.fromEntries(allClasses(s).map((c) => [c.id, c])), op.class);
    if (!cls) throw new OpError(`Unknown class "${op.class}"`);
    const w = whoOf(s, op.who);
    if (w.kind === 'player') {
      s.player.classId = cls.id;
      s.player.className = cls.name;
    } else w.m.classId = cls.id;
    text(changes, 'class', 'Class', `${w.kind === 'player' ? 'You are' : `${w.m.name} is`} now a ${cls.name}`);
  },
  'skillnode.add': (s, op, { changes }) => {
    const cls = op.class ? findClass(s, op.class) : null;
    if (op.class && !cls) throw new OpError(`Unknown class "${op.class}"`);
    const after = (op.after ?? []).map((n) => {
      const node = findNode(s, n);
      if (!node) throw new OpError(`Unknown skill "${n}"`);
      return node.id;
    });
    const existing = Object.values(s.skillTree).find((n) => normalizeName(n.name) === normalizeName(op.name));
    const id = existing?.id ?? uniqueId(s.skillTree, 'skill', op.name);
    s.skillTree[id] = {
      id,
      name: op.name,
      desc: op.desc,
      classId: cls?.id ?? null,
      kind: op.kind,
      cost: op.cost,
      costType: op.costType,
      power: op.power,
      element: op.element ? op.element.toLowerCase() : null,
      target: op.target,
      maxRank: op.maxRank,
      requires: { level: op.level, ...(after.length ? { skills: after } : {}), ...(op.item ? { item: op.item } : {}), ...(op.quest ? { quest: op.quest } : {}) },
      source: 'user',
    };
    if (!existing) text(changes, `skill:${id}`, op.name, 'New skill in the tree');
  },
  'skill.learn': (s, op, { changes }) => {
    const node = findNode(s, op.skill);
    if (!node) throw new OpError(`Unknown skill "${op.skill}"`);
    const w = whoOf(s, op.who);
    const problems = learnProblems(s, w, node);
    if (problems.length) throw new OpError(problems.join('; '));
    const rank = learn(s, w, node);
    const who = w.kind === 'player' ? 'You' : w.m.name;
    text(changes, `skill:${node.id}`, node.name, rank === 1 ? `${who} learned ${node.name}` : `${node.name} rank ${rank}`);
  },
  'stats.spend': (s, op, { changes }) => {
    const w = whoOf(s, op.who);
    const have = w.kind === 'player' ? (s.player.statPoints ?? 0) : (w.m.statPoints ?? 0);
    if (have < op.points) throw new OpError(`Only ${have} stat point${have === 1 ? '' : 's'} to spend`);
    if (w.kind === 'player') {
      s.player.statPoints = have - op.points;
      if (op.stat === 'hp' || op.stat === 'mp') {
        const bar = s.player.bars[op.stat];
        if (!bar) throw new OpError(`No ${op.stat.toUpperCase()} bar`);
        const inc = op.points * (op.stat === 'hp' ? 5 : 3);
        bar.max += inc;
        bar.cur += inc;
      } else s.player.stats[op.stat] += op.points;
    } else {
      const m = w.m;
      m.statPoints = have - op.points;
      if (op.stat === 'hp') {
        m.maxHp += op.points * 5;
        m.hp += op.points * 5;
      } else if (op.stat === 'mp') {
        m.maxMp += op.points * 3;
        m.mp += op.points * 3;
      } else m.stats[op.stat] += op.points;
    }
    text(changes, `stat:${op.stat}`, op.stat.toUpperCase(), `+${op.points} ${op.stat.toUpperCase()}`);
  },
  // ---------------- mail, feed, phone
  'mail.send': (s, op, { changes }) => {
    if (op.kind === 'email' && !hasEmail(s)) throw new OpError('There is no email here; send a letter');
    const npc = findNpc(s, op.to)?.npc;
    if (!npc) throw new OpError(`You don't know anyone called "${op.to}"`);
    const courier = op.kind === 'letter' ? courierFor(s, op.courier).id : null;
    const cost = op.kind === 'letter' ? courierFor(s, op.courier).cost : 0;
    if (cost) pay(s, cost, `${op.kind === 'letter' ? 'Letter' : 'Mail'} to ${npc.name}`, changes);
    const id = newMailId(s);
    const sentAt = s.time.minutes;
    const deliverAt = sentAt + deliveryMinutes(s, op.kind, courier, mailKm(s, npc.id));
    const m: Mail = { id, kind: op.kind, direction: 'out', npcId: npc.id, from: s.player.name, to: npc.name, subject: op.subject || '(no subject)', body: op.body, sentAt, deliverAt, courier, read: true, replyDue: null, cost };
    if (op.expectReply && npc.status === 'alive') m.replyDue = deliverAt + replyDelay(s, m);
    s.mail[id] = m;
    text(changes, `mail:${id}`, npc.name, `${op.kind === 'letter' ? 'Letter' : 'Email'} sent to ${npc.name}`);
  },
  'mail.receive': (s, op, kit) => {
    const npc = findNpc(s, op.from)?.npc;
    const kind = op.kind === 'email' && hasEmail(s) ? 'email' : 'letter';
    const id = newMailId(s);
    const courier = kind === 'letter' ? courierFor(s, op.courier).id : null;
    const deliverAt = s.time.minutes + deliveryMinutes(s, kind, courier, mailKm(s, npc?.id ?? null));
    s.mail[id] = { id, kind, direction: 'in', npcId: npc?.id ?? null, from: npc?.name ?? op.from, to: s.player.name, subject: op.subject || '(no subject)', body: op.body ?? '', sentAt: s.time.minutes, deliverAt, courier, read: false, replyDue: null, pending: !op.body };
    if (deliverAt <= s.time.minutes) kit.notify(`${kind === 'email' ? 'An email' : 'A letter'} from ${s.mail[id]!.from} arrived: ${s.mail[id]!.subject}`);
  },
  'mail.write': (s, op) => {
    const m = s.mail[op.id];
    if (!m) throw new OpError('No such letter');
    m.body = op.body;
    m.pending = false;
  },
  'mail.read': (s, op) => {
    const m = s.mail[op.id];
    if (!m) throw new OpError('No such letter');
    if (m.deliverAt > s.time.minutes) throw new OpError("It hasn't arrived yet");
    m.read = true;
  },
  'mail.delete': (s, op) => {
    if (!s.mail[op.id]) throw new OpError('No such letter');
    delete s.mail[op.id];
  },
  'feed.post': (s, op, { ctx }) => {
    const npc = op.author ? findNpc(s, op.author)?.npc : null;
    if (op.author && !npc && ctx.source === 'ai') throw new OpError(`Unknown author "${op.author}"`);
    const n = nextCounter(s.counters, 'post');
    s.feed.push({ id: `post_${n}`, at: s.time.minutes, npcId: npc?.id ?? null, author: npc?.name ?? op.author ?? s.player.name, text: op.text, likes: 0, liked: false, comments: [] });
    if (s.feed.length > 200) s.feed.splice(0, s.feed.length - 200);
  },
  'feed.like': (s, op) => {
    const p = s.feed.find((x) => x.id === op.id);
    if (!p) throw new OpError('No such post');
    p.liked = !p.liked;
    p.likes += p.liked ? 1 : -1;
  },
  'feed.comment': (s, op) => {
    const p = s.feed.find((x) => x.id === op.id);
    if (!p) throw new OpError('No such post');
    const npc = op.author ? findNpc(s, op.author)?.npc : null;
    p.comments.push({ id: `${p.id}_c${p.comments.length + 1}`, author: npc?.name ?? op.author ?? s.player.name, text: op.text, at: s.time.minutes });
  },
  'phone.group': (s, op) => {
    const groups = (s.phone.groups ??= {});
    const existing = Object.values(groups).find((g) => normalizeName(g.name) === normalizeName(op.name));
    if (op.remove) {
      if (existing) delete groups[existing.id];
      return;
    }
    const members = op.members.map((n) => {
      const npc = findNpc(s, n)?.npc;
      if (!npc) throw new OpError(`You don't know anyone called "${n}"`);
      return npc.id;
    });
    if (members.length < 2) throw new OpError('A group needs at least two people');
    const id = existing?.id ?? uniqueId(groups, 'grp', op.name);
    groups[id] = { id, name: op.name, members: [...new Set(members)] };
  },
  'phone.app': (s, op) => {
    const apps = (s.phone.apps ??= {});
    const existing = Object.values(apps).find((a) => normalizeName(a.name) === normalizeName(op.name));
    if (op.remove) {
      if (existing) delete apps[existing.id];
      return;
    }
    if (!op.prompt) throw new OpError('Describe what the app does');
    const id = existing?.id ?? uniqueId(apps, 'app', op.name);
    apps[id] = { id, name: op.name, icon: op.icon, prompt: op.prompt };
  },
  // ---------------- transit
  'transit.add': (s, op, kit) => {
    const stops = op.stops.map((n) => kit.ensureLocation(n).id);
    if (new Set(stops).size < 2) throw new OpError('A line needs at least two different stops');
    const existing = findExact(s.transit, op.name);
    const id = existing?.id ?? uniqueId(s.transit, 'line', op.name);
    s.transit[id] = { id, name: op.name, mode: op.mode, stops, first: op.first, last: Math.max(op.first, op.last), every: op.every, days: op.days, hop: op.hop, fare: op.fare, farePerStop: op.farePerStop, requires: op.requires };
    if (!existing) text(kit.changes, `line:${id}`, op.name, `New ${op.mode} line`);
  },
  'transit.remove': (s, op) => {
    delete s.transit[findLine(s, op.line).id];
  },
  'transit.ticket': (s, op, { changes, ctx }) => {
    const line = findLine(s, op.line);
    if (ctx.source === 'user' && !linesAt(s, s.currentLocationId).includes(line)) throw new OpError(`Buy ${line.name} tickets at one of its stops`);
    const price = ticketPrice(line);
    pay(s, price * op.qty, `${op.qty}× ${ticketName(line)}`, changes);
    giveItem(
      s,
      { name: ticketName(line), category: 'misc', qty: op.qty, desc: `Good for one ride on the ${line.name}, any distance.`, icon: iconForItem('ticket', 'misc'), value: price, equipped: false, slot: null, effects: {}, stats: {}, containerId: null, locked: false, tags: ['ticket'], addedAt: s.time.minutes, holder: null },
      changes,
    );
  },
  'transit.ride': (s, op, kit) => {
    const { changes } = kit;
    const line = findLine(s, op.line);
    const from = s.currentLocationId;
    if (!from || !line.stops.includes(from)) throw new OpError(`You're not at a ${line.name} stop`);
    const dest = line.stops.map((id) => s.locations[id]!).find((l) => l && (l.id === op.to || normalizeName(l.name) === normalizeName(op.to))) ?? findFuzzy(Object.fromEntries(line.stops.map((id) => [id, s.locations[id]!])), op.to);
    if (!dest) throw new OpError(`The ${line.name} doesn't stop at "${op.to}"`);
    const trip = planTrip(s, line, from, dest.id);
    if (!trip) throw new OpError(`No ${line.name} departures to ${dest.name}`);
    const stop = blockers(checkRequirements(s, line.requires, { destination: dest }))[0];
    if (stop) throw new OpError(`${stop.reason}. ${stop.fix}`);
    let cost = 0;
    if (carries(s, ticketName(line))) removeQty(s, Object.values(s.inventory).find((i) => !i.holder && i.name === ticketName(line))!.name, 1, changes);
    else if (trip.fare > 0) {
      if (s.player.currency + 1e-9 < trip.fare) {
        const [fare] = checkRequirements(s, [{ kind: 'fare', amount: trip.fare }]);
        throw new OpError(`${fare!.reason}. ${fare!.fix}`);
      }
      pay(s, trip.fare, `${line.name}: ${trip.from.name} → ${dest.name}`, changes);
      cost = trip.fare;
    }
    kit.advanceTime(trip.wait + trip.ride);
    s.currentLocationId = dest.id;
    dest.discovered = true;
    dest.visited = true;
    text(changes, 'location', 'Location', `Took the ${line.name} to ${dest.name}`);
    logWorld(s, s.time.minutes, 'travel', `Took the ${line.name} from ${trip.from.name} to ${dest.name} (${trip.stops} stop${trip.stops === 1 ? '' : 's'}, waited ${trip.wait} min).`, true);
    logTrip(s, from, dest.id, line.mode, trip.wait + trip.ride, cost);
    for (const npc of Object.values(s.npcs)) if (npc.locationId === dest.id) npc.lastSeenAt = s.time.minutes;
    arrive(s, dest, line.mode, trip.ride);
  },
  'route.require': (s, op, kit) => {
    const a = kit.ensureLocation(op.from);
    const b = kit.ensureLocation(op.to);
    let routes = Object.values(s.routes).filter((r) => ((r.from === a.id && r.to === b.id) || (r.from === b.id && r.to === a.id)) && (!op.mode || r.mode === op.mode));
    if (!routes.length) {
      const mode = op.mode ?? 'road';
      const id = `route_${[a.id, b.id].sort().join('__')}_${mode}`;
      s.routes[id] = { id, from: a.id, to: b.id, mode, minutes: null };
      routes = [s.routes[id]!];
    }
    for (const r of routes) r.requires = op.requires as Route['requires'];
  },
  craft: (s, op, kit) => {
    const recipe = findRecipe(s, op.recipe);
    if (!recipe) throw new OpError(`Unknown recipe "${op.recipe}"`);
    const target = op.target ? playerItem(s, op.target) : null;
    const check = craftCheck(s, recipe, target);
    if (!check.ok) throw new OpError(check.problems.join('; '));
    const n = nextCounter(s.counters, 'craft');
    const out = craftOutcome(s, recipe, n);
    for (const ing of recipe.ingredients) removeQty(s, ing.name, ing.qty, kit.changes);
    kit.advanceTime(recipe.minutes);
    const label = DISCIPLINES.find((d) => d.id === recipe.discipline)!.label;
    if (recipe.enchant && target) {
      if (out.enchanted) {
        target.enchantments = [...(target.enchantments ?? []), recipe.enchant.effect];
        for (const [k, v] of Object.entries(recipe.enchant.stats ?? {})) target.stats[k as 'atk'] = (target.stats[k as 'atk'] ?? 0) + (v as number);
        text(kit.changes, `craft:${n}`, target.name, `Enchanted with ${recipe.enchant.effect}`);
      } else if (out.slotLost) {
        target.enchantSlots = Math.max(0, (target.enchantSlots ?? 1) - 1);
        text(kit.changes, `craft:${n}`, target.name, 'The enchantment backfired: a slot is lost');
      } else text(kit.changes, `craft:${n}`, target.name, 'The enchantment fizzled');
    } else if (out.qty > 0) {
      const res = recipe.result;
      const gear = ['weapon', 'armor', 'clothing', 'accessory'].includes(res.category);
      giveItem(
        s,
        {
          name: res.name,
          category: res.category,
          qty: out.qty,
          desc: '',
          icon: iconForItem(res.name, res.category),
          value: round2(res.value * QUALITY_MULT[out.quality]),
          equipped: false,
          slot: res.slot ?? defaultSlot(res.name, res.category),
          effects: res.effects ?? defaultEffects(res.name, res.category),
          stats: applyQuality(res.stats, out.quality),
          containerId: null,
          locked: false,
          tags: [],
          addedAt: s.time.minutes,
          holder: null,
          quality: gear ? out.quality : undefined,
          enchantSlots: gear ? (out.quality === 'masterwork' ? 3 : out.quality === 'superior' ? 2 : 1) : undefined,
        },
        kit.changes,
      );
      text(kit.changes, `craft:${n}`, res.name, `${label}: ${out.tier}${gear ? ` (${out.quality})` : ''}`);
    } else text(kit.changes, `craft:${n}`, recipe.name, `${label}: ${out.tier}; nothing usable came of it`);
    // Discipline experience.
    const prog = ((s.player.crafting ??= {})[recipe.discipline] ??= { level: 0, xp: 0 });
    prog.xp += out.xp;
    // A quarter of it counts toward your own level too.
    if (out.xp > 0 && xpSourceOn(s, 'crafting')) kit.addXp(Math.max(1, Math.round(out.xp / 4)));
    while (prog.xp >= xpForCraftLevel(prog.level) && prog.level < 20) {
      prog.xp -= xpForCraftLevel(prog.level);
      prog.level += 1;
      kit.changes.push({ key: `craft:${recipe.discipline}`, label, text: `${label} level ${prog.level}`, kind: 'level' });
    }
  },
};

export function upgradeCost(s: CampaignState, level: number): number {
  const scale = s.meta.style === 'fantasy' ? 25 : s.meta.style === 'scifi' ? 800 : 500;
  return scale * level;
}
