/** Versioned campaign state. Everything here is plain JSON so it can be stored, diffed and replayed. */

export const STATE_VERSION = 1;

export type Style = 'fantasy' | 'modern' | 'scifi';
export type MapLevel = 'world' | 'region' | 'local' | 'nearby' | 'area';
export const MAP_LEVELS: MapLevel[] = ['world', 'region', 'local', 'nearby', 'area'];

export type LocationKind =
  | 'city' | 'town' | 'village' | 'district' | 'building' | 'room' | 'wilds' | 'road' | 'station' | 'dock'
  | 'landmark' | 'shop' | 'service' | 'danger' | 'interior' | 'home' | 'vehicle' | 'region' | 'realm' | 'other';

export interface Bar {
  id: string;
  label: string;
  cur: number;
  max: number;
  visible: boolean;
}

export interface Tracker {
  id: string;
  label: string;
  value: number;
  max: number;
  /** Change per game hour (positive = rises). */
  perHour: number;
  /** 'need' — higher is worse (Hunger). 'fill' — higher is better (Energy). */
  direction: 'need' | 'fill';
  visible: boolean;
}

export interface StatusEffect {
  id: string;
  name: string;
  kind: 'buff' | 'debuff' | 'neutral';
  desc: string;
  /** Absolute game minute when it wears off, or null for indefinite. */
  expiresAt: number | null;
  /** Per-hour deltas applied while active: keys are tracker or bar ids. */
  perHour: Record<string, number>;
}

export interface Skill {
  id: string;
  name: string;
  desc: string;
  kind: 'attack' | 'heal' | 'buff' | 'debuff' | 'utility';
  cost: number;
  costType: 'mp' | 'ap' | 'none';
  power: number;
}

export interface Stats {
  atk: number;
  def: number;
  spd: number;
  mag: number;
}

export interface Player {
  name: string;
  className: string;
  level: number;
  age: number | null;
  ageStage: string;
  resourceProfile: 'hybrid' | 'ap' | 'mp';
  bars: Record<string, Bar>;
  currency: number;
  skills: Record<string, Skill>;
  status: Record<string, StatusEffect>;
  stats: Stats;
  appearance: string;
  /** Minute-of-year for birthday (null = none). */
  birthday: { month: number; day: number } | null;
}

export type ItemCategory =
  | 'food' | 'drink' | 'weapon' | 'armor' | 'clothing' | 'accessory' | 'key' | 'tool' | 'material'
  | 'consumable' | 'medicine' | 'book' | 'container' | 'quest' | 'valuable' | 'misc';

export type EquipSlot = 'head' | 'body' | 'legs' | 'feet' | 'hands' | 'weapon' | 'offhand' | 'accessory' | 'back';

export interface ItemEffects {
  trackers?: Record<string, number>;
  bars?: Record<string, number>;
  status?: string;
}

export interface Item {
  id: string;
  name: string;
  category: ItemCategory;
  qty: number;
  desc: string;
  icon: string;
  value: number;
  equipped: boolean;
  slot: EquipSlot | null;
  effects: ItemEffects;
  stats: Partial<Stats>;
  containerId: string | null;
  locked: boolean;
  tags: string[];
  addedAt: number;
}

export interface Location {
  id: string;
  name: string;
  level: MapLevel;
  parentId: string | null;
  kind: LocationKind;
  x: number;
  y: number;
  description: string;
  customs: string;
  discovered: boolean;
  visited: boolean;
  locked: boolean;
  tags: string[];
  /** Optional scene background (media id). */
  image?: string | null;
}

export type RouteMode = 'road' | 'trail' | 'rail' | 'water' | 'air' | 'space' | 'portal';

export interface Route {
  id: string;
  from: string;
  to: string;
  mode: RouteMode;
  /** Optional fixed travel minutes (overrides distance). */
  minutes: number | null;
}

export interface ScheduleSlot {
  id: string;
  /** Weekday indices (0-based in the campaign calendar). Empty = every day. */
  days: number[];
  /** Minutes of day. If to < from the slot wraps midnight. */
  from: number;
  to: number;
  activity: string;
  locationId: string | null;
}

export interface Npc {
  id: string;
  name: string;
  aliases: string[];
  role: string;
  title: string;
  age: number | null;
  birthday: { month: number; day: number } | null;
  locationId: string | null;
  appearance: string;
  personality: string;
  orgs: Array<{ orgId: string; rank: string }>;
  rumors: string[];
  secrets: string[];
  knownRumors: string[];
  schedule: ScheduleSlot[];
  notes: string;
  locked: boolean;
  characterId: string | null;
  status: 'alive' | 'dead' | 'missing';
  phone: boolean;
  firstSeenAt: number;
  lastSeenAt: number;
  portrait: string | null;
}

export interface Org {
  id: string;
  name: string;
  type: string;
  mainLocationId: string | null;
  standing: number;
  influenceScale: 'local' | 'regional' | 'national' | 'global';
  leaderTitle: string;
  /** NPC id, or null when the leader is unknown/hidden. */
  leaderNpcId: string | null;
  subLeaders: string[];
  purpose: string;
  members: Array<{ npcId: string | null; name: string; rank: string }>;
  influence: Array<{ locationId: string; strength: number }>;
  rules: string[];
  runins: Array<{ id: string; at: number; text: string }>;
  locked: boolean;
}

export interface Quest {
  id: string;
  title: string;
  desc: string;
  status: 'active' | 'done' | 'failed';
  objectives: Array<{ id: string; text: string; done: boolean }>;
  giver: string;
  reward: string;
  createdAt: number;
  updatedAt: number;
}

export interface Fact {
  id: string;
  title: string;
  text: string;
  tags: string[];
  at: number;
  source: string;
}

export interface Relationship {
  id: string;
  name: string;
  npcId: string | null;
  affection: number;
  trust: number;
  label: string;
  memories: Array<{ id: string; at: number; text: string }>;
}

export interface CalendarEvent {
  id: string;
  title: string;
  kind: 'event' | 'birthday' | 'reminder' | 'holiday';
  at: number;
  recurring: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  notes: string;
  npcId: string | null;
  /** Last occurrence time that fired. */
  lastFired: number | null;
}

export interface WorldLogEntry {
  id: string;
  at: number;
  kind: 'event' | 'rumor' | 'schedule' | 'reminder' | 'aging' | 'phone' | 'weather' | 'travel' | 'battle' | 'note';
  text: string;
  seen: boolean;
}

export interface PartyMember {
  id: string;
  name: string;
  npcId: string | null;
  characterId: string | null;
  role: string;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  stats: Stats;
  equipment: Partial<Record<EquipSlot, string>>;
  skills: string[];
}

export interface Combatant {
  id: string;
  name: string;
  side: 'party' | 'enemy';
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  ap: number;
  maxAp: number;
  stats: Stats;
  statuses: Array<{ name: string; turns: number; kind: 'buff' | 'debuff' }>;
  defending: boolean;
  alive: boolean;
  isPlayer: boolean;
  skills: string[];
}

export interface Battle {
  id: string;
  seed: number;
  round: number;
  turnIndex: number;
  order: string[];
  combatants: Record<string, Combatant>;
  log: Array<{ round: number; text: string; kind: 'hit' | 'miss' | 'crit' | 'heal' | 'status' | 'info' | 'defeat' }>;
  status: 'active' | 'won' | 'lost' | 'fled';
  rewards: { xp: number; currency: number; items: string[] } | null;
  startedAt: number;
}

export interface CalendarConfig {
  name: string;
  months: Array<{ name: string; days: number }>;
  weekdays: string[];
  epochYear: number;
  /** Weekday index of day 0. */
  epochWeekday: number;
  /** Tokens: {weekday} {month} {mon} {day} {year} {mm} {dd}. */
  dateFormat: string;
  clock: '12h' | '24h';
}

export interface CampaignState {
  version: number;
  meta: {
    title: string;
    style: Style;
    seed: number;
    currency: { name: string; symbol: string };
    calendar: CalendarConfig;
    dayLength: { mode: 'turns' | 'realtime'; realMinutesPerDay: number };
  };
  time: { minutes: number };
  weather: { kind: WeatherKind; tempC: number; since: number };
  player: Player;
  trackers: Record<string, Tracker>;
  inventory: Record<string, Item>;
  locations: Record<string, Location>;
  routes: Record<string, Route>;
  currentLocationId: string | null;
  npcs: Record<string, Npc>;
  orgs: Record<string, Org>;
  quests: Record<string, Quest>;
  databank: Record<string, Fact>;
  relationships: Record<string, Relationship>;
  events: Record<string, CalendarEvent>;
  worldLog: WorldLogEntry[];
  party: Record<string, PartyMember>;
  battle: Battle | null;
  phone: { unread: Record<string, number>; pending: Array<{ id: string; npcId: string; at: number; reason: string }> };
  counters: Record<string, number>;
}

export type WeatherKind = 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'snow' | 'fog' | 'wind' | 'heat';
export const WEATHER_KINDS: WeatherKind[] = ['clear', 'cloudy', 'overcast', 'rain', 'storm', 'snow', 'fog', 'wind', 'heat'];

export const GREGORIAN: CalendarConfig = {
  name: 'Gregorian',
  months: [
    { name: 'January', days: 31 }, { name: 'February', days: 28 }, { name: 'March', days: 31 }, { name: 'April', days: 30 },
    { name: 'May', days: 31 }, { name: 'June', days: 30 }, { name: 'July', days: 31 }, { name: 'August', days: 31 },
    { name: 'September', days: 30 }, { name: 'October', days: 31 }, { name: 'November', days: 30 }, { name: 'December', days: 31 },
  ],
  weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  epochYear: 2026,
  epochWeekday: 3,
  dateFormat: '{weekday}, {month} {day}, {year}',
  clock: '12h',
};

export function defaultBars(profile: Player['resourceProfile']): Record<string, Bar> {
  const bars: Record<string, Bar> = {
    hp: { id: 'hp', label: 'HP', cur: 100, max: 100, visible: true },
  };
  if (profile !== 'mp') bars.ap = { id: 'ap', label: 'AP', cur: 100, max: 100, visible: true };
  if (profile !== 'ap') bars.mp = { id: 'mp', label: 'MP', cur: 100, max: 100, visible: true };
  bars.xp = { id: 'xp', label: 'XP', cur: 0, max: 100, visible: true };
  return bars;
}

export function defaultTrackers(): Record<string, Tracker> {
  return {
    hunger: { id: 'hunger', label: 'Hunger', value: 20, max: 100, perHour: 4, direction: 'need', visible: true },
    energy: { id: 'energy', label: 'Energy', value: 85, max: 100, perHour: -3, direction: 'fill', visible: true },
    hygiene: { id: 'hygiene', label: 'Hygiene', value: 90, max: 100, perHour: -1.5, direction: 'fill', visible: true },
  };
}

export function createInitialState(opts: Partial<{ title: string; style: Style; seed: number; playerName: string; startMinutes: number }> = {}): CampaignState {
  const style = opts.style ?? 'fantasy';
  return {
    version: STATE_VERSION,
    meta: {
      title: opts.title ?? 'New campaign',
      style,
      seed: opts.seed ?? 1,
      currency: style === 'fantasy' ? { name: 'Gold', symbol: 'g' } : style === 'scifi' ? { name: 'Credits', symbol: 'cr' } : { name: 'Dollars', symbol: '$' },
      calendar: structuredClone(GREGORIAN),
      dayLength: { mode: 'turns', realMinutesPerDay: 20 },
    },
    // July 1, 08:00 of the epoch year.
    time: { minutes: opts.startMinutes ?? (181 * 24 * 60 + 8 * 60) },
    weather: { kind: 'clear', tempC: 21, since: 0 },
    player: {
      name: opts.playerName ?? 'You',
      className: '',
      level: 1,
      age: null,
      ageStage: 'Adult',
      resourceProfile: 'hybrid',
      bars: defaultBars('hybrid'),
      currency: 100,
      skills: {},
      status: {},
      stats: { atk: 10, def: 8, spd: 10, mag: 8 },
      appearance: '',
      birthday: null,
    },
    trackers: defaultTrackers(),
    inventory: {},
    locations: {},
    routes: {},
    currentLocationId: null,
    npcs: {},
    orgs: {},
    quests: {},
    databank: {},
    relationships: {},
    events: {},
    worldLog: [],
    party: {},
    battle: null,
    phone: { unread: {}, pending: [] },
    counters: {},
  };
}

/** Upgrade older state shapes. Add a step per version bump. */
export function migrateState(raw: any): CampaignState {
  if (!raw || typeof raw !== 'object') return createInitialState();
  let s = raw;
  if (!s.version || s.version < 1) {
    s = { ...createInitialState(), ...s, version: 1 };
  }
  // Fill any missing top-level collections defensively.
  const base = createInitialState();
  for (const key of Object.keys(base) as Array<keyof CampaignState>) {
    if (s[key] === undefined) (s as any)[key] = base[key];
  }
  return s as CampaignState;
}
