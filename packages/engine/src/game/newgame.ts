/** New Game wizard → initial campaign state. Pure: the same config always gives the same state. */
import { applyOps } from './reducer.js';
import type { Op } from './ops.js';
import { createInitialState, defaultBars, type Bar, type CampaignState, type ItemCategory, type Style, type Tracker } from './state.js';
import { slugify } from '../util/text.js';

export interface NewGameConfig {
  title: string;
  style: Style;
  seed: number;
  character: {
    name: string;
    className: string;
    resourceProfile: 'hybrid' | 'ap' | 'mp';
    level: number;
    age: number | null;
    ageStage: string;
    customBars: Array<{ id?: string; label: string; max: number; cur?: number }>;
  };
  appearance: string;
  currency: { name: string; symbol: string; amount: number };
  groups: Array<{ name: string; type: string; standing: number; rank?: string }>;
  trackers: Array<{ id: string; label: string; enabled: boolean; value: number; max: number; perHour: number; direction: 'need' | 'fill' }>;
  items: Array<{ name: string; qty: number; category?: ItemCategory; equipped?: boolean; desc?: string }>;
  skills: Array<{ name: string; kind: 'attack' | 'heal' | 'buff' | 'debuff' | 'utility'; cost: number; costType: 'mp' | 'ap' | 'none'; power: number; desc?: string }>;
  quests: Array<{ title: string; desc?: string; objectives: string[] }>;
  npcs: Array<{ name: string; role?: string; personality?: string; appearance?: string }>;
  location: { world: string; region: string; local: string; description: string; kind?: string };
  startDate: { year: number; month: number; day: number; hour: number };
  dayLength: { mode: 'turns' | 'realtime'; realMinutesPerDay: number };
  facts: string[];
}

export const TRACKER_PRESETS: NewGameConfig['trackers'] = [
  { id: 'hunger', label: 'Hunger', enabled: true, value: 20, max: 100, perHour: 4, direction: 'need' },
  { id: 'energy', label: 'Energy', enabled: true, value: 85, max: 100, perHour: -3, direction: 'fill' },
  { id: 'hygiene', label: 'Hygiene', enabled: true, value: 90, max: 100, perHour: -1.5, direction: 'fill' },
  { id: 'thirst', label: 'Thirst', enabled: false, value: 15, max: 100, perHour: 6, direction: 'need' },
  { id: 'stress', label: 'Stress', enabled: false, value: 20, max: 100, perHour: 0, direction: 'need' },
  { id: 'morale', label: 'Morale', enabled: false, value: 70, max: 100, perHour: 0, direction: 'fill' },
];

export function defaultNewGame(seed = 1): NewGameConfig {
  return {
    title: 'New story',
    style: 'fantasy',
    seed,
    character: { name: '', className: '', resourceProfile: 'hybrid', level: 1, age: 18, ageStage: 'Young adult', customBars: [] },
    appearance: '',
    currency: { name: 'Gold', symbol: 'g', amount: 100 },
    groups: [],
    trackers: TRACKER_PRESETS.map((t) => ({ ...t })),
    items: [],
    skills: [],
    quests: [],
    npcs: [],
    location: { world: '', region: '', local: '', description: '' },
    startDate: { year: 2026, month: 7, day: 1, hour: 8 },
    dayLength: { mode: 'turns', realMinutesPerDay: 20 },
    facts: [],
  };
}

export function buildNewGameState(cfg: NewGameConfig): CampaignState {
  const s = createInitialState({ title: cfg.title || 'New story', style: cfg.style, seed: cfg.seed, playerName: cfg.character.name || 'You' });
  s.meta.currency = { name: cfg.currency.name || s.meta.currency.name, symbol: cfg.currency.symbol ?? s.meta.currency.symbol };
  s.meta.dayLength = { ...cfg.dayLength };
  // Start date (month is 1-based in the config).
  let days = (cfg.startDate.year - s.meta.calendar.epochYear) * 365;
  for (let i = 0; i < cfg.startDate.month - 1; i++) days += s.meta.calendar.months[i]?.days ?? 30;
  days += Math.max(0, cfg.startDate.day - 1);
  s.time.minutes = Math.max(0, days * 1440 + cfg.startDate.hour * 60);
  s.weather.since = s.time.minutes;
  const p = s.player;
  p.className = cfg.character.className;
  p.resourceProfile = cfg.character.resourceProfile;
  p.bars = defaultBars(cfg.character.resourceProfile);
  for (const b of cfg.character.customBars) {
    const id = b.id || slugify(b.label);
    p.bars[id] = { id, label: b.label, cur: b.cur ?? b.max, max: b.max, visible: true } satisfies Bar;
  }
  p.age = cfg.character.age;
  p.ageStage = cfg.character.ageStage;
  p.appearance = cfg.appearance;
  p.currency = cfg.currency.amount;
  const lvl = Math.max(1, Math.min(99, cfg.character.level));
  p.level = lvl;
  for (const bar of Object.values(p.bars)) if (bar.id !== 'xp') bar.max = bar.cur = bar.max + (lvl - 1) * (bar.id === 'hp' ? 10 : 5);
  p.stats = { atk: 9 + lvl, def: 7 + lvl, spd: 9 + lvl, mag: 7 + lvl };
  s.trackers = {};
  for (const t of cfg.trackers.filter((x) => x.enabled)) {
    s.trackers[t.id] = { id: t.id, label: t.label, value: t.value, max: t.max, perHour: t.perHour, direction: t.direction, visible: true } satisfies Tracker;
  }

  const ops: Op[] = [];
  const L = cfg.location;
  const world = L.world.trim() || (cfg.style === 'scifi' ? 'The Reach' : cfg.style === 'modern' ? 'The City' : 'The Realm');
  const region = L.region.trim();
  const local = L.local.trim();
  ops.push({ type: 'location.upsert', name: world, level: 'world', parent: null, kind: 'realm', x: 500, y: 500 } as Op);
  if (region) ops.push({ type: 'location.upsert', name: region, level: 'region', parent: world, kind: 'region' } as Op);
  if (local) ops.push({ type: 'location.upsert', name: local, level: 'local', parent: region || world, kind: (L.kind as any) || 'town', description: L.description } as Op);
  ops.push({ type: 'location.move', to: local || region || world } as Op);
  for (const g of cfg.groups.filter((x) => x.name.trim())) {
    ops.push({ type: 'org.upsert', name: g.name.trim(), orgType: g.type || 'organization', standing: g.standing } as Op);
  }
  for (const it of cfg.items.filter((x) => x.name.trim())) {
    ops.push({ type: 'item.add', name: it.name.trim(), qty: Math.max(1, it.qty), ...(it.category ? { category: it.category } : {}), ...(it.desc ? { desc: it.desc } : {}) } as Op);
    if (it.equipped) ops.push({ type: 'item.equip', name: it.name.trim(), equipped: true } as Op);
  }
  for (const sk of cfg.skills.filter((x) => x.name.trim())) ops.push({ type: 'skill.add', ...sk, name: sk.name.trim() } as Op);
  for (const q of cfg.quests.filter((x) => x.title.trim())) ops.push({ type: 'quest.add', title: q.title.trim(), desc: q.desc, objectives: q.objectives.filter(Boolean) } as Op);
  for (const n of cfg.npcs.filter((x) => x.name.trim())) ops.push({ type: 'npc.upsert', name: n.name.trim(), role: n.role, personality: n.personality, appearance: n.appearance, location: local || region || world } as Op);
  for (const f of cfg.facts.filter((x) => x.trim())) ops.push({ type: 'databank.add', text: f.trim() } as Op);
  const r = applyOps(s, ops, { source: 'system' });
  // Nothing from setup should show up as "new" in the world log.
  for (const e of r.state.worldLog) e.seen = true;
  return r.state;
}
