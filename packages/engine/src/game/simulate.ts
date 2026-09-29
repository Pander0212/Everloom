/**
 * Catch-up world simulation, run inside time advances so it is part of the replayable op log.
 * All randomness is seeded from (campaign seed, boundary time), so advancing 2h once or 1h twice
 * produces the same world.
 */
import { clamp } from '../util/clamp.js';
import { createRng, seedFrom } from '../util/rng.js';
import { MIN_PER_DAY, occurrencesBetween, toDate } from './calendar.js';
import { nextCounter } from './resolve.js';
import type { CampaignState, Npc, ScheduleSlot, WeatherKind, WorldLogEntry } from './state.js';

export interface Change {
  key: string;
  label: string;
  delta?: number;
  text?: string;
  kind?: 'item' | 'time' | 'tracker' | 'drift' | 'bar' | 'currency' | 'xp' | 'text' | 'level';
}

const MAX_LOG = 200;
const MAX_SIM_DAYS = 30;

export function logWorld(s: CampaignState, at: number, kind: WorldLogEntry['kind'], text: string, seen = false) {
  const n = nextCounter(s.counters, 'log');
  s.worldLog.push({ id: `log_${n}`, at, kind, text, seen });
  if (s.worldLog.length > MAX_LOG) s.worldLog.splice(0, s.worldLog.length - MAX_LOG);
}

export function slotActive(slot: ScheduleSlot, minutes: number, weekday: number): boolean {
  const mod = ((minutes % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  const inDay = slot.from <= slot.to ? mod >= slot.from && mod < slot.to : mod >= slot.from || mod < slot.to;
  if (!inDay) return false;
  if (!slot.days.length) return true;
  // For wrapping slots after midnight, the slot belongs to the previous weekday.
  return slot.days.includes(weekday);
}

export function currentSlot(npc: Pick<Npc, 'schedule'>, minutes: number, state: Pick<CampaignState, 'meta'>): ScheduleSlot | null {
  if (!npc.schedule?.length) return null;
  const d = toDate(minutes, state.meta.calendar);
  return npc.schedule.find((s) => slotActive(s, minutes, d.weekday)) ?? null;
}

const WEATHER_NEXT: Record<WeatherKind, Array<[WeatherKind, number]>> = {
  clear: [['clear', 5], ['cloudy', 3], ['wind', 1], ['heat', 1]],
  cloudy: [['clear', 3], ['cloudy', 3], ['overcast', 3], ['wind', 1]],
  overcast: [['cloudy', 3], ['rain', 3], ['overcast', 2], ['fog', 1], ['snow', 1]],
  rain: [['rain', 3], ['overcast', 3], ['storm', 1], ['cloudy', 2]],
  storm: [['rain', 4], ['overcast', 2], ['storm', 1]],
  snow: [['snow', 3], ['overcast', 3], ['clear', 1]],
  fog: [['fog', 2], ['cloudy', 3], ['clear', 2]],
  wind: [['clear', 3], ['cloudy', 3], ['wind', 1]],
  heat: [['heat', 3], ['clear', 4], ['storm', 1]],
};

function pickWeighted<T>(rng: ReturnType<typeof createRng>, list: Array<[T, number]>): T {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [v, w] of list) {
    r -= w;
    if (r <= 0) return v;
  }
  return list[list.length - 1][0];
}

function seasonalTemp(state: CampaignState, minutes: number, rng: ReturnType<typeof createRng>, kind: WeatherKind): number {
  const d = toDate(minutes, state.meta.calendar);
  const yearFrac = d.dayOfYear / Math.max(1, state.meta.calendar.months.reduce((s, m) => s + m.days, 0));
  const seasonal = 12 - 11 * Math.cos(2 * Math.PI * (yearFrac - 0.05));
  const daily = -4 * Math.cos((2 * Math.PI * (d.hour - 3)) / 24);
  const mod = kind === 'heat' ? 8 : kind === 'snow' ? -12 : kind === 'rain' || kind === 'storm' ? -3 : 0;
  return Math.round(seasonal + daily + mod + rng.int(-2, 2));
}

/** Apply per-hour tracker drift and status effects over [from, to). */
function driftVitals(s: CampaignState, from: number, to: number, changes: Change[]) {
  const hours = (to - from) / 60;
  if (hours <= 0) return;
  for (const t of Object.values(s.trackers)) {
    const before = t.value;
    t.value = clamp(t.value + t.perHour * hours, 0, t.max);
    const delta = Math.round((t.value - before) * 10) / 10;
    if (delta) changes.push({ key: `drift:${t.id}`, label: t.label, delta, kind: 'drift' });
  }
  for (const eff of Object.values(s.player.status)) {
    const end = eff.expiresAt == null ? to : Math.min(to, eff.expiresAt);
    const activeHours = Math.max(0, end - from) / 60;
    if (activeHours > 0) {
      for (const [id, perHour] of Object.entries(eff.perHour ?? {})) {
        if (s.trackers[id]) {
          const t = s.trackers[id];
          const before = t.value;
          t.value = clamp(t.value + perHour * activeHours, 0, t.max);
          if (t.value !== before) changes.push({ key: `tracker:${id}`, label: t.label, delta: Math.round((t.value - before) * 10) / 10, kind: 'tracker' });
        } else if (s.player.bars[id]) {
          const b = s.player.bars[id];
          const before = b.cur;
          b.cur = clamp(b.cur + perHour * activeHours, 0, b.max);
          if (b.cur !== before) changes.push({ key: `bar:${id}`, label: b.label, delta: Math.round((b.cur - before) * 10) / 10, kind: 'bar' });
        }
      }
    }
    if (eff.expiresAt != null && eff.expiresAt <= to) {
      delete s.player.status[eff.id];
      changes.push({ key: `status:${eff.id}`, label: eff.name, text: `${eff.name} wore off`, kind: 'text' });
    }
  }
}

export function simulate(s: CampaignState, from: number, to: number, changes: Change[]) {
  if (to <= from) return;
  driftVitals(s, from, to, changes);
  const cal = s.meta.calendar;
  const simFrom = Math.max(from, to - MAX_SIM_DAYS * MIN_PER_DAY);
  const playerLoc = s.currentLocationId;

  // 1. Calendar events and reminders.
  for (const ev of Object.values(s.events)) {
    const occ = occurrencesBetween(ev.at, ev.recurring, simFrom, to, cal, 8);
    for (const t of occ) {
      ev.lastFired = t;
      const kind = ev.kind === 'reminder' ? 'reminder' : 'event';
      logWorld(s, t, kind, ev.kind === 'birthday' ? `Birthday: ${ev.title}` : ev.kind === 'reminder' ? `Reminder: ${ev.title}` : ev.title);
      if (ev.kind === 'birthday' && ev.npcId && s.npcs[ev.npcId] && s.npcs[ev.npcId].age != null) {
        s.npcs[ev.npcId].age! += 1;
        logWorld(s, t, 'aging', `${s.npcs[ev.npcId].name} turned ${s.npcs[ev.npcId].age}.`);
      }
    }
  }
  // Player birthday
  if (s.player.birthday && s.player.age != null) {
    let days = 0;
    for (let i = 0; i < s.player.birthday.month && i < cal.months.length; i++) days += cal.months[i].days;
    const anchor = (days + s.player.birthday.day - 1) * MIN_PER_DAY;
    for (const t of occurrencesBetween(anchor, 'yearly', simFrom, to, cal, 4)) {
      s.player.age = (s.player.age ?? 0) + 1;
      logWorld(s, t, 'aging', `Your birthday — you are now ${s.player.age}.`);
    }
  }

  // 2. NPC schedules: place NPCs at the slot location for the end time.
  for (const npc of Object.values(s.npcs)) {
    if (npc.status !== 'alive') continue;
    const slot = currentSlot(npc, to, s);
    if (!slot || !slot.locationId || !s.locations[slot.locationId]) continue;
    if (npc.locationId !== slot.locationId) {
      const wasHere = npc.locationId === playerLoc;
      npc.locationId = slot.locationId;
      const nowHere = npc.locationId === playerLoc;
      if (playerLoc && wasHere !== nowHere) {
        logWorld(s, to, 'schedule', nowHere ? `${npc.name} arrived (${slot.activity}).` : `${npc.name} left for ${s.locations[slot.locationId].name}.`);
      }
    }
  }

  // 3. Weather at 6-hour boundaries.
  const step = 6 * 60;
  let b = Math.floor(simFrom / step) * step + step;
  let steps = 0;
  while (b <= to && steps < 12) {
    const rng = createRng(seedFrom(s.meta.seed, 'weather', b));
    const next = pickWeighted(rng, WEATHER_NEXT[s.weather.kind] ?? WEATHER_NEXT.clear);
    const temp = seasonalTemp(s, b, rng, next);
    if (next !== s.weather.kind) logWorld(s, b, 'weather', `Weather turned ${next}.`, true);
    s.weather = { kind: next, tempC: temp, since: b };
    b += step;
    steps++;
  }

  // 4. Daily ticks: rumor spread and NPCs texting first.
  let day = Math.floor(simFrom / MIN_PER_DAY) + 1;
  const lastDay = Math.floor(to / MIN_PER_DAY);
  let rumorLogs = 0;
  for (; day <= lastDay; day++) {
    const at = day * MIN_PER_DAY + 9 * 60;
    const rng = createRng(seedFrom(s.meta.seed, 'day', day));
    // Rumors spread between NPCs sharing a location or an organization.
    const groups = new Map<string, Npc[]>();
    for (const npc of Object.values(s.npcs)) {
      if (npc.status !== 'alive') continue;
      const keys = [npc.locationId ? `loc:${npc.locationId}` : '', ...npc.orgs.map((o) => `org:${o.orgId}`)].filter(Boolean);
      for (const k of keys) {
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(npc);
      }
    }
    for (const key of [...groups.keys()].sort()) {
      const members = groups.get(key)!.slice().sort((a, b2) => a.id.localeCompare(b2.id));
      if (members.length < 2) continue;
      for (const holder of members) {
        const pool = [...holder.rumors, ...holder.knownRumors];
        if (!pool.length || !rng.chance(0.35)) continue;
        const rumor = rng.pick(pool);
        const listener = rng.pick(members.filter((m) => m.id !== holder.id));
        if (listener.rumors.includes(rumor) || listener.knownRumors.includes(rumor)) continue;
        listener.knownRumors.push(rumor);
        if (listener.knownRumors.length > 20) listener.knownRumors.shift();
        if (rumorLogs < 3) {
          logWorld(s, at, 'rumor', `${holder.name} told ${listener.name}: "${rumor}"`);
          rumorLogs++;
        }
      }
    }
    // NPCs who like you may text first (at most one per day).
    const candidates = Object.values(s.npcs)
      .filter((n) => n.phone && n.status === 'alive')
      .filter((n) => {
        const rel = Object.values(s.relationships).find((r) => r.npcId === n.id);
        return (rel?.affection ?? 0) >= 20;
      })
      .sort((a, b2) => a.id.localeCompare(b2.id));
    if (candidates.length && rng.chance(0.3)) {
      const npc = rng.pick(candidates);
      const n = nextCounter(s.counters, 'phone');
      s.phone.pending.push({ id: `ph_${n}`, npcId: npc.id, at, reason: 'checking in' });
      if (s.phone.pending.length > 20) s.phone.pending.shift();
      s.phone.unread[npc.id] = (s.phone.unread[npc.id] ?? 0) + 1;
      logWorld(s, at, 'phone', `${npc.name} sent you a message.`);
    }
  }
}
