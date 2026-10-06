/**
 * Code-made characters: a body and clothes described by a small recipe (no model file). The web
 * app builds the model from it when needed; NPCs get one from their description automatically, and
 * the utility model can fill one in from a character card (validated by this schema).
 */
import { z } from 'zod';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const unit = z.number().min(0).max(1);

export const AGE_STAGES = ['child', 'teen', 'adult', 'elder'] as const;
export const HAIR_STYLES = ['none', 'buzz', 'short', 'bob', 'long', 'ponytail', 'bun', 'twintails', 'spiky', 'curly'] as const;
export const TOPS = ['none', 'tshirt', 'shirt', 'tank', 'sweater', 'jacket', 'robe', 'armor'] as const;
export const BOTTOMS = ['none', 'pants', 'shorts', 'skirt', 'long_skirt'] as const;
export const SHOES = ['none', 'shoes', 'boots', 'sandals'] as const;
export const HATS = ['none', 'cap', 'beanie', 'wizard', 'hood', 'crown', 'headband'] as const;
export const EXTRAS = ['cape', 'scarf', 'belt', 'glasses', 'earrings', 'apron'] as const;

export const AvatarRecipeSchema = z.object({
  v: z.literal(1).default(1),
  body: z
    .object({
      age: z.enum(AGE_STAGES).default('adult'),
      /** Height in metres (scaled within what suits the age). */
      height: z.number().min(0.8).max(2.3).default(1.68),
      /** 0 slender … 1 heavy. */
      build: unit.default(0.4),
      /** 0 = narrower shoulders, wider hips; 1 = broader shoulders, narrower hips. */
      frame: unit.default(0.5),
      /** Chest shape for adult and elder bodies (0 flat … 1 full). */
      chest: unit.default(0.3),
      skin: hex.default('#e8bfa0'),
    })
    .default({ age: 'adult', height: 1.68, build: 0.4, frame: 0.5, chest: 0.3, skin: '#e8bfa0' }),
  face: z
    .object({
      eyes: hex.default('#5a3d2b'),
      /** 0 small … 1 large (anime eyes). */
      eyeSize: unit.default(0.55),
      brows: hex.nullable().default(null),
      blush: z.boolean().default(false),
    })
    .default({ eyes: '#5a3d2b', eyeSize: 0.55, brows: null, blush: false }),
  hair: z.object({ style: z.enum(HAIR_STYLES).default('short'), color: hex.default('#3b2a20'), length: unit.default(0.5) }).default({ style: 'short', color: '#3b2a20', length: 0.5 }),
  top: z.object({ kind: z.enum(TOPS).default('shirt'), color: hex.default('#5b7fa6'), sleeve: unit.default(0.5), accent: hex.nullable().default(null) }).default({ kind: 'shirt', color: '#5b7fa6', sleeve: 0.5, accent: null }),
  bottom: z.object({ kind: z.enum(BOTTOMS).default('pants'), color: hex.default('#3d3a4a'), length: unit.default(1) }).default({ kind: 'pants', color: '#3d3a4a', length: 1 }),
  shoes: z.object({ kind: z.enum(SHOES).default('shoes'), color: hex.default('#3a2a20') }).default({ kind: 'shoes', color: '#3a2a20' }),
  hat: z.object({ kind: z.enum(HATS).default('none'), color: hex.default('#6b3a2a') }).default({ kind: 'none', color: '#6b3a2a' }),
  extras: z.array(z.object({ kind: z.enum(EXTRAS), color: hex.default('#7a2a2a') })).max(6).default([]),
});
export type AvatarRecipe = z.infer<typeof AvatarRecipeSchema>;

const PALETTE = {
  skin: ['#f6d7c3', '#eec1a1', '#e0ac8a', '#c98e6b', '#a8704f', '#8a5a3c', '#6b4329', '#4d2f1d'],
  hair: { black: '#1d1a19', brown: '#4a3021', chestnut: '#6b3d24', auburn: '#8a3b22', red: '#a8371f', ginger: '#c56a2c', blonde: '#d9b56c', platinum: '#e8dcc0', gray: '#9a9790', grey: '#9a9790', white: '#ece9e2', silver: '#c8c8cc', blue: '#3b5ba8', green: '#3d7a4a', pink: '#d37aa0', purple: '#7a4fa0', teal: '#2f8a8a' } as Record<string, string>,
  eyes: { brown: '#5a3d2b', blue: '#3f6fa8', green: '#4a7a4a', gray: '#6f7a80', grey: '#6f7a80', hazel: '#7a6a3a', amber: '#b0782a', violet: '#7a4fa0', red: '#a83030', black: '#22201e' } as Record<string, string>,
  cloth: ['#5b7fa6', '#a65b5b', '#5ba67a', '#a6935b', '#7a5ba6', '#3d3a4a', '#d8d2c4', '#2f4a3a', '#6b3a2a', '#c27a3a'],
};

/** A stable number from a string (so the same NPC always looks the same). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A recipe from a name and a plain description, without any model call: colours and kinds named in
 * the text are used, the rest is chosen from the name (stable, so a character keeps their look).
 */
export function recipeFromText(name: string, text: string, opts: { age?: number | null } = {}): AvatarRecipe {
  const t = ` ${text.toLowerCase()} `;
  let seed = hash(name.toLowerCase());
  const pick = <T,>(xs: readonly T[]): T => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0;
    return xs[seed % xs.length]!;
  };
  const has = (re: RegExp) => re.test(t);
  const colourNear = (noun: RegExp, table: Record<string, string>): string | null => {
    for (const [word, col] of Object.entries(table)) if (new RegExp(`\\b${word}[- ]?(?:\\w+ )?${noun.source}`).test(t)) return col;
    return null;
  };
  const age = opts.age != null ? (opts.age < 12 ? 'child' : opts.age < 18 ? 'teen' : opts.age >= 62 ? 'elder' : 'adult') : has(/\b(child|kid|little (girl|boy)|toddler)\b/) ? 'child' : has(/\b(teen|teenage|adolescent|youth)\b/) ? 'teen' : has(/\b(old|elderly|aged|grey-haired|gray-haired|wrinkled)\b/) ? 'elder' : 'adult';
  const feminine = has(/\b(she|her|woman|girl|lady|female|queen|princess|mother|daughter)\b/);
  const masculine = has(/\b(he|his|man|boy|gentleman|male|king|prince|father|son)\b/);
  const tall = has(/\btall\b|\btowering\b/) ? 0.1 : has(/\bshort\b|\bpetite\b|\bsmall\b/) ? -0.1 : 0;
  const baseH = { child: 1.2, teen: 1.6, adult: feminine ? 1.65 : masculine ? 1.78 : 1.7, elder: 1.66 }[age];
  const hairColour = colourNear(/hair/, PALETTE.hair) ?? (age === 'elder' ? pick(['#9a9790', '#ece9e2', '#c8c8cc']) : pick(['#1d1a19', '#4a3021', '#6b3d24', '#d9b56c', '#8a3b22']));
  const style = has(/\bbald\b/) ? 'none' : has(/ponytail/) ? 'ponytail' : has(/\bbun\b/) ? 'bun' : has(/twin ?tails|pigtails/) ? 'twintails' : has(/\bcurly|curls\b/) ? 'curly' : has(/spiky/) ? 'spiky' : has(/\bbob\b/) ? 'bob' : has(/long (\w+ )?hair|hair (falls|flows)|waist-length/) ? 'long' : has(/short (\w+ )?hair|cropped/) ? 'short' : has(/buzz|shaved/) ? 'buzz' : feminine ? pick(['long', 'bob', 'ponytail', 'bun']) : pick(['short', 'short', 'spiky', 'curly']);
  const skinIdx = has(/\b(pale|fair|porcelain)\b/) ? 0 : has(/\b(dark[- ]skinned|deep brown skin|ebony)\b/) ? 6 : has(/\b(tan|tanned|olive|bronze)\b/) ? 3 : has(/\bbrown skin\b/) ? 5 : hash(name) % 6;
  const topKind = has(/\barmou?r\b|breastplate|chainmail/) ? 'armor' : has(/\brobe\b|\bcloak\b/) ? 'robe' : has(/\bjacket\b|\bcoat\b/) ? 'jacket' : has(/\bsweater\b|\bjumper\b/) ? 'sweater' : has(/\btank top\b|\bvest\b/) ? 'tank' : has(/t-shirt|tee\b/) ? 'tshirt' : pick(['shirt', 'shirt', 'tshirt', 'sweater', 'jacket']);
  const dress = has(/\b(dress|gown)\b/);
  const bottomKind = dress ? 'long_skirt' : has(/\bskirt\b/) ? 'skirt' : has(/\bshorts\b/) ? 'shorts' : 'pants';
  const cloth = (noun: RegExp) => colourNear(noun, { ...PALETTE.hair, red: '#a65b5b', crimson: '#8a2a2a', navy: '#2a3a5a', blue: '#5b7fa6', green: '#5ba67a', black: '#25232a', white: '#e8e4dc', gray: '#7a7a80', grey: '#7a7a80', brown: '#6b4a35', yellow: '#c9a83a', purple: '#7a5ba6', pink: '#d38aa8', orange: '#c27a3a', gold: '#c9a23a', silver: '#b8b8c0' });
  const hat = has(/witch hat|wizard hat|pointed hat/) ? 'wizard' : has(/\bhood\b/) ? 'hood' : has(/\bcrown|tiara\b/) ? 'crown' : has(/\bbeanie\b/) ? 'beanie' : has(/\bcap\b/) ? 'cap' : has(/headband/) ? 'headband' : 'none';
  const extras: AvatarRecipe['extras'] = [];
  if (has(/\bcape\b|\bcloak\b/)) extras.push({ kind: 'cape', color: cloth(/(cape|cloak)/) ?? '#6b2a2a' });
  if (has(/\bscarf\b/)) extras.push({ kind: 'scarf', color: cloth(/scarf/) ?? pick(PALETTE.cloth) });
  if (has(/glasses|spectacles/)) extras.push({ kind: 'glasses', color: '#2a2a2a' });
  if (has(/\bapron\b/)) extras.push({ kind: 'apron', color: '#e8e4dc' });
  if (has(/\bbelt\b/)) extras.push({ kind: 'belt', color: '#3a2a20' });
  return AvatarRecipeSchema.parse({
    body: { age, height: Math.max(0.8, Math.min(2.3, baseH * (1 + tall))), build: has(/\b(stocky|heavy|plump|burly|muscular|broad)\b/) ? 0.75 : has(/\b(slender|thin|slim|lithe|wiry)\b/) ? 0.15 : 0.4, frame: feminine ? 0.3 : masculine ? 0.75 : 0.5, chest: feminine && (age === 'adult' || age === 'elder') ? 0.55 : 0.1, skin: PALETTE.skin[skinIdx] },
    face: { eyes: colourNear(/eyes?/, PALETTE.eyes) ?? pick(Object.values(PALETTE.eyes).slice(0, 5)), eyeSize: age === 'child' ? 0.75 : 0.55, brows: null, blush: age === 'child' },
    hair: { style, color: hairColour, length: style === 'long' ? 0.85 : 0.5 },
    top: { kind: topKind, color: cloth(/(shirt|tunic|jacket|coat|sweater|robe|dress|gown|top|blouse)/) ?? pick(PALETTE.cloth), sleeve: topKind === 'tank' ? 0 : topKind === 'tshirt' ? 0.3 : 0.9, accent: null },
    bottom: { kind: bottomKind, color: dress ? (cloth(/(dress|gown)/) ?? pick(PALETTE.cloth)) : (cloth(/(pants|trousers|skirt|shorts|jeans|breeches)/) ?? pick(['#3d3a4a', '#2a3a5a', '#5a4a3a', '#25232a'])), length: bottomKind === 'shorts' ? 0.3 : 1 },
    shoes: { kind: has(/\bboots\b/) ? 'boots' : has(/sandals|barefoot/) ? (has(/barefoot/) ? 'none' : 'sandals') : 'shoes', color: '#3a2a20' },
    hat: { kind: hat, color: cloth(/(hat|hood|cap|beanie)/) ?? '#3a3550' },
    extras,
  });
}
