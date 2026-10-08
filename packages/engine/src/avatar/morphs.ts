/**
 * Body and face sliders for a custom base model, built from the morph targets in its file.
 *
 * Every morph name is classified once (Body, Face or Other; a body kind such as breast size or hips;
 * a side; a direction), then morphs that are the two directions of one shape ("Hips_Wide" and
 * "Hips_Narrow", "…-incr" and "…-decr") become one slider that goes both ways, and left/right twins
 * are marked as a pair. The owner can rename, regroup, hide, set ranges and pair sliders; the result
 * is saved beside the model (`AvatarConfig.morphs`). A slider drives its morphs by name on every mesh
 * that has them, so body, face, lashes and fitted garments stay in step.
 */
import { z } from 'zod';

export const MORPH_GROUPS = ['body', 'face', 'other'] as const;
export type MorphGroup = (typeof MORPH_GROUPS)[number];

/** Body shapes the auto-grouping recognizes (and the region-inflate fallback can stand in for). */
export const BODY_MORPH_KINDS = ['breastSize', 'breastShape', 'hips', 'waist', 'butt', 'thighs', 'belly', 'shoulders', 'muscle', 'weight', 'height', 'arms', 'legs'] as const;
export type BodyMorphKind = (typeof BODY_MORPH_KINDS)[number];

export const BODY_KIND_LABEL: Record<BodyMorphKind, string> = {
  breastSize: 'Breast size', breastShape: 'Breast shape', hips: 'Hips', waist: 'Waist', butt: 'Butt', thighs: 'Thighs', belly: 'Belly',
  shoulders: 'Shoulders', muscle: 'Muscle', weight: 'Weight', height: 'Height', arms: 'Arms', legs: 'Legs',
};

const morphName = z.string().min(1).max(200);
const sliderId = z.string().regex(/^[a-z0-9_-]{1,60}$/);

export const MorphSliderSchema = z.object({
  id: sliderId,
  label: z.string().trim().min(1).max(60),
  group: z.enum(MORPH_GROUPS),
  kind: z.enum(BODY_MORPH_KINDS).nullable().default(null),
  /** Morphs set to the value when it is above zero. */
  plus: z.array(morphName).min(1).max(16),
  /** Morphs set to minus the value when it is below zero (empty: the plus morphs go negative). */
  minus: z.array(morphName).max(16).default([]),
  min: z.number().min(-2).max(0).default(0),
  max: z.number().min(0).max(2).default(1),
  hidden: z.boolean().default(false),
  /** The left/right twin slider: moving one moves both while they are linked. */
  pair: sliderId.nullable().default(null),
  /** Explicit anatomy: only offered for adult characters in adult mode. */
  adult: z.boolean().default(false),
  /** Driven by the expression system (blinks, visemes): hidden from sliders by default. */
  expression: z.boolean().default(false),
});
export type MorphSlider = z.infer<typeof MorphSliderSchema>;

export const MorphPresetSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  name: z.string().trim().min(1).max(60),
  values: z.record(sliderId, z.number().min(-2).max(2)).refine((v) => Object.keys(v).length <= 256, 'Too many values'),
});
export type MorphPreset = z.infer<typeof MorphPresetSchema>;

export const MorphSettingsSchema = z.object({
  /** Identifies the base (morph names, bones, vertex count) so presets apply only to the same base. */
  base: z.string().max(80).nullable().default(null),
  sliders: z.array(MorphSliderSchema).max(256).default([]),
  values: z.record(sliderId, z.number().min(-2).max(2)).refine((v) => Object.keys(v).length <= 256, 'Too many values').default({}),
  /** Left/right pairs move together. */
  linkPairs: z.boolean().default(true),
  presets: z.array(MorphPresetSchema).max(32).default([]),
});
export type MorphSettings = z.infer<typeof MorphSettingsSchema>;

export interface MorphInfo {
  name: string;
  group: MorphGroup;
  kind: BodyMorphKind | null;
  side: 'left' | 'right' | null;
  /** +1 grows the shape, −1 shrinks it, 0 not a direction pair. */
  direction: -1 | 0 | 1;
  /** The name with side and direction words removed (pairs share it). */
  stem: string;
  adult: boolean;
  expression: boolean;
}

const ADULT = /pussy|vagina|vulva|labia|clit|genital|penis|testic|scrotum|nipple|areola|crotch|erect|anus|\bcum\b|\bsex\b/i;
const FACE = /eye|brow|lid|lash|mouth|lip|jaw|cheek|nose|nostril|blink|smile|frown|sneer|pucker|funnel|wink|tongue|teeth|tooth|chin|ear\b|ears|face|forehead|temple|viseme|^vrc\.|^fcl_|^v_|^(aa|ih|ou|ee|oh|a|i|u|e|o)$|^mth|^eye|^brw|^mouth|あ|い|う|え|お|まばたき|笑|ウィンク|眉|目|口/i;
const EXPRESSION = /blink|wink|viseme|^vrc\.v_|^fcl_(mth|eye|brw|all)|^(aa|ih|ou|ee|oh)$|jawopen|mouth(smile|frown|funnel|pucker|stretch|close|open|roll|shrug|press|dimple|left|right|upper|lower)|eye(blink|wide|squint|look)|brow(down|innerup|outerup)|cheek(puff|squint)|nosesneer|tongueout|^あ$|^い$|^う$|^え$|^お$|まばたき|ウィンク|笑い/i;
const KINDS: Array<[BodyMorphKind, RegExp]> = [
  ['breastShape', /(breast|bust|boob|oppai|胸).*(shape|perk|sag|firm|apart|together|gap|point|round|lift|droop|cleav|spread|tilt)|(perk|sag|firm|gap|cleav).*(breast|bust|boob)/i],
  ['breastSize', /breast|bust|boob|\bcup|cupsize|oppai|胸|おっぱい/i],
  ['butt', /butt|buttock|glute|booty|\bass\b|bum\b|尻/i],
  ['hips', /hip|pelvis|腰/i],
  ['waist', /waist|wst|くびれ/i],
  ['thighs', /thigh|upper.?leg|upleg|太もも/i],
  ['belly', /belly|stomach|tummy|abdomen|abs\b|pregnan|navel|\bgut\b|お腹/i],
  ['shoulders', /shoulder|deltoid|trapez|肩/i],
  ['arms', /\barm|forearm|upperarm|lowerarm|腕/i],
  ['legs', /\bleg|calf|calves|shin|\bknee|lowerleg|脚|足/i],
  ['muscle', /muscle|muscul|toned|bodybuild|ripped|pectoral|biceps|筋肉/i],
  ['weight', /weight|\bfat\b|fatness|heavy|chubby|plump|obese|skinny|slim|slender|\bthin\b|\bbmi\b|太/i],
  ['height', /height|\btall\b|\bshort\b/i],
];
const LEFT = [/(?:^|[_.\s-])(?:l|left)(?=$|[_.\s\d-])/i, /left/i, /[a-z0-9]L(?=$|[_.\s-])/, /左/];
const RIGHT = [/(?:^|[_.\s-])(?:r|right)(?=$|[_.\s\d-])/i, /right/i, /[a-z0-9]R(?=$|[_.\s-])/, /右/];
const DIRECTION_WORDS_UP = 'incr|increase|plus|bigger|big|large|larger|wide|wider|thick|thicker|more|max|grow|full|fuller|heavy|out|up|fat';
const DIRECTION_WORDS_DOWN = 'decr|decrease|minus|smaller|small|narrow|narrower|thin|thinner|less|min|shrink|flat|flatter|slim|light|in|down';
const UP_WORD = new RegExp(`^(?:${DIRECTION_WORDS_UP})$`);
const DIRECTION_WORD = new RegExp(`(?:^|[_.\\s-]+)(?:${DIRECTION_WORDS_UP}|${DIRECTION_WORDS_DOWN})(?=$|[_.\\s-])`, 'g');
/** The last direction word decides ("upperarm-fat-decr" shrinks); a trailing + or − counts too. */
function directionOf(lower: string): -1 | 0 | 1 {
  const words = [...lower.matchAll(DIRECTION_WORD)].map((m) => m[0].replace(/^[_.\s-]+/, ''));
  const last = words[words.length - 1];
  if (last) return UP_WORD.test(last) ? 1 : -1;
  return /\+$/.test(lower) ? 1 : /[a-z]-$/.test(lower) ? -1 : 0;
}

/** Classifies one morph target name. */
export function classifyMorph(name: string): MorphInfo {
  const adult = ADULT.test(name);
  const side: MorphInfo['side'] = LEFT.some((re) => re.test(name)) ? 'left' : RIGHT.some((re) => re.test(name)) ? 'right' : null;
  const lower = name.toLowerCase();
  const direction = directionOf(lower);
  const stem = lower
    .replace(DIRECTION_WORD, '')
    .replace(/(?:^|[_.\s-])(?:l|r|left|right)(?=$|[_.\s\d-])/g, '_')
    .replace(/left|right|左|右/g, '')
    .replace(/[+-]$/, '')
    .replace(/[_.\s-]+/g, '_')
    .replace(/^_|_$/g, '');
  const kind = adult ? null : KINDS.find(([, re]) => re.test(name))?.[0] ?? null;
  const face = !kind && FACE.test(name);
  const expression = EXPRESSION.test(name);
  const group: MorphGroup = adult ? 'other' : kind ? 'body' : face || expression ? 'face' : 'other';
  return { name, group, kind, side, direction, stem: stem || lower, adult, expression };
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 52) || 'morph';
const tidy = (s: string) => s.replace(/^(EverloomBody_|blendShape\d*\.|BS_|bs_|shape_|Shape_|Key_)/, '').replace(/[_.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();

/**
 * Sliders for a model's morph names: one per shape, with grow/shrink pairs merged into one slider
 * that goes both ways and left/right twins marked. Generated morphs (the region-inflate fallback)
 * are left out; they have their own controls.
 */
export function buildMorphSliders(names: readonly string[]): MorphSlider[] {
  const infos = [...new Set(names)].filter((n) => !/^EverloomBody_/.test(n) && !n.startsWith('vrm:')).map(classifyMorph);
  const used = new Set<string>();
  const sliders: MorphSlider[] = [];
  const ids = new Set<string>();
  const uniqueId = (base: string) => {
    let id = slug(base), n = 2;
    while (ids.has(id)) id = `${slug(base).slice(0, 50)}_${n++}`;
    ids.add(id);
    return id;
  };
  // Grow/shrink pairs first: same stem, kind and side, opposite directions.
  for (const up of infos) {
    if (used.has(up.name) || up.direction !== 1) continue;
    const down = infos.find((d) => !used.has(d.name) && d.direction === -1 && d.stem === up.stem && d.side === up.side && d.group === up.group);
    if (!down) continue;
    used.add(up.name); used.add(down.name);
    const label = (up.kind && !sliders.some((s) => s.kind === up.kind && classifyMorph(s.plus[0]!).side === up.side) ? `${BODY_KIND_LABEL[up.kind]}${up.side ? ` (${up.side})` : ''}` : tidy(up.stem.replace(/_/g, ' '))) || tidy(up.name);
    sliders.push({ id: uniqueId(up.stem + (up.side ? `_${up.side[0]}` : '')), label: label[0]!.toUpperCase() + label.slice(1), group: up.group, kind: up.kind, plus: [up.name], minus: [down.name], min: -1, max: 1, hidden: up.expression, pair: null, adult: up.adult || down.adult, expression: up.expression && down.expression });
  }
  for (const m of infos) {
    if (used.has(m.name)) continue;
    used.add(m.name);
    const label = tidy(m.name) || m.name;
    sliders.push({ id: uniqueId(m.name), label: label.slice(0, 60), group: m.group, kind: m.kind, plus: [m.name], minus: [], min: 0, max: 1, hidden: m.expression, pair: null, adult: m.adult, expression: m.expression });
  }
  // Left/right twins.
  const sideOf = (s: MorphSlider) => classifyMorph(s.plus[0]!).side;
  const stemOf = (s: MorphSlider) => classifyMorph(s.plus[0]!).stem;
  for (const a of sliders) {
    if (a.pair || sideOf(a) !== 'left') continue;
    const b = sliders.find((x) => !x.pair && x !== a && sideOf(x) === 'right' && stemOf(x) === stemOf(a) && x.group === a.group);
    if (b) { a.pair = b.id; b.pair = a.id; }
  }
  const order: Record<MorphGroup, number> = { body: 0, face: 1, other: 2 };
  const kindOrder = (k: BodyMorphKind | null) => (k ? BODY_MORPH_KINDS.indexOf(k) : 99);
  return sliders.sort((a, b) => order[a.group] - order[b.group] || kindOrder(a.kind) - kindOrder(b.kind) || a.label.localeCompare(b.label));
}

/**
 * Keeps the owner's edits (labels, groups, ranges, hidden, pairs) when a model is read again, adds
 * sliders for new morphs and drops ones whose morphs are gone.
 */
export function mergeMorphSliders(saved: readonly MorphSlider[], names: readonly string[]): MorphSlider[] {
  const have = new Set(names);
  const kept = saved.filter((s) => s.plus.every((m) => have.has(m)) && s.minus.every((m) => have.has(m)));
  const covered = new Set(kept.flatMap((s) => [...s.plus, ...s.minus]));
  const fresh = buildMorphSliders(names.filter((n) => !covered.has(n))).filter((s) => !kept.some((k) => k.id === s.id));
  const ids = new Set([...kept, ...fresh].map((s) => s.id));
  return [...kept, ...fresh].map((s) => (s.pair && !ids.has(s.pair) ? { ...s, pair: null } : s));
}

/** Morph name → influence for a set of slider values (clamped to each slider's range). */
export function morphWeights(sliders: readonly MorphSlider[], values: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sliders) {
    const v = Math.min(s.max, Math.max(s.min, values[s.id] ?? 0));
    if (v >= 0 || !s.minus.length) {
      for (const m of s.plus) out[m] = (out[m] ?? 0) + v;
      for (const m of s.minus) out[m] ??= 0;
    } else {
      for (const m of s.minus) out[m] = (out[m] ?? 0) - v;
      for (const m of s.plus) out[m] ??= 0;
    }
  }
  return out;
}

/** Sliders the current character may use (explicit anatomy only for adults in adult mode). */
export function visibleSliders(sliders: readonly MorphSlider[], opts: { adultAllowed: boolean; showHidden?: boolean }): MorphSlider[] {
  return sliders.filter((s) => (opts.showHidden || !s.hidden) && (!s.adult || opts.adultAllowed));
}

/** A short, stable id for a base: the same morph names, bones and vertex count give the same id. */
export function baseKey(input: { morphs: readonly string[]; bones: readonly string[]; vertices: number }): string {
  const text = [[...input.morphs].sort().join('|'), [...input.bones].sort().join('|'), input.vertices].join('#');
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0;
  }
  return `base-${h1.toString(36)}${h2.toString(36)}`;
}

/** Which generated (region-inflate) adjuster stands in for a body kind the file has no morph for. */
export const FALLBACK_FOR_KIND: Partial<Record<BodyMorphKind, 'chest' | 'buttocks' | 'hips' | 'waist' | 'thighs' | 'shoulders'>> = {
  breastSize: 'chest', butt: 'buttocks', hips: 'hips', waist: 'waist', thighs: 'thighs', shoulders: 'shoulders',
};
