/**
 * Feature switches: every module can be turned off, and "off" means completely off: no UI entry, no
 * prompt text, no model calls, no background work, and the tracker's op list loses its op types.
 * Nothing is deleted; turning a module back on brings everything back.
 *
 * Three presets (Classic chat, Story, Full RPG) set the switches; a chat can override the global
 * choice with a preset of its own.
 */
import type { WorldSettings } from './api/types.js';

export type FeatureGroup = 'game' | 'story' | 'helpers' | 'tools';

export interface FeatureDef {
  id: FeatureId;
  group: FeatureGroup;
  label: string;
  description: string;
  /** Features this one needs; turning one of them off turns this off too. */
  requires: FeatureId[];
}

export const FEATURES = [
  // The game layer: `game` is the master switch for everything in its group.
  { id: 'game', group: 'game', label: 'Game layer', description: 'Everything below: the world state the story keeps track of.', requires: [] },
  { id: 'trackers', group: 'game', label: 'Status bar and trackers', description: 'Health, mood, relationships and other stats shown above the chat.', requires: ['game'] },
  { id: 'inventory', group: 'game', label: 'Inventory and economy', description: 'Items, money, shops, banking and trade.', requires: ['game'] },
  { id: 'crafting', group: 'game', label: 'Crafting', description: 'Recipes, stations and making things.', requires: ['inventory'] },
  { id: 'map', group: 'game', label: 'Map', description: 'Places and where everyone is.', requires: ['game'] },
  { id: 'travel', group: 'game', label: 'Travel', description: 'Journeys, transit lines, routes and arrival events.', requires: ['map', 'time'] },
  { id: 'time', group: 'game', label: 'Calendar and time', description: 'The in-story clock, dates and events.', requires: ['game'] },
  { id: 'npcs', group: 'game', label: 'NPC simulation and schedules', description: 'Where people are and what they do when you are not there.', requires: ['time'] },
  { id: 'orgs', group: 'game', label: 'Organizations', description: 'Factions, groups and your standing with them.', requires: ['game'] },
  { id: 'party', group: 'game', label: 'Party', description: 'Companions, classes, skills and levels.', requires: ['game'] },
  { id: 'battle', group: 'game', label: 'Battle', description: 'Turn-based fights with your party.', requires: ['party'] },
  { id: 'home', group: 'game', label: 'Player home', description: 'Homes, rooms, storage and the household.', requires: ['map'] },
  { id: 'phone', group: 'game', label: 'Phone and messages', description: 'Texts, calls, letters, email and the social feed.', requires: ['game'] },
  { id: 'diary', group: 'game', label: 'Diary', description: 'Your own notes and pictures from the story.', requires: ['game'] },
  { id: 'journal', group: 'game', label: 'Journal', description: 'Quests and objectives.', requires: ['game'] },
  { id: 'databank', group: 'game', label: 'Databank', description: 'Facts the story has established.', requires: ['game'] },
  { id: 'helper', group: 'game', label: 'Helper', description: 'A small companion you can ask about the game.', requires: ['game'] },
  { id: 'dice', group: 'game', label: 'Dice', description: 'Skill checks with real odds.', requires: ['game'] },
  { id: 'storylines', group: 'game', label: 'Storylines and random events', description: 'Off-screen plots and events that happen on their own.', requires: ['game'] },
  { id: 'weather', group: 'game', label: 'Weather and atmosphere', description: 'Weather, seasons and the mood overlay.', requires: ['time'] },
  // Story presentation.
  { id: 'stage', group: 'story', label: 'Stage mode', description: 'The visual-novel view with sprites and backgrounds.', requires: [] },
  { id: 'effects', group: 'story', label: 'Scene effects', description: 'Rain, fog, embers and other overlays.', requires: ['stage'] },
  { id: 'cutscenes', group: 'story', label: 'Cutscenes', description: 'Short directed scenes.', requires: ['stage'] },
  { id: 'music', group: 'story', label: 'Music', description: 'Playlists by scene, place and battle.', requires: [] },
  { id: 'ambience', group: 'story', label: 'Ambience', description: 'Background sound for the scene.', requires: [] },
  { id: 'live2d', group: 'story', label: 'Live2D', description: 'Animated Live2D models on the stage.', requires: ['stage'] },
  // AI helpers: extra model work around a reply.
  { id: 'trackerPass', group: 'helpers', label: 'Tracker pass', description: 'A second, small model call after each reply that updates the game state.', requires: ['trackers'] },
  { id: 'sceneBlock', group: 'helpers', label: 'Scene block', description: 'The game state and what each person knows, added to the prompt.', requires: ['game'] },
  { id: 'offscreen', group: 'helpers', label: 'Off-screen life', description: 'A background call now and then for what people do to each other.', requires: ['npcs'] },
  { id: 'preRead', group: 'helpers', label: 'Pre-read', description: 'A model read of your message before the reply (movement, time, dice). Adds a little delay.', requires: ['game'] },
  // Tools.
  { id: 'scripts', group: 'tools', label: 'Scripts', description: 'Scripts in cards, presets and lorebooks, run in a sandbox.', requires: [] },
  { id: 'extensions', group: 'tools', label: 'Extensions', description: 'Installable add-ons.', requires: [] },
  { id: 'interactive', group: 'tools', label: 'Interactive message cards', description: 'HTML and JavaScript inside messages, run in a sandbox.', requires: ['scripts'] },
  { id: 'sources', group: 'tools', label: 'Online character sources', description: 'Browse and import characters from websites.', requires: [] },
  { id: 'voice', group: 'tools', label: 'Voice', description: 'Reading replies aloud and speaking your messages.', requires: [] },
  { id: 'imagegen', group: 'tools', label: 'Image generation', description: 'Backgrounds, portraits and pictures from an image model.', requires: [] },
] as const satisfies ReadonlyArray<{ id: string; group: FeatureGroup; label: string; description: string; requires: readonly string[] }>;

export type FeatureId = (typeof FEATURES)[number]['id'];
export const FEATURE_IDS = FEATURES.map((f) => f.id) as FeatureId[];
export type MemoryMode = 'full' | 'summary' | 'off';

export interface FeatureSet {
  on: Record<FeatureId, boolean>;
  memory: MemoryMode;
}

export type FeaturePreset = 'classic' | 'story' | 'full';
export const FEATURE_PRESETS: FeaturePreset[] = ['classic', 'story', 'full'];
export const PRESET_INFO: Record<FeaturePreset, { label: string; description: string }> = {
  classic: { label: 'Classic chat', description: 'A clean roleplay frontend: character, persona, lorebook, examples, history. One model call per reply; no game features.' },
  story: { label: 'Story', description: 'Long-term memory, light tracking and the stage. No economy, battles or map.' },
  full: { label: 'Full RPG', description: 'Everything: the world, the game systems and every helper.' },
};

const all = (v: boolean) => Object.fromEntries(FEATURE_IDS.map((id) => [id, v])) as Record<FeatureId, boolean>;

export function presetFeatures(p: FeaturePreset): FeatureSet {
  if (p === 'full') return { on: all(true), memory: 'full' };
  if (p === 'classic') return { on: { ...all(false), sources: true, voice: true, imagegen: true, scripts: true, extensions: true, interactive: true }, memory: 'off' };
  const on = all(false);
  for (const id of ['game', 'trackers', 'time', 'diary', 'journal', 'databank', 'stage', 'effects', 'cutscenes', 'music', 'ambience', 'live2d', 'trackerPass', 'sceneBlock', 'scripts', 'extensions', 'interactive', 'sources', 'voice', 'imagegen', 'weather'] as FeatureId[]) on[id] = true;
  return { on, memory: 'full' };
}

const DEF = new Map<FeatureId, FeatureDef>(FEATURES.map((f) => [f.id, f as unknown as FeatureDef]));
export const featureDef = (id: FeatureId) => DEF.get(id)!;

/** Everything that depends on `id`, directly or not (turned off with it). */
export function dependentsOf(id: FeatureId): FeatureId[] {
  const out: FeatureId[] = [];
  const visit = (x: FeatureId) => {
    for (const f of FEATURES) if ((f.requires as readonly FeatureId[]).includes(x) && !out.includes(f.id)) {
      out.push(f.id);
      visit(f.id);
    }
  };
  visit(id);
  return out;
}

/** Everything `id` needs, directly or not (turned on with it). */
export function requirementsOf(id: FeatureId): FeatureId[] {
  const out: FeatureId[] = [];
  const visit = (x: FeatureId) => {
    for (const r of DEF.get(x)!.requires as FeatureId[]) if (!out.includes(r)) {
      out.push(r);
      visit(r);
    }
  };
  visit(id);
  return out;
}

/**
 * Switch one feature. Returns the new set and what else changed: turning something off turns off
 * what depends on it; turning something on turns on what it needs. The UI shows `also` first.
 */
export function toggleFeature(set: FeatureSet, id: FeatureId, value: boolean): { set: FeatureSet; also: FeatureId[] } {
  const on = { ...set.on, [id]: value };
  const related = value ? requirementsOf(id) : dependentsOf(id);
  const also = related.filter((x) => on[x] !== value);
  for (const x of also) on[x] = value;
  return { set: { ...set, on }, also };
}

/** A set with every dependency satisfied (anything whose requirement is off is off). */
export function normalizeFeatures(set: FeatureSet): FeatureSet {
  const on = { ...all(true), ...set.on };
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of FEATURES) if (on[f.id] && (f.requires as readonly FeatureId[]).some((r) => !on[r])) {
      on[f.id] = false;
      changed = true;
    }
  }
  return { on, memory: (['full', 'summary', 'off'] as const).includes(set.memory) ? set.memory : 'full' };
}

/** Which preset a set equals, if any. */
export function presetOf(set: FeatureSet): FeaturePreset | 'custom' {
  for (const p of FEATURE_PRESETS) {
    const q = presetFeatures(p);
    if (q.memory === set.memory && FEATURE_IDS.every((id) => q.on[id] === set.on[id])) return p;
  }
  return 'custom';
}

export interface FeatureSettings {
  /** The global choice ("custom" when switches were changed by hand). */
  preset: FeaturePreset | 'custom';
  set: FeatureSet;
}
export const defaultFeatureSettings = (): FeatureSettings => ({ preset: 'full', set: presetFeatures('full') });

/**
 * The switches in force for one chat: its own preset when it has one, else the global settings.
 * A chat-level preset is a whole preset; per-module tuning is global.
 */
export function effectiveFeatures(global: FeatureSettings | undefined, chatPreset: FeaturePreset | null | undefined): FeatureSet {
  if (chatPreset) return presetFeatures(chatPreset);
  return normalizeFeatures(global?.set ?? presetFeatures('full'));
}

/** The world engine's switches with the feature switches applied on top. */
export function effectiveWorld(world: WorldSettings, f: FeatureSet): WorldSettings {
  const memoryFull = f.memory === 'full';
  return {
    ...world,
    memory: world.memory && f.memory !== 'off',
    semantic: world.semantic && memoryFull,
    chronicler: world.chronicler && f.memory !== 'off',
    consolidate: world.consolidate && memoryFull,
    social: world.social && f.on.offscreen,
    preRead: world.preRead && f.on.preRead,
    intent: world.intent && f.on.game && f.on.map,
    pulse: world.pulse && f.on.storylines,
    threads: world.threads && f.on.storylines,
    threadSeeding: world.threadSeeding && f.on.storylines,
    dice: world.dice && f.on.dice,
    hearsay: world.hearsay && f.on.npcs,
  };
}

/** Which feature owns an op type, by namespace (the part before the dot) or full name. */
const OP_OWNER: Record<string, FeatureId> = {
  time: 'time', 'event.add': 'time', 'event.remove': 'time', activity: 'time',
  weather: 'weather',
  tracker: 'trackers', bar: 'trackers', status: 'trackers', relationship: 'trackers', bond: 'trackers', outfit: 'trackers', goal: 'trackers', player: 'trackers', world: 'trackers',
  currency: 'inventory', item: 'inventory', bill: 'inventory', asset: 'inventory', shop: 'inventory',
  xp: 'party', skill: 'party', party: 'party',
  location: 'map',
  travel: 'travel', route: 'travel', transit: 'travel',
  npc: 'npcs',
  org: 'orgs',
  quest: 'journal',
  databank: 'databank',
  thread: 'storylines',
  battle: 'battle',
  phone: 'phone', mail: 'phone', feed: 'phone',
  home: 'home', room: 'home', household: 'home',
  fx: 'effects', stage: 'stage', cutscene: 'cutscenes', music: 'music', ambient: 'ambience',
};

export function opFeature(type: string): FeatureId {
  return OP_OWNER[type] ?? OP_OWNER[type.split('.')[0]!] ?? 'trackers';
}

/** The op types the tracker may use under these switches (fewer types, a cheaper call). */
export function allowedOpTypes(types: readonly string[], f: FeatureSet): string[] {
  if (!f.on.game) return [];
  return types.filter((t) => f.on[opFeature(t)]);
}
