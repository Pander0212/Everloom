/**
 * Journeys: requirement checks (with a reason and a suggested fix), transit timetables and fares,
 * travel history and arrival consequences. Code decides every number; the narrator describes them.
 */
import { createRng, seedFrom } from '../util/rng.js';
import { formatClock, MIN_PER_DAY } from './calendar.js';
import { dayOf, formatMoney, ownedModes } from './economy.js';
import { presentAt } from './home.js';
import { findFuzzy, nextCounter } from './resolve.js';
import type { CampaignState, Location, LocationKind, Requirement, Style, TransitLine } from './state.js';

export interface ReqCheck {
  req: Requirement;
  ok: boolean;
  reason: string;
  fix: string;
  /** Minutes to wait until the requirement is met on its own (opening hours). */
  wait?: number;
}

export const HUB_KINDS: LocationKind[] = ['station', 'dock', 'airport', 'portal', 'stable', 'taxi'];

const tod = (m: number) => ((m % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
const lc = (t: string) => t.toLowerCase();

export function carries(s: CampaignState, name: string): boolean {
  const n = lc(name);
  return Object.values(s.inventory).some((i) => !i.holder && i.qty > 0 && (lc(i.name) === n || lc(i.name).includes(n)));
}

export function activePartySize(s: CampaignState): number {
  return 1 + Object.values(s.party).filter((m) => m.active !== false).length;
}

function inWindow(minute: number, open: number, close: number): boolean {
  if (open === close) return true;
  const t = tod(minute);
  return close > open ? t >= open && t < close : t >= open || t < close;
}

/** Check one requirement. `fare` is what this trip costs, when a fare requirement has no amount of its own. */
export function checkRequirement(s: CampaignState, req: Requirement, opts: { destination?: Location | null } = {}): ReqCheck {
  const ok = (reason = ''): ReqCheck => ({ req, ok: true, reason, fix: '' });
  const no = (reason: string, fix: string, wait?: number): ReqCheck => ({ req, ok: false, reason, fix, ...(wait !== undefined ? { wait } : {}) });
  switch (req.kind) {
    case 'discovered': {
      const d = opts.destination;
      if (!d || d.discovered) return ok();
      return no(`You don't know the way to ${d.name} yet`, 'Explore nearby or ask someone for directions.');
    }
    case 'fare': {
      const have = s.player.currency;
      if (have >= req.amount) return ok();
      const short = Math.round((req.amount - have) * 100) / 100;
      const acc = Object.values(s.economy.accounts).find((a) => a.balance >= short);
      return no(
        `Costs ${formatMoney(s, req.amount)}; you have ${formatMoney(s, have)}`,
        acc ? `Withdraw ${formatMoney(s, short)} from ${acc.name}.` : `Find ${formatMoney(s, short)} more, or sell something at a shop.`,
      );
    }
    case 'vehicle': {
      if (ownedModes(s).includes(req.mode)) return ok();
      return no(`Needs your own ${req.mode}`, `Buy, rent or borrow a ${req.mode} (Money → Assets), or choose another way.`);
    }
    case 'item': {
      if (carries(s, req.name)) return ok();
      const shop = Object.values(s.economy.shops).find((sh) => Object.values(sh.stock).some((st) => lc(st.name).includes(lc(req.name)) && st.qty > 0));
      return no(`Needs ${req.name}`, shop ? `Buy ${req.name} at ${shop.name}.` : `Get ${req.name} first.`);
    }
    case 'standing': {
      const org = findFuzzy(s.orgs, req.org);
      const cur = org?.standing ?? 50;
      if (cur >= req.min) return ok();
      return no(`${org?.name ?? req.org} only lets in people they trust (standing ${Math.round(cur)} of ${req.min} needed)`, `Help ${org?.name ?? req.org} to raise your standing by ${Math.ceil(req.min - cur)}.`);
    }
    case 'reputation': {
      const cur = s.player.reputation ?? 0;
      if (cur >= req.min) return ok();
      return no(`Needs a reputation of ${req.min} (yours is ${cur})`, 'Do public good deeds, or earn a name for yourself.');
    }
    case 'quest': {
      const q = Object.values(s.quests).find((x) => lc(x.title) === lc(req.title)) ?? Object.values(s.quests).find((x) => lc(x.title).includes(lc(req.title)));
      const met = req.state === 'done' ? q?.status === 'done' : q?.status === 'active' || q?.status === 'done';
      if (met) return ok();
      return no(req.state === 'done' ? `Opens after "${req.title}"` : `Needs "${req.title}" underway`, req.state === 'done' ? `Finish "${req.title}".` : `Take on "${req.title}".`);
    }
    case 'partySize': {
      const n = activePartySize(s);
      if (n <= req.max) return ok();
      const extra = n - req.max;
      return no(`Room for ${req.max}; your group is ${n}`, `Move ${extra} companion${extra === 1 ? '' : 's'} to the reserve.`);
    }
    case 'notWanted': {
      const w = s.player.wanted ?? 0;
      if (w <= req.max) return ok();
      return no(`Guards check papers here and you're wanted (level ${w})`, 'Lie low until the heat dies down, clear your name, or find another way in.');
    }
    case 'hours': {
      if (inWindow(s.time.minutes, req.open, req.close)) return ok();
      const now = tod(s.time.minutes);
      const wait = (req.open - now + MIN_PER_DAY) % MIN_PER_DAY;
      return no(`Closed until ${formatClock(req.open, s.meta.calendar)}`, `Wait until ${formatClock(req.open, s.meta.calendar)}.`, wait);
    }
    case 'weather': {
      if (!req.not.includes(s.weather.kind)) return ok();
      return no(`Not in this weather (${s.weather.kind})`, `Wait for the ${s.weather.kind} to pass, or choose another way.`);
    }
  }
}

export function checkRequirements(s: CampaignState, reqs: Requirement[] | undefined, opts: { destination?: Location | null } = {}): ReqCheck[] {
  return (reqs ?? []).map((r) => checkRequirement(s, r, opts));
}

export const blockers = (checks: ReqCheck[]) => checks.filter((c) => !c.ok);

/** Requirements on routes between two places that apply to a travel mode's access. */
export function routeRequirements(s: CampaignState, fromId: string | null, toId: string, access: string[]): Requirement[] {
  if (!fromId) return [];
  return Object.values(s.routes)
    .filter((r) => ((r.from === fromId && r.to === toId) || (r.from === toId && r.to === fromId)) && access.includes(r.mode))
    .flatMap((r) => r.requires ?? []);
}

// ------------------------------------------------------------------ transit

export const ticketName = (line: Pick<TransitLine, 'name'>) => `Ticket: ${line.name}`;

export function linesAt(s: CampaignState, locationId: string | null): TransitLine[] {
  if (!locationId) return [];
  return Object.values(s.transit).filter((l) => l.stops.includes(locationId));
}

export function lineFare(line: TransitLine, stops: number): number {
  return Math.round((line.fare + line.farePerStop * Math.max(0, stops - 1)) * 100) / 100;
}
/** A ticket is good for any single ride on the line, so it costs the longest ride. */
export const ticketPrice = (line: TransitLine) => lineFare(line, line.stops.length - 1);

/**
 * The next departure from stop `fromIdx` toward `toIdx`, at or after `now`. Lines run both ways on
 * the same timetable: the first departure leaves the end stop at `first`, every `every` minutes
 * until `last`, reaching each later stop `hop` minutes after the one before.
 */
export function nextDeparture(s: CampaignState, line: TransitLine, fromIdx: number, toIdx: number, now: number): number | null {
  const forward = toIdx > fromIdx;
  const offset = (forward ? fromIdx : line.stops.length - 1 - fromIdx) * line.hop;
  const cal = s.meta.calendar;
  const wd = Math.max(1, cal.weekdays.length);
  const every = Math.max(1, line.every);
  for (let d = dayOf(now) - 1; d <= dayOf(now) + 15; d++) {
    const weekday = (((d + cal.epochWeekday) % wd) + wd) % wd;
    if (line.days.length && !line.days.includes(weekday)) continue;
    for (let t = line.first; t <= line.last; t += every) {
      const at = d * MIN_PER_DAY + t + offset;
      if (at >= now) return at;
    }
  }
  return null;
}

export interface Trip {
  line: TransitLine;
  from: Location;
  to: Location;
  stops: number;
  depart: number;
  arrive: number;
  wait: number;
  ride: number;
  fare: number;
}

export function planTrip(s: CampaignState, line: TransitLine, fromId: string, toId: string, now = s.time.minutes): Trip | null {
  const a = line.stops.indexOf(fromId);
  const b = line.stops.indexOf(toId);
  if (a < 0 || b < 0 || a === b) return null;
  const depart = nextDeparture(s, line, a, b, now);
  if (depart === null) return null;
  const stops = Math.abs(b - a);
  const ride = stops * line.hop;
  return { line, from: s.locations[fromId]!, to: s.locations[toId]!, stops, depart, arrive: depart + ride, wait: depart - now, ride, fare: lineFare(line, stops) };
}

// ------------------------------------------------------------------ history and arrival

export function recentPlaces(s: CampaignState, n = 5): Location[] {
  const out: Location[] = [];
  const seen = new Set<string>([s.currentLocationId ?? '']);
  for (let i = s.travelLog.length - 1; i >= 0 && out.length < n; i--) {
    for (const id of [s.travelLog[i]!.to, s.travelLog[i]!.from]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const loc = s.locations[id];
      if (loc && out.length < n) out.push(loc);
    }
  }
  return out;
}

export function logTrip(s: CampaignState, from: string | null, to: string, mode: string, minutes: number, cost: number) {
  const n = nextCounter(s.counters, 'trip');
  s.travelLog.push({ id: `trip_${n}`, at: s.time.minutes, from: from ?? '', to, mode, minutes, cost });
  if (s.travelLog.length > 200) s.travelLog.splice(0, s.travelLog.length - 200);
}

const OVERLAND = new Set(['walk', 'run', 'horse', 'carriage', 'caravan', 'bike', 'motorcycle', 'car', 'hovercar']);

const ENCOUNTERS: Record<Style, string[]> = {
  fantasy: ['Bandits were watching the road', 'A merchant caravan with a broken axle asked for help', 'Wolf tracks followed you for a mile', 'A wandering pilgrim shared news from afar', 'A toll-keeper demanded coin at a bridge'],
  modern: ['A road closure forced a detour', 'Someone on the way recognised you', 'A street performer drew a crowd you had to push through', 'A stranger dropped their wallet in front of you', 'A police patrol slowed down to look at you'],
  scifi: ['A patrol drone scanned you twice', 'A salvage crew offered a trade', 'Static on every channel for a stretch of the trip', 'A stowaway was found and put off at your stop', 'A checkpoint beacon flagged your transponder'],
};

/**
 * What happens on arrival: who is there, the weather, how tired or hungry the trip left you,
 * checkpoints at hubs when you're wanted, and (on long overland trips) a seeded encounter.
 * Seeded from a state counter, so replaying the op log gives the same result.
 */
export function arrive(s: CampaignState, dest: Location, mode: string, minutes: number): string[] {
  const rng = createRng(seedFrom(s.meta.seed, 'arrive', nextCounter(s.counters, 'arrive')));
  const notes: string[] = [];
  const here = Object.values(s.npcs).filter((n) => n.status === 'alive' && n.locationId === dest.id).map((n) => n.name);
  const members = Object.values(s.homes)
    .filter((h) => h.locationId === dest.id && h.ownership !== 'lost')
    .flatMap((h) => presentAt(s, h).map((p) => p.member.name));
  const people = [...new Set([...here, ...members])];
  if (people.length) notes.push(`Here: ${people.slice(0, 5).join(', ')}${people.length > 5 ? ` and ${people.length - 5} more` : ''}`);
  if (s.weather.kind !== 'clear') notes.push(`Weather: ${s.weather.kind}, ${Math.round(s.weather.tempC)}°`);
  for (const t of Object.values(s.trackers)) {
    if (!t.visible) continue;
    const pct = t.value / Math.max(1, t.max);
    if (t.direction === 'fill' && pct <= 0.25) notes.push(`${t.label} is low (${Math.round(t.value)})`);
    if (t.direction === 'need' && pct >= 0.75) notes.push(`${t.label} is high (${Math.round(t.value)})`);
  }
  const wanted = s.player.wanted ?? 0;
  const events = s.meta.arrivalEvents !== false;
  const roll1 = rng.next();
  if (events && HUB_KINDS.includes(dest.kind) && wanted > 0) {
    notes.push(roll1 < Math.min(0.9, wanted * 0.2) ? `Checkpoint: the guards recognise you (wanted ${wanted})` : 'Checkpoint: you pass without trouble');
  }
  const roll2 = rng.next();
  const danger = dest.kind === 'danger' || dest.kind === 'wilds' || dest.tags.includes('dangerous');
  if (events && OVERLAND.has(mode) && minutes >= 90 && roll2 < (danger ? 0.3 : 0.12)) {
    const list = ENCOUNTERS[s.meta.style] ?? ENCOUNTERS.fantasy;
    notes.push(`On the way: ${list[rng.int(0, list.length - 1)]}`);
  }
  s.arrival = { at: s.time.minutes, locationId: dest.id, mode, notes };
  return notes;
}
