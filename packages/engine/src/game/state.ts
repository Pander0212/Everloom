/** Versioned campaign state. Everything here is plain JSON so it can be stored, diffed and replayed. */

export const STATE_VERSION = 3;

export type Style = 'fantasy' | 'modern' | 'scifi';
export type MapLevel = 'world' | 'region' | 'local' | 'nearby' | 'area';
export const MAP_LEVELS: MapLevel[] = ['world', 'region', 'local', 'nearby', 'area'];

export type LocationKind =
  | 'city' | 'town' | 'village' | 'district' | 'building' | 'room' | 'wilds' | 'road' | 'station' | 'dock'
  | 'landmark' | 'shop' | 'service' | 'danger' | 'interior' | 'home' | 'vehicle' | 'region' | 'realm' | 'other'
  // Phase 3 transit hubs (station and dock above are hubs too).
  | 'airport' | 'portal' | 'stable' | 'taxi' | 'bank';

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
  /** What they're wearing and when that was last shown (game minutes). */
  outfit: Outfit | null;
  classId?: string | null;
  statPoints?: number;
  skillPoints?: number;
  /** Skill-tree node id → rank. */
  skillRanks?: Record<string, number>;
  /** Public reputation, -100..100. */
  reputation?: number;
  /** Wanted level, 0 (none) .. 5. */
  wanted?: number;
  crafting?: Partial<Record<Discipline, { level: number; xp: number }>>;
}

export interface Outfit {
  text: string;
  at: number;
}

export type GoalState = 'dormant' | 'acting' | 'blocked' | 'resolved' | 'failed';

/** Something an NPC wants. An acting goal with a target place is pursued hop by hop off-screen. */
export interface Goal {
  id: string;
  text: string;
  state: GoalState;
  urgency: number;
  targetLocationId: string | null;
  /** Game minute after which a dormant goal wakes up. */
  activateAt: number | null;
  deadline: number | null;
}

/** A directional feeling from one character toward another (NPC ↔ NPC). */
export interface Bond {
  from: string;
  to: string;
  affinity: number;
  trust: number;
  desire: number;
  tension: number;
  kind: string;
}

/** An off-screen storyline climbing rumor → visible → unmistakable → head. */
export interface Thread {
  id: string;
  text: string;
  stages: string[];
  rung: number;
  max: number;
  pace: number;
  bias: number;
  lastBeat: number;
  status: 'active' | 'head' | 'done';
  placeId: string | null;
  createdAt: number;
  /** The chat turn it began on: its heartbeat is a pure function of turns since then. */
  bornTurn: number;
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
  /** Who holds it: null = the player; 'party' = the shared party bag; 'member:<id>'; 'store:<storageId>' at a home. */
  holder?: string | null;
  /** Containers: how many stacks fit inside. */
  capacity?: number;
  /** Crafted gear: poor, common, fine, superior, masterwork. */
  quality?: Quality;
  enchantSlots?: number;
  enchantments?: string[];
}

export type Quality = 'poor' | 'common' | 'fine' | 'superior' | 'masterwork';

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
  requires?: Requirement[];
}

/** A condition checked by code before travel (routes, transit lines, places). */
export type Requirement =
  | { kind: 'discovered' }
  | { kind: 'fare'; amount: number }
  | { kind: 'vehicle'; mode: string }
  | { kind: 'item'; name: string }
  | { kind: 'standing'; org: string; min: number }
  | { kind: 'reputation'; min: number }
  | { kind: 'quest'; title: string; state: 'active' | 'done' }
  | { kind: 'partySize'; max: number }
  | { kind: 'notWanted'; max: number }
  | { kind: 'hours'; open: number; close: number }
  | { kind: 'weather'; not: WeatherKind[] };

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
  outfit: Outfit | null;
  goals: Goal[];
  /** Knocked out: present but can't act. */
  unconscious: boolean;
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
  /** 'fact' is settled; 'development' is still moving (with a trend). */
  kind: 'fact' | 'development';
  trend: 'emerging' | 'rising' | 'stable' | 'falling' | 'uncertain' | null;
  status: 'active' | 'resolved';
}

export interface Relationship {
  id: string;
  name: string;
  npcId: string | null;
  affection: number;
  trust: number;
  desire: number;
  tension: number;
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
  /** The narrator may describe what happens to them but never voice them. */
  sovereign: boolean;
  row?: 'front' | 'back';
  /** In the active party (the rest are reserves). */
  active?: boolean;
  roleKind?: PartyRole | null;
  tactics?: Tactics;
  xp?: number;
  classId?: string | null;
  statPoints?: number;
  skillPoints?: number;
  skillRanks?: Record<string, number>;
  /** Extra vitals shown for this member (e.g. Sanity), id → value. */
  vitals?: Record<string, { label: string; cur: number; max: number }>;
  injuries?: string[];
}

export type PartyRole = 'tank' | 'healer' | 'damage' | 'support' | 'scout';
export interface TacticRule {
  /** e.g. "heal when an ally is under 30%" → { when: 'allyHpBelow', value: 30, do: 'heal' } */
  when: 'allyHpBelow' | 'selfHpBelow' | 'enemyBroken' | 'always';
  value: number;
  do: 'heal' | 'defend' | 'attackWeakest' | 'attackStrongest' | 'skill';
  skill?: string;
}
export interface Tactics {
  preset: 'balanced' | 'aggressive' | 'defensive' | 'heal-first' | 'conserve';
  rules: TacticRule[];
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
  row?: 'front' | 'back';
  /** Break gauge: hits on a weakness drain it; at 0 the combatant is broken for a while. */
  breakMax?: number;
  breakCur?: number;
  brokenTurns?: number;
  weaknesses?: string[];
  /** What an enemy will do on its next turn (shown to the player). */
  intent?: { kind: 'attack' | 'heavy' | 'charge' | 'heal' | 'defend'; target: string | null; label: string } | null;
  /** In reserve (party only): can be swapped in. */
  reserve?: boolean;
  /** Party member id this combatant came from. */
  memberId?: string | null;
  /** Damage dealt and taken this battle (for the summary). */
  dealt?: number;
  taken?: number;
}

export interface BattleSummary {
  rounds: number;
  dealt: number;
  taken: number;
  mvp: string | null;
  breaks: number;
  levelUps: string[];
  injuries: string[];
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
  /** Who acts first among the party and speaks for it. */
  leader?: string;
  summary?: BattleSummary | null;
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

// ------------------------------------------------------------------ Phase 3: economy

export interface Denomination {
  name: string;
  symbol: string;
  /** Worth in main-currency units (Gold = 1, Silver = 0.1, Copper = 0.01). */
  value: number;
}
export interface ExtraCurrency {
  id: string;
  name: string;
  symbol: string;
  /** Main-currency units per 1 of this currency. */
  rate: number;
}
export interface Account {
  id: string;
  name: string;
  bankLocationId: string | null;
  balance: number;
  /** Yearly interest, e.g. 0.02 = 2%. */
  apr: number;
  /** Game day index interest was last added. */
  lastAccrued: number;
}
export interface Loan {
  id: string;
  lender: string;
  principal: number;
  balance: number;
  apr: number;
  installment: number;
  periodDays: number;
  status: 'active' | 'paid' | 'defaulted';
  billId: string | null;
}
export type BillKind = 'rent' | 'subscription' | 'dues' | 'upkeep' | 'loan' | 'other';
export interface Bill {
  id: string;
  name: string;
  kind: BillKind;
  amount: number;
  periodDays: number;
  /** Game minute it's next due. */
  nextDue: number;
  autopay: boolean;
  /** Consecutive missed payments. */
  missed: number;
  /** Late fees owed on top of the next payment. */
  owed: number;
  status: 'active' | 'ended';
  homeId: string | null;
  assetId: string | null;
  loanId: string | null;
  orgId: string | null;
}
export interface Asset {
  id: string;
  name: string;
  kind: 'property' | 'vehicle' | 'business' | 'animal' | 'other';
  value: number;
  upkeep: number;
  income: number;
  periodDays: number;
  nextPayout: number;
  locationId: string | null;
  /** Travel modes this asset provides (vehicles, mounts). */
  modes: string[];
  status: 'owned' | 'rented' | 'borrowed' | 'lost';
  billId: string | null;
}
export interface LedgerEntry {
  id: string;
  at: number;
  text: string;
  amount: number;
  /** 'wallet', an account id, or an extra currency id. */
  where: string;
}
export type ShopKind = 'general' | 'food' | 'tavern' | 'smith' | 'alchemist' | 'clothier' | 'books' | 'magic' | 'tech' | 'pharmacy' | 'market' | 'stable' | 'other';
export interface ShopStock {
  id: string;
  name: string;
  category: ItemCategory;
  basePrice: number;
  qty: number;
  maxQty: number;
  desc: string;
  effects?: ItemEffects;
  slot?: EquipSlot | null;
  stats?: Partial<Stats>;
}
export interface Shop {
  id: string;
  name: string;
  kind: ShopKind;
  npcId: string | null;
  locationId: string | null;
  orgId: string | null;
  /** Opening hours, minutes of day (close < open wraps midnight); days empty = every day. */
  open: number;
  close: number;
  days: number[];
  stock: Record<string, ShopStock>;
  restockDays: number;
  lastRestock: number;
  /** Today's haggling result (price multiplier) and the day it applies to. */
  haggle: { day: number; mult: number } | null;
}
export interface Economy {
  denominations: Denomination[];
  currencies: Record<string, ExtraCurrency>;
  /** Balances of extra currencies (the main one is player.currency). */
  wallet: Record<string, number>;
  accounts: Record<string, Account>;
  loans: Record<string, Loan>;
  bills: Record<string, Bill>;
  assets: Record<string, Asset>;
  shops: Record<string, Shop>;
  ledger: LedgerEntry[];
}

// ------------------------------------------------------------------ Phase 3: homes and crafting

export type HomeKind = 'house' | 'apartment' | 'room' | 'guild' | 'castle' | 'cabin' | 'campsite' | 'cave' | 'vehicle' | 'other';
export interface Room {
  id: string;
  name: string;
  purpose: string;
  /** Amenity ids (see AMENITIES): bed, kitchen, forge, alchemy, enchanting, workbench, bath… */
  amenities: string[];
  level: number;
}
export interface Storage {
  id: string;
  name: string;
  capacity: number;
}
export interface Home {
  id: string;
  name: string;
  kind: HomeKind;
  locationId: string | null;
  ownership: 'owned' | 'rented' | 'borrowed' | 'lost';
  primary: boolean;
  rooms: Room[];
  storage: Storage[];
  billId: string | null;
  notes: string;
}
export type HouseholdRole = 'head' | 'resident' | 'dependent' | 'guardian' | 'guest';
export interface HouseholdMember {
  id: string;
  name: string;
  npcId: string | null;
  homeId: string;
  role: HouseholdRole;
  relation: string;
  /** Where they are when not at home (work, school), or when a guest visits: slots with a place. */
  schedule: ScheduleSlot[];
}
export type Discipline = 'cooking' | 'alchemy' | 'forge' | 'enchantment' | 'general';
export interface Recipe {
  id: string;
  name: string;
  discipline: Discipline;
  ingredients: Array<{ name: string; qty: number }>;
  /** Amenity id needed (kitchen, forge…); a matching public place also works. */
  station: string | null;
  level: number;
  minutes: number;
  difficulty: 'easy' | 'normal' | 'hard' | 'very hard';
  result: { name: string; qty: number; category: ItemCategory; value: number; effects?: ItemEffects; stats?: Partial<Stats>; slot?: EquipSlot | null };
  /** Enchantment recipes add this to an item instead of making one. */
  enchant?: { effect: string; stats?: Partial<Stats> } | null;
  source: 'builtin' | 'ai' | 'user';
}

// ------------------------------------------------------------------ Phase 3: travel, progression, communication

export interface TransitLine {
  id: string;
  name: string;
  /** Travel mode id (train, ferry, bus, airship…). */
  mode: string;
  stops: string[];
  /** Minutes of day of the first and last departure from the first stop, and the interval. */
  first: number;
  last: number;
  every: number;
  days: number[];
  /** Minutes between consecutive stops. */
  hop: number;
  fare: number;
  farePerStop: number;
  requires: Requirement[];
}
export interface TravelEntry {
  id: string;
  at: number;
  from: string;
  to: string;
  mode: string;
  minutes: number;
  cost: number;
}
export type FxKind = 'shake' | 'flash' | 'fade' | 'blur' | 'vignette' | 'heartbeat' | 'sparkle' | 'rain' | 'snow' | 'glitch' | 'fog' | 'embers' | 'lightning';
export type StagePosition = 'left' | 'center' | 'right' | 'off';
export type StageAnim = 'none' | 'bounce' | 'nod' | 'shake' | 'slide-in' | 'fade-in';
export type AmbientKind = 'auto' | 'none' | 'rain' | 'storm' | 'wind' | 'city' | 'crowd' | 'forest' | 'sea' | 'fire' | 'night';
export interface StageLayer {
  name: string;
  position: StagePosition;
  expression: string | null;
  anim: StageAnim;
  /** Bumped on every change, so the UI replays the animation. */
  cue: number;
}
export interface CutsceneStep {
  text: string;
  speaker?: string;
  /** A media id for the backdrop, or null to keep the current one. */
  background?: string | null;
  fx?: FxKind;
  mood?: string;
  seconds?: number;
  /** 3D characters: the speaker plays this emote, or changes outfit (null: their own clothes). */
  emote?: string;
  outfit?: string | null;
}
export interface Cutscene {
  id: string;
  name: string;
  steps: CutsceneStep[];
  source: 'user' | 'ai';
}
export interface StageState {
  cues: Array<{ id: string; effect: FxKind; intensity: number; seconds: number }>;
  layers: Record<string, StageLayer>;
  cutscenes: Record<string, Cutscene>;
  playing: { id: string; cue: string } | null;
  music: { playlist: string | null; mood: string | null };
  ambient: AmbientKind;
  /** 3D characters: held pose, a named outfit (null: by equipment), and the last one-off emote. */
  avatars?: Record<string, AvatarStageState>;
  /** A paired or group animation (a handshake): who takes part, in role order; `cue` changes every time. */
  paired?: { clip: string; who: string[]; cue: string } | null;
}
export interface AvatarStageState {
  name: string;
  pose: string | null;
  outfit: string | null;
  /** The last one-off emote; `cue` changes every time so the same emote can play twice. */
  emote: { id: string; cue: string } | null;
}
export const emptyStage = (): StageState => ({ cues: [], layers: {}, cutscenes: {}, playing: null, music: { playlist: null, mood: null }, ambient: 'auto' });

export type LevelCurve = 'gentle' | 'standard' | 'steep';
export type XpSource = 'battle' | 'quests' | 'discovery' | 'crafting';
export interface PartyMeta {
  /** 'player' or a party member id. */
  leader: string;
  maxActive: number;
  curve?: LevelCurve;
  /** Which things give XP (all on when unset). */
  xpSources?: Partial<Record<XpSource, boolean>>;
}
export interface ClassDef {
  id: string;
  name: string;
  desc: string;
  growth: Partial<Stats>;
  hpPerLevel: number;
  mpPerLevel: number;
  builtin: boolean;
}
export interface SkillNode {
  id: string;
  name: string;
  desc: string;
  classId: string | null;
  kind: Skill['kind'];
  cost: number;
  costType: Skill['costType'];
  power: number;
  element: string | null;
  target: TargetKind;
  maxRank: number;
  requires: { level?: number; skills?: string[]; item?: string; quest?: string };
  source: 'builtin' | 'ai' | 'user';
}
export type TargetKind = 'single' | 'all' | 'row' | 'random' | 'self' | 'ally' | 'allies';
export interface Mail {
  id: string;
  kind: 'letter' | 'email';
  direction: 'in' | 'out';
  npcId: string | null;
  from: string;
  to: string;
  subject: string;
  body: string;
  sentAt: number;
  deliverAt: number;
  courier: 'post' | 'courier' | 'bird' | 'express' | null;
  read: boolean;
  /** An outgoing letter that expects an answer: the reply arrives this long after delivery. */
  replyDue: number | null;
  /** The reply to this outgoing letter has been queued. */
  replied?: boolean;
  /** An incoming letter whose words are written when it's first opened. */
  pending?: boolean;
  /** What it cost to send. */
  cost?: number;
}
export interface PhoneGroup {
  id: string;
  name: string;
  members: string[];
}
export interface PhoneApp {
  id: string;
  name: string;
  icon: string;
  /** What the app does, as an instruction to the utility model. */
  prompt: string;
}
export interface FeedPost {
  id: string;
  at: number;
  npcId: string | null;
  author: string;
  text: string;
  likes: number;
  liked: boolean;
  comments: Array<{ id: string; author: string; text: string; at: number }>;
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
    /** Checkpoints and road encounters on arrival (on unless turned off; who's there is always noted). */
    arrivalEvents?: boolean;
  };
  time: { minutes: number };
  weather: { kind: WeatherKind; tempC: number; since: number };
  /** Extension-owned state, one object per extension id (only changed through `ext.op`). */
  ext?: Record<string, Record<string, any>>;
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
  phone: {
    unread: Record<string, number>;
    pending: Array<{ id: string; npcId: string; at: number; reason: string }>;
    groups?: Record<string, PhoneGroup>;
    apps?: Record<string, PhoneApp>;
  };
  counters: Record<string, number>;
  /** NPC ↔ NPC feelings, keyed "fromId>toId". */
  bonds: Record<string, Bond>;
  threads: Record<string, Thread>;
  /** Names the player deleted; the model may not re-create them. */
  forgotten: string[];
  // Phase 3
  economy: Economy;
  homes: Record<string, Home>;
  household: Record<string, HouseholdMember>;
  recipes: Record<string, Recipe>;
  transit: Record<string, TransitLine>;
  travelLog: TravelEntry[];
  classes: Record<string, ClassDef>;
  skillTree: Record<string, SkillNode>;
  partyMeta: PartyMeta;
  mail: Record<string, Mail>;
  feed: FeedPost[];
  /** The visual-novel stage: effect cues, character layers, cutscenes, music and ambience. */
  stage?: StageState;
  /** The last arrival's consequences, shown in the scene until the next trip. */
  arrival?: { at: number; locationId: string; mode: string; notes: string[] } | null;
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
      outfit: null,
      classId: null,
      statPoints: 0,
      skillRanks: {},
      reputation: 0,
      wanted: 0,
      crafting: {},
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
    bonds: {},
    threads: {},
    forgotten: [],
    ...phase3Defaults(style),
  };
}

/** Everything Phase 3 added, empty, for a new campaign or an upgraded one. */
export function phase3Defaults(style: Style): Pick<CampaignState, 'economy' | 'homes' | 'household' | 'recipes' | 'transit' | 'travelLog' | 'classes' | 'skillTree' | 'partyMeta' | 'mail' | 'feed'> {
  return {
    economy: { denominations: defaultDenominations(style), currencies: {}, wallet: {}, accounts: {}, loans: {}, bills: {}, assets: {}, shops: {}, ledger: [] },
    homes: {},
    household: {},
    recipes: {},
    transit: {},
    travelLog: [],
    classes: {},
    skillTree: {},
    partyMeta: { leader: 'player', maxActive: 4 },
    mail: {},
    feed: [],
  };
}

export function defaultDenominations(style: Style): Denomination[] {
  if (style === 'fantasy')
    return [
      { name: 'Gold', symbol: 'g', value: 1 },
      { name: 'Silver', symbol: 's', value: 0.1 },
      { name: 'Copper', symbol: 'c', value: 0.01 },
    ];
  return [];
}

/** Upgrade older state shapes. Add a step per version bump. */
export function migrateState(raw: any): CampaignState {
  if (!raw || typeof raw !== 'object') return createInitialState();
  let s = raw;
  if (!s.version || s.version < 1) {
    s = { ...createInitialState(), ...s, version: 1 };
  }
  // Fill any missing top-level collections defensively (in the campaign's own genre).
  const base = createInitialState({ style: s.meta?.style });
  for (const key of Object.keys(base) as Array<keyof CampaignState>) {
    if (s[key] === undefined) (s as any)[key] = base[key];
  }
  if (s.version < 2) {
    // Phase 2: outfits, goals, knockouts, bond dimensions, fact kinds. Nothing is removed.
    s = { ...s, version: 2 };
    s.player = { ...s.player, outfit: s.player?.outfit ?? null };
    for (const id of Object.keys(s.npcs ?? {})) s.npcs[id] = { outfit: null, goals: [], unconscious: false, ...s.npcs[id] };
    for (const id of Object.keys(s.relationships ?? {})) s.relationships[id] = { desire: 0, tension: 0, ...s.relationships[id] };
    for (const id of Object.keys(s.databank ?? {})) s.databank[id] = { kind: 'fact', trend: null, status: 'active', ...s.databank[id] };
    for (const id of Object.keys(s.party ?? {})) s.party[id] = { sovereign: false, ...s.party[id] };
  }
  if (s.version < 3) {
    // Phase 3: economy, homes, crafting, transit, progression, mail. Everything is added; nothing changes meaning.
    const add = phase3Defaults(s.meta?.style ?? 'fantasy');
    s = { ...s, ...Object.fromEntries(Object.entries(add).filter(([k]) => s[k] === undefined)), version: 3 };
    s.player = { classId: null, statPoints: 0, skillRanks: {}, reputation: 0, wanted: 0, crafting: {}, ...s.player };
    const members = Object.values(s.party ?? {}) as any[];
    members.forEach((m, i) => (s.party[m.id] = { row: 'front', active: i < 4, roleKind: null, tactics: { preset: 'balanced', rules: [] }, xp: 0, classId: null, statPoints: 0, skillRanks: {}, vitals: {}, injuries: [], ...m }));
    for (const id of Object.keys(s.inventory ?? {})) s.inventory[id] = { holder: null, ...s.inventory[id] };
  }
  return s as CampaignState;
}
