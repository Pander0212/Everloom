/**
 * Crafting: one recipe system for cooking, alchemy, forge, enchantment and general crafting.
 * A recipe needs ingredients (carried), a station (home amenity or a public place), a discipline
 * level and time. The outcome is deterministic apart from one seeded dice roll on the shared curve.
 */
import { extractJson } from '../util/json-extract.js';
import { createRng, seedFrom } from '../util/rng.js';
import { slugify } from '../util/text.js';
import { catalogFor } from './economy.js';
import { stationHere } from './home.js';
import { OpSchemas3 } from './ops3.js';
import type { CampaignState, Discipline, Item, Quality, Recipe, Stats, Style } from './state.js';
import { checkOdds, tierFor, type CheckTier } from './tick.js';

export const DISCIPLINES: Array<{ id: Discipline; label: string }> = [
  { id: 'cooking', label: 'Cooking' },
  { id: 'alchemy', label: 'Alchemy' },
  { id: 'forge', label: 'Forge' },
  { id: 'enchantment', label: 'Enchantment' },
  { id: 'general', label: 'Crafting' },
];

export const QUALITY_MULT: Record<Quality, number> = { poor: 0.8, common: 1, fine: 1.15, superior: 1.3, masterwork: 1.5 };
const DIFFICULTY: Record<Recipe['difficulty'], number> = { easy: -2, normal: 0, hard: 2, 'very hard': 4 };

type R = Omit<Recipe, 'id' | 'source'>;
const r = (name: string, discipline: Discipline, ingredients: Array<[string, number]>, station: string | null, level: number, minutes: number, difficulty: Recipe['difficulty'], result: R['result'], enchant: R['enchant'] = null): R => ({
  name,
  discipline,
  ingredients: ingredients.map(([n, q]) => ({ name: n, qty: q })),
  station,
  level,
  minutes,
  difficulty,
  result,
  enchant,
});

const BUILTIN: Record<Style, R[]> = {
  fantasy: [
    r('Herb Bread', 'cooking', [['Flour', 1], ['Herbs', 1]], null, 0, 45, 'easy', { name: 'Herb Bread', qty: 2, category: 'food', value: 0.2, effects: { trackers: { hunger: -25 } } }),
    r('Fisherman’s Stew', 'cooking', [['Salted Fish', 1], ['Herbs', 1], ['Apples', 1]], null, 1, 60, 'normal', { name: 'Fisherman’s Stew', qty: 1, category: 'food', value: 0.8, effects: { trackers: { hunger: -45, energy: 10 } } }),
    r('Healing Draught', 'alchemy', [['Moonpetal', 2], ['Empty Vial', 1]], null, 0, 60, 'normal', { name: 'Healing Draught', qty: 1, category: 'medicine', value: 4, effects: { bars: { hp: 30 } } }),
    r('Mana Draught', 'alchemy', [['Moonpetal', 1], ['Arcane Dust', 1], ['Empty Vial', 1]], null, 1, 60, 'hard', { name: 'Mana Draught', qty: 1, category: 'consumable', value: 6, effects: { bars: { mp: 30 } } }),
    r('Iron Dagger', 'forge', [['Iron Ingot', 2]], null, 0, 120, 'easy', { name: 'Iron Dagger', qty: 1, category: 'weapon', value: 6, stats: { atk: 3 }, slot: 'weapon' }),
    r('Iron Sword', 'forge', [['Iron Ingot', 4], ['Whetstone', 1]], null, 1, 240, 'normal', { name: 'Forged Iron Sword', qty: 1, category: 'weapon', value: 16, stats: { atk: 6 }, slot: 'weapon' }),
    r('Iron Helm', 'forge', [['Iron Ingot', 3]], null, 1, 180, 'normal', { name: 'Iron Helm', qty: 1, category: 'armor', value: 9, stats: { def: 2 }, slot: 'head' }),
    r('Rune of Sharpness', 'enchantment', [['Arcane Dust', 2]], null, 0, 90, 'normal', { name: 'Sharpness', qty: 1, category: 'misc', value: 0 }, { effect: 'Sharpness', stats: { atk: 2 } }),
    r('Rune of Warding', 'enchantment', [['Minor Rune Stone', 1]], null, 1, 90, 'hard', { name: 'Warding', qty: 1, category: 'misc', value: 0 }, { effect: 'Warding', stats: { def: 2 } }),
    r('Linen Bandage', 'general', [['Wool Bundle', 1]], null, 0, 30, 'easy', { name: 'Linen Bandage', qty: 2, category: 'medicine', value: 0.3, effects: { bars: { hp: 10 } } }),
  ],
  modern: [
    r('Fried Rice', 'cooking', [['Rice (1 kg)', 1], ['Eggs (dozen)', 1], ['Vegetables', 1]], null, 0, 30, 'easy', { name: 'Fried Rice', qty: 3, category: 'food', value: 4, effects: { trackers: { hunger: -35 } } }),
    r('Vegetable Omelette', 'cooking', [['Eggs (dozen)', 1], ['Vegetables', 1]], null, 1, 20, 'normal', { name: 'Vegetable Omelette', qty: 2, category: 'food', value: 5, effects: { trackers: { hunger: -30, energy: 5 } } }),
    r('Homemade Energy Tonic', 'alchemy', [['Energy Drink', 1], ['Vitamins', 1]], null, 0, 15, 'easy', { name: 'Energy Tonic', qty: 1, category: 'drink', value: 6, effects: { trackers: { energy: 30 } } }),
    r('First-aid Kit', 'general', [['Bandages', 2], ['Painkillers', 1]], null, 0, 20, 'easy', { name: 'First-aid Kit', qty: 1, category: 'medicine', value: 20, effects: { bars: { hp: 30 } } }),
    r('Improvised Baton', 'forge', [['Flashlight', 1]], null, 0, 60, 'normal', { name: 'Improvised Baton', qty: 1, category: 'weapon', value: 10, stats: { atk: 2 }, slot: 'weapon' }),
  ],
  scifi: [
    r('Algae Loaf', 'cooking', [['Algae Flour', 2]], null, 0, 40, 'easy', { name: 'Algae Loaf', qty: 2, category: 'food', value: 5, effects: { trackers: { hunger: -30 } } }),
    r('Combat Stim', 'alchemy', [['Medgel', 1], ['Stim Injector', 1]], null, 1, 30, 'hard', { name: 'Combat Stim', qty: 1, category: 'medicine', value: 110, effects: { bars: { hp: 40, ap: 20 } } }),
    r('Alloy Knife', 'forge', [['Alloy Plate', 2]], null, 0, 90, 'normal', { name: 'Alloy Knife', qty: 1, category: 'weapon', value: 70, stats: { atk: 4 }, slot: 'weapon' }),
    r('Shield Tuning', 'enchantment', [['Shield Cell', 1]], null, 0, 60, 'normal', { name: 'Shield Tuning', qty: 1, category: 'misc', value: 0 }, { effect: 'Tuned Shielding', stats: { def: 3 } }),
    r('Patch Kit', 'general', [['Alloy Plate', 1]], null, 0, 30, 'easy', { name: 'Patch Kit', qty: 1, category: 'tool', value: 35 }),
  ],
};

export function builtinRecipes(style: Style): Recipe[] {
  return (BUILTIN[style] ?? BUILTIN.fantasy).map((x) => ({ ...x, id: `builtin_${slugify(x.name)}`, source: 'builtin' as const }));
}

export function allRecipes(s: CampaignState): Recipe[] {
  return [...builtinRecipes(s.meta.style), ...Object.values(s.recipes)];
}

export function findRecipe(s: CampaignState, idOrName: string): Recipe | undefined {
  const n = idOrName.toLowerCase();
  return allRecipes(s).find((x) => x.id === idOrName || x.name.toLowerCase() === n);
}

export function disciplineLevel(s: CampaignState, d: Discipline): number {
  return s.player.crafting?.[d]?.level ?? 0;
}

const carried = (s: CampaignState) => Object.values(s.inventory).filter((i) => (i.holder ?? null) === null);
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function haveQty(s: CampaignState, name: string): number {
  return carried(s)
    .filter((i) => sameName(i.name, name))
    .reduce((n, i) => n + i.qty, 0);
}

export interface CraftCheck {
  ok: boolean;
  problems: string[];
  station: string | null;
  odds: number;
}

/** Everything that stands between the player and this recipe, and the odds of a good result. */
export function craftCheck(s: CampaignState, recipe: Recipe, target?: Item | null): CraftCheck {
  const problems: string[] = [];
  for (const ing of recipe.ingredients) {
    const have = haveQty(s, ing.name);
    if (have < ing.qty) problems.push(`Need ${ing.qty}× ${ing.name} (you have ${have})`);
  }
  const station = stationHere(s, recipe.discipline, recipe.station);
  if (!station) problems.push(`Needs a ${recipe.station ?? DISCIPLINES.find((d) => d.id === recipe.discipline)!.label.toLowerCase()} station (a home room with one, or a public place)`);
  const level = disciplineLevel(s, recipe.discipline);
  if (level < recipe.level) problems.push(`${DISCIPLINES.find((d) => d.id === recipe.discipline)!.label} level ${recipe.level} needed (you have ${level})`);
  if (recipe.enchant) {
    if (!target) problems.push('Choose the item to enchant');
    else if (!['weapon', 'armor', 'clothing', 'accessory'].includes(target.category)) problems.push(`${target.name} can't be enchanted`);
    else if ((target.enchantments?.length ?? 0) >= (target.enchantSlots ?? 1)) problems.push(`${target.name} has no free enchantment slot`);
  }
  return { ok: !problems.length, problems, station, odds: checkOdds(craftGap(s, recipe)) };
}

export function craftGap(s: CampaignState, recipe: Recipe): number {
  return (disciplineLevel(s, recipe.discipline) - recipe.level) * 1.5 + (s.player.level - 1) / 4 + 1 - DIFFICULTY[recipe.difficulty];
}

export interface CraftOutcome {
  tier: CheckTier;
  quality: Quality;
  /** How many results; 0 = the attempt failed (ingredients are still used). */
  qty: number;
  /** Enchantment: whether it took, and whether the item lost a slot on a critical failure. */
  enchanted: boolean;
  slotLost: boolean;
  xp: number;
}

/** The roll. `n` is a per-campaign craft counter, so every attempt differs but replays identically. */
export function craftOutcome(s: CampaignState, recipe: Recipe, n: number): CraftOutcome {
  const odds = checkOdds(craftGap(s, recipe));
  const roll = createRng(seedFrom(s.meta.seed, 'craft', recipe.id, n)).next();
  const tier = tierFor(odds, roll);
  const xp = 10 * (recipe.level + 1) + (tier === 'critical success' ? 5 : 0);
  if (recipe.enchant) {
    return { tier, quality: 'common', qty: 0, enchanted: tier === 'success' || tier === 'critical success', slotLost: tier === 'critical failure', xp };
  }
  const margin = odds - roll; // > 0 on success
  let quality: Quality;
  if (tier === 'critical success') quality = 'masterwork';
  else if (tier === 'success') quality = margin > 0.35 ? 'superior' : margin > 0.15 ? 'fine' : 'common';
  else if (tier === 'failure') quality = 'poor';
  else quality = 'poor';
  // Food and potions: a failure still makes something, just less; a critical failure ruins the batch.
  // Gear: a failure makes poor-quality gear, a critical failure wastes the materials.
  const base = recipe.result.qty;
  const qty = tier === 'critical failure' ? 0 : tier === 'failure' ? Math.max(recipe.discipline === 'forge' ? 1 : 0, Math.floor(base / 2)) : tier === 'critical success' && recipe.discipline !== 'forge' ? base + 1 : base;
  return { tier, quality, qty, enchanted: false, slotLost: false, xp };
}

export function applyQuality(stats: Partial<Stats> | undefined, q: Quality): Partial<Stats> {
  const out: Partial<Stats> = {};
  for (const [k, v] of Object.entries(stats ?? {})) out[k as keyof Stats] = Math.round((v as number) * QUALITY_MULT[q] * 10) / 10;
  return out;
}

export const xpForCraftLevel = (level: number) => 100 * (level + 1);

// ------------------------------------------------------------------ AI-suggested recipes (user confirms)


export function buildRecipePrompt(s: CampaignState, discipline: Discipline, idea: string): Array<{ role: 'system' | 'user'; content: string }> {
  const label = DISCIPLINES.find((d) => d.id === discipline)!.label;
  const sold = [...new Set(['general', 'food', 'smith', 'alchemist', 'market', 'magic', 'tech', 'pharmacy'].flatMap((k) => catalogFor(s.meta.style, k as never).map((c) => c.name)))];
  const known = allRecipes(s).map((r) => r.name);
  const here = s.currentLocationId ? s.locations[s.currentLocationId]?.name : null;
  return [
    {
      role: 'system',
      content: `You design one crafting recipe for a ${s.meta.style} roleplay game. It must fit the world, be buildable from ingredients players can buy, and be balanced (level 0–3, a few ingredients).
Reply with JSON only:
{"name":"...","discipline":"${discipline}","ingredients":[{"name":"...","qty":1}],"level":0,"minutes":60,"difficulty":"easy|normal|hard|very hard","result":{"name":"...","qty":1,"category":"food|drink|medicine|consumable|weapon|armor|clothing|tool|material|misc","value":1,"effects":{"trackers":{"hunger":-20},"bars":{"hp":10}},"stats":{"atk":2},"slot":"weapon"}${discipline === 'enchantment' ? ',"enchant":{"effect":"short name","stats":{"atk":2}}' : ''}}
Prices are in ${s.meta.currency.name}; keep "value" close to what the ingredients cost.`,
    },
    {
      role: 'user',
      content: `Discipline: ${label}
Ingredients sold in this world (prefer these): ${sold.slice(0, 60).join(', ')}
Recipes that already exist (make something different): ${known.join(', ') || 'none'}
${here ? `The player is at ${here}.\n` : ''}Idea: ${idea.trim() || '(anything that fits)'}`,
    },
  ];
}

/** A suggested recipe, checked against the same schema as a hand-made one. */
export function parseRecipeSuggestion(text: string, discipline: Discipline) {
  const j = extractJson<Record<string, unknown>>(text);
  if (!j.ok || !j.value || typeof j.value !== 'object') throw new Error('The model did not return a recipe');
  const parsed = OpSchemas3['recipe.add'].safeParse({ ...j.value, type: 'recipe.add', discipline, source: 'ai' });
  if (!parsed.success) throw new Error(`The suggested recipe was incomplete: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}
