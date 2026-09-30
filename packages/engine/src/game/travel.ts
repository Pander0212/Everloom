/** Deterministic travel math: distance from map coordinates, time, energy and fare per mode. */
import { blockers, checkRequirement, checkRequirements, routeRequirements } from './journey.js';
import type { CampaignState, Location, MapLevel, RouteMode, Style } from './state.js';

export interface TravelMode {
  id: string;
  label: string;
  /** km/h */
  speed: number;
  /** Energy cost per hour of travel (tracker units). */
  energyPerHour: number;
  baseFare: number;
  farePerKm: number;
  access: RouteMode[];
  styles: Style[];
  minKm?: number;
}

export const TRAVEL_MODES: TravelMode[] = [
  { id: 'walk', label: 'Walk', speed: 4.8, energyPerHour: 7, baseFare: 0, farePerKm: 0, access: ['road', 'trail'], styles: ['fantasy', 'modern', 'scifi'] },
  { id: 'run', label: 'Run', speed: 9, energyPerHour: 18, baseFare: 0, farePerKm: 0, access: ['road', 'trail'], styles: ['fantasy', 'modern', 'scifi'] },
  { id: 'horse', label: 'Horse', speed: 12, energyPerHour: 3, baseFare: 0, farePerKm: 0.05, access: ['road', 'trail'], styles: ['fantasy'], minKm: 1 },
  { id: 'carriage', label: 'Carriage', speed: 9, energyPerHour: 1, baseFare: 2, farePerKm: 0.15, access: ['road'], styles: ['fantasy'], minKm: 1 },
  { id: 'ship', label: 'Ship', speed: 15, energyPerHour: 1, baseFare: 8, farePerKm: 0.1, access: ['water'], styles: ['fantasy', 'modern'], minKm: 5 },
  { id: 'caravan', label: 'Caravan', speed: 5, energyPerHour: 2, baseFare: 1, farePerKm: 0.04, access: ['road', 'trail'], styles: ['fantasy'], minKm: 10 },
  { id: 'airship', label: 'Airship', speed: 60, energyPerHour: 0.5, baseFare: 15, farePerKm: 0.05, access: ['air'], styles: ['fantasy'], minKm: 30 },
  { id: 'portal', label: 'Portal', speed: 100000, energyPerHour: 0, baseFare: 20, farePerKm: 0, access: ['portal'], styles: ['fantasy', 'scifi'] },
  { id: 'bike', label: 'Bicycle', speed: 15, energyPerHour: 5, baseFare: 0, farePerKm: 0, access: ['road', 'trail'], styles: ['modern'] },
  { id: 'bus', label: 'Bus', speed: 25, energyPerHour: 1, baseFare: 2, farePerKm: 0.05, access: ['road'], styles: ['modern'], minKm: 1 },
  { id: 'taxi', label: 'Taxi', speed: 35, energyPerHour: 0, baseFare: 4, farePerKm: 1.2, access: ['road'], styles: ['modern'], minKm: 0.5 },
  { id: 'subway', label: 'Subway', speed: 32, energyPerHour: 0.5, baseFare: 2.5, farePerKm: 0, access: ['rail'], styles: ['modern'], minKm: 1 },
  { id: 'car', label: 'Car', speed: 45, energyPerHour: 1, baseFare: 0, farePerKm: 0.12, access: ['road'], styles: ['modern'], minKm: 1 },
  { id: 'train', label: 'Train', speed: 90, energyPerHour: 0.5, baseFare: 6, farePerKm: 0.15, access: ['rail', 'road'], styles: ['modern'], minKm: 20 },
  { id: 'ferry', label: 'Ferry', speed: 25, energyPerHour: 0.5, baseFare: 5, farePerKm: 0.2, access: ['water'], styles: ['modern'], minKm: 2 },
  { id: 'plane', label: 'Flight', speed: 750, energyPerHour: 2, baseFare: 120, farePerKm: 0.08, access: ['air', 'road'], styles: ['modern'], minKm: 300 },
  { id: 'shuttle', label: 'Shuttle', speed: 80, energyPerHour: 0.5, baseFare: 3, farePerKm: 0.1, access: ['road', 'rail'], styles: ['scifi'], minKm: 1 },
  { id: 'hovercar', label: 'Hovercar', speed: 90, energyPerHour: 0.5, baseFare: 0, farePerKm: 0.08, access: ['road', 'air'], styles: ['scifi'], minKm: 1 },
  { id: 'maglev', label: 'Maglev', speed: 400, energyPerHour: 0.5, baseFare: 12, farePerKm: 0.05, access: ['rail', 'road'], styles: ['scifi'], minKm: 30 },
  { id: 'starship', label: 'Starship', speed: 50000, energyPerHour: 1, baseFare: 200, farePerKm: 0.001, access: ['space', 'air', 'road'], styles: ['scifi'], minKm: 2000 },
];

/** Kilometres per map unit (coordinate space 0..1000) at each level. */
export const LEVEL_SCALE_KM: Record<MapLevel, number> = {
  world: 6,
  region: 0.3,
  local: 0.02,
  nearby: 0.004,
  area: 0.001,
};

function ancestors(state: Pick<CampaignState, 'locations'>, loc: Location): Location[] {
  const chain: Location[] = [loc];
  let cur = loc;
  const seen = new Set([loc.id]);
  while (cur.parentId && state.locations[cur.parentId] && !seen.has(cur.parentId)) {
    cur = state.locations[cur.parentId];
    seen.add(cur.id);
    chain.push(cur);
  }
  return chain;
}

/** Distance in km between two locations, using the level where their ancestor chains diverge. */
export function distanceKm(state: Pick<CampaignState, 'locations'>, fromId: string, toId: string): number {
  const a = state.locations[fromId];
  const b = state.locations[toId];
  if (!a || !b || a.id === b.id) return 0;
  const ca = ancestors(state, a);
  const cb = ancestors(state, b);
  const setB = new Map(cb.map((l, i) => [l.id, i]));
  // If one contains the other: a short hop proportional to the child's level.
  if (setB.has(a.id)) return Math.max(0.02, LEVEL_SCALE_KM[b.level] * 60);
  if (ca.some((l) => l.id === b.id)) return Math.max(0.02, LEVEL_SCALE_KM[a.level] * 60);
  // Find first common ancestor; compare the children just below it.
  let ia = 0;
  let ib = -1;
  for (; ia < ca.length; ia++) {
    const idx = setB.get(ca[ia].id);
    if (idx !== undefined) {
      ib = idx;
      break;
    }
  }
  const na = ia > 0 ? ca[ia - 1] : ca[ca.length - 1];
  const nb = ib > 0 ? cb[ib - 1] : cb[cb.length - 1];
  const units = Math.hypot(na.x - nb.x, na.y - nb.y);
  const scale = LEVEL_SCALE_KM[na.level] ?? LEVEL_SCALE_KM.local;
  // Add a small intra-location overhead for deeper nodes.
  const overhead = (ia - 1 + (ib - 1)) * 0.05;
  return Math.max(0.02, units * scale + Math.max(0, overhead));
}

export interface TravelOption {
  mode: string;
  label: string;
  km: number;
  minutes: number;
  energy: number;
  fare: number;
  available: boolean;
  reason?: string;
  /** What would make this possible, when code can say. */
  fix?: string;
  /** Minutes until it becomes possible on its own (opening hours). */
  wait?: number;
}

export function routeModesBetween(state: Pick<CampaignState, 'routes'>, fromId: string, toId: string): RouteMode[] {
  const modes = new Set<RouteMode>(['road', 'trail']);
  for (const r of Object.values(state.routes)) {
    if ((r.from === fromId && r.to === toId) || (r.from === toId && r.to === fromId)) modes.add(r.mode);
  }
  return [...modes];
}

export function fixedRouteMinutes(state: Pick<CampaignState, 'routes'>, fromId: string, toId: string, mode: RouteMode[]): number | null {
  for (const r of Object.values(state.routes)) {
    if (((r.from === fromId && r.to === toId) || (r.from === toId && r.to === fromId)) && mode.includes(r.mode) && r.minutes) return r.minutes;
  }
  return null;
}

export function travelOptions(state: CampaignState, fromId: string | null, toId: string): TravelOption[] {
  const style = state.meta.style;
  const km = fromId ? distanceKm(state, fromId, toId) : 0.5;
  const access = fromId ? routeModesBetween(state, fromId, toId) : ['road' as RouteMode];
  const energyTracker = state.trackers.energy;
  const options: TravelOption[] = [];
  for (const mode of TRAVEL_MODES) {
    if (!mode.styles.includes(style)) continue;
    const reachable = mode.access.some((a) => access.includes(a));
    if (mode.id === 'portal' && !access.includes('portal')) continue;
    if (mode.id === 'ship' || mode.id === 'ferry') {
      if (!access.includes('water')) continue;
    }
    const fixed = fromId ? fixedRouteMinutes(state, fromId, toId, mode.access) : null;
    const minutes = Math.max(1, Math.round(fixed ?? (km / mode.speed) * 60));
    const energy = Math.round((minutes / 60) * mode.energyPerHour * 10) / 10;
    const fare = Math.round((mode.baseFare + mode.farePerKm * km) * 100) / 100;
    let available = reachable;
    let reason: string | undefined;
    let fix: string | undefined;
    let wait: number | undefined;
    if (!reachable) reason = 'No route for this mode';
    else if (mode.minKm && km < mode.minKm) {
      available = false;
      reason = 'Too close for this';
    } else if (fare > state.player.currency) {
      available = false;
      const c = checkRequirement(state, { kind: 'fare', amount: fare });
      reason = c.reason;
      fix = c.fix;
    } else if (energyTracker && energy > 0 && energyTracker.value - energy < 0) {
      available = false;
      reason = 'Too tired';
    } else if (mode.id === 'walk' && km > 400) {
      available = false;
      reason = 'Too far to walk';
    }
    if (available) {
      const stop = blockers(checkRequirements(state, routeRequirements(state, fromId, toId, mode.access), { destination: state.locations[toId] ?? null }))[0];
      if (stop) {
        available = false;
        reason = stop.reason;
        fix = stop.fix;
        wait = stop.wait;
      }
    }
    options.push({ mode: mode.id, label: mode.label, km: Math.round(km * 100) / 100, minutes, energy, fare, available, reason, ...(fix ? { fix } : {}), ...(wait !== undefined ? { wait } : {}) });
  }
  return options.sort((a, b) => Number(b.available) - Number(a.available) || a.minutes - b.minutes);
}

/** Pick the default mode: cheapest available that isn't absurdly slow. */
export function defaultTravelOption(options: TravelOption[]): TravelOption | undefined {
  const avail = options.filter((o) => o.available);
  if (!avail.length) return undefined;
  const walk = avail.find((o) => o.mode === 'walk');
  if (walk && walk.minutes <= 45) return walk;
  return avail.slice().sort((a, b) => a.minutes + a.fare * 3 - (b.minutes + b.fare * 3))[0];
}
