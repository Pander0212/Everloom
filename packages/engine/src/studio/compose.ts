/**
 * Resolves what a character looks like in a template: which layers are drawn (by trait, outfit,
 * expression and scene option, with fallbacks for options a template has no art for), in which
 * order (z rules), recoloured how, and with which cages at which slider values. The renderer only
 * executes this plan, so the same sheet gives the same look in every template.
 */
import { resolvedSliders, type TraitSheet } from './traits.js';
import type { Layer, Slot, Template, When } from './template.js';

export interface PlannedLayer {
  layer: Layer;
  z: number;
  recolor: Array<{ kind: Layer['recolor'][number]['kind']; base: string; target: string; mask?: string }>;
}
export interface SlotPlan {
  slot: Slot;
  layers: PlannedLayer[];
  sliders: Record<string, number>;
  /** Options that fell back (the template has no art for the sheet's choice). */
  fallbacks: string[];
}
export interface ScenePlan { slots: SlotPlan[]; options: Record<string, string> }

export interface ComposeState {
  expression?: string;
  /** Scene option values (by option id); defaults come from the template. */
  options?: Record<string, string>;
  /** Show adult layers (18+ templates only, and only for an adult sheet: all studio sheets are). */
  explicit?: boolean;
}

/** Fallback order for hairstyles a template lacks: the nearest look it has. */
const HAIR_BACK_FALLBACK: Record<string, string[]> = {
  short: ['bob', 'ponytail'], bob: ['short', 'long_straight'], long_straight: ['long_wavy', 'bob'], long_wavy: ['long_straight', 'bob'],
  ponytail: ['bun', 'long_straight'], twin_tails: ['ponytail', 'long_straight'], bun: ['ponytail', 'short'], braid: ['ponytail', 'long_straight'],
};

function pick(want: string, supported: string[], fallback: string[] = []): string {
  if (!supported.length || supported.includes(want)) return want;
  return fallback.find((f) => supported.includes(f)) ?? supported[0]!;
}

/** The trait values a template will actually draw for a sheet (after fallbacks). */
export function effectiveTraits(t: Template, sheet: TraitSheet, state: ComposeState = {}) {
  const s = t.supports;
  const expression = state.expression && s.expressions.includes(state.expression as never) ? state.expression : s.expressions.includes(sheet.expressions[0]!) ? sheet.expressions[0]! : s.expressions[0] ?? 'neutral';
  const v = {
    'hair.front': pick(sheet.hair.front, s.hairFront, ['bangs', 'side_swept', 'none']),
    'hair.back': pick(sheet.hair.back, s.hairBack, HAIR_BACK_FALLBACK[sheet.hair.back]),
    'hair.side': pick(sheet.hair.side, s.hairSide, ['none']),
    'face.preset': pick(sheet.face.preset, s.facePreset, ['soft']),
    'face.makeup': sheet.face.makeup,
    'face.brows': sheet.face.brows,
    'face.freckles': sheet.face.freckles,
    'face.mole': sheet.face.mole,
    'body.bodyHair': sheet.body.bodyHair,
    sex: sheet.sex,
    expression,
  } as Record<string, string | boolean>;
  for (const [slot, item] of Object.entries(sheet.wardrobe)) {
    const have = s.wardrobe[slot as keyof typeof s.wardrobe] ?? [];
    v[`wardrobe.${slot}`] = item && have.includes(item) ? item : 'none';
  }
  const options: Record<string, string> = {};
  for (const o of t.options) {
    const want = state.options?.[o.id];
    options[o.id] = want && o.values.some((x) => x.id === want) ? want : o.default ?? o.values[0]!.id;
    v[`option.${o.id}`] = options[o.id]!;
  }
  const fallbacks: string[] = [];
  if (v['hair.back'] !== sheet.hair.back) fallbacks.push(`hair.back ${sheet.hair.back} → ${v['hair.back']}`);
  if (v['hair.front'] !== sheet.hair.front) fallbacks.push(`hair.front ${sheet.hair.front} → ${v['hair.front']}`);
  for (const [slot, item] of Object.entries(sheet.wardrobe)) if (item && v[`wardrobe.${slot}`] === 'none') fallbacks.push(`${slot} ${item}: not in this template`);
  return { values: v, options, fallbacks };
}

export function matches(when: When, values: Record<string, string | boolean>): boolean {
  for (const [k, want] of Object.entries(when)) {
    const have = values[k] ?? (k.startsWith('wardrobe.') ? 'none' : undefined);
    const list = ([] as Array<string | boolean>).concat(want);
    if (!list.includes(have as string | boolean)) return false;
  }
  return true;
}

/** The full plan for one character in one template slot (the first slot that fits its sex, by default). */
export function composeSlot(t: Template, slot: Slot, sheet: TraitSheet, state: ComposeState = {}): SlotPlan {
  const { values, fallbacks } = effectiveTraits(t, sheet, state);
  const layers: PlannedLayer[] = [];
  for (const l of slot.layers) {
    if (l.part === 'background' || l.part === 'pov') continue;
    if (l.adult && !(state.explicit && t.rating === '18+')) continue;
    if (!matches(l.when, values)) continue;
    const zr = l.zRules.find((r) => matches(r.when, values));
    const recolor = l.recolor.map((r) => ({
      kind: r.kind, base: r.base, mask: r.mask,
      target: r.kind === 'hair' ? sheet.hair.color : r.kind === 'highlight' ? sheet.hair.highlight ?? sheet.hair.color : r.kind === 'eyes' ? sheet.face.eyeColor : sheet.body.skin,
    }));
    layers.push({ layer: l, z: zr ? zr.z : l.z, recolor });
  }
  layers.sort((a, b) => a.z - b.z || a.layer.id.localeCompare(b.layer.id));
  return { slot, layers, sliders: resolvedSliders(sheet), fallbacks };
}

/** Plans a whole template: each character in its slot (in order), plus background and POV layers. */
export function composeScene(t: Template, cast: TraitSheet[], state: ComposeState = {}): ScenePlan {
  const slots: SlotPlan[] = [];
  const free = [...t.slots];
  for (const sheet of cast) {
    const i = free.findIndex((s) => s.sex.includes(sheet.sex));
    if (i < 0) continue;
    slots.push(composeSlot(t, free[i]!, sheet, state));
    free.splice(i, 1);
  }
  return { slots, options: effectiveTraits(t, cast[0] ?? ({} as TraitSheet), state).options };
}

/** A stable key for caching a composite (rebuild only when something that changes pixels changes). */
export function compositeKey(t: Template, plan: SlotPlan): string {
  return JSON.stringify([t.id, t.version, plan.layers.map((l) => [l.layer.id, l.z, l.recolor.map((r) => r.target)]), Object.values(plan.sliders).map((v) => Math.round(v * 100))]);
}
