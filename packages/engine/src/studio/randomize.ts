/**
 * The random NPC die: coherent combinations (a slot contract, after Comfyui-Anima-Wardrobe's idea
 * of slots that don't overwrite each other), with locks. Every roll is an adult (age 20–45 by
 * default), and locked traits never change.
 */
import { BODY_TYPES, EXPRESSIONS, FACE_PRESETS, HAIR_BACK, HAIR_FRONT, PALETTES, SIZES, TraitSheetSchema, type TraitSheet } from './traits.js';

/** Small deterministic PRNG (mulberry32), so a seed reproduces a roll. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export type LockPath = 'sex' | 'age' | 'body' | 'body.type' | 'body.breast' | 'body.hips' | 'body.skin' | 'face' | 'face.preset' | 'face.eyeColor' | 'hair' | 'hair.back' | 'hair.front' | 'hair.color' | 'wardrobe' | 'name';

/** An outfit set from a template's wardrobe: the slots it fills (coherent: a dress has no bottom). */
export interface OutfitSet { id: string; items: Partial<Record<string, string | null>>; sex?: Array<'female' | 'male'> }

const FIRST = { female: ['Aiko', 'Mira', 'Lena', 'Hana', 'Sora', 'Rin', 'Yui', 'Nora', 'Elise', 'Kaede', 'Mei', 'Sakura'], male: ['Ren', 'Kai', 'Haru', 'Daichi', 'Leon', 'Sota', 'Riku', 'Aren', 'Takumi', 'Jun'] };
const LAST = ['Yasuda', 'Fukano', 'Tanaka', 'Nishitani', 'Konishi', 'Miyazaki', 'Hoshino', 'Arai', 'Kurosawa', 'Sato', 'Mori', 'Fujimori'];

export function randomSheet(o: { seed?: number; base?: TraitSheet; locks?: LockPath[]; outfits?: OutfitSet[]; sex?: 'female' | 'male' } = {}): TraitSheet {
  const r = rng(o.seed ?? Math.floor(Math.random() * 2 ** 31));
  const one = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const locked = (p: LockPath) => !!o.base && !!o.locks?.some((l) => l === p || p.startsWith(`${l}.`));
  const b = o.base;
  const sex = locked('sex') ? b!.sex : o.sex ?? (r() < 0.6 ? 'female' : 'male');
  // Coherent looks: dark hair goes with dark eyes more often; pale hair keeps natural eye colours.
  const hairColor = locked('hair.color') ? b!.hair.color : one(PALETTES.hair);
  const darkHair = parseInt(hairColor.slice(1, 3), 16) < 0x70;
  const eye = locked('face.eyeColor') ? b!.face.eyeColor : r() < 0.6 ? one(darkHair ? PALETTES.eyes.slice(0, 3) : PALETTES.eyes) : one(PALETTES.eyes);
  const back = locked('hair.back') ? b!.hair.back : one(sex === 'male' ? (['short', 'bob', 'ponytail'] as const) : HAIR_BACK);
  const type = locked('body.type') ? b!.body.type : one(sex === 'male' ? (['slim', 'average', 'athletic', 'muscular', 'plus'] as const) : BODY_TYPES);
  // A curvy or plus-size body never rolls the smallest hips; slim rarely rolls the largest.
  const hipsPool = type === 'curvy' || type === 'plus' ? (['medium', 'large'] as const) : type === 'slim' ? (['small', 'medium'] as const) : SIZES;
  const outfits = (o.outfits ?? []).filter((x) => !x.sex || x.sex.includes(sex));
  const outfit = outfits.length ? one(outfits) : null;
  const name = locked('name') && b ? b.name : `${one(FIRST[sex])} ${one(LAST)}`;
  return TraitSheetSchema.parse({
    name, sex,
    age: locked('age') && b ? b.age : 20 + Math.floor(r() * 26),
    body: locked('body') && b ? b.body : {
      type,
      breast: locked('body.breast') ? b!.body.breast : one(SIZES),
      hips: locked('body.hips') ? b!.body.hips : one(hipsPool),
      skin: locked('body.skin') ? b!.body.skin : one(PALETTES.skin),
      bodyHair: 'none',
      sliders: { breast: 0, hips: 0, butt: 0, thighs: 0, waist: 0, shoulders: 0 },
    },
    face: locked('face') && b ? b.face : {
      preset: locked('face.preset') ? b!.face.preset : one(FACE_PRESETS), eyeColor: eye,
      brows: one(['natural', 'thin', 'thick'] as const), makeup: sex === 'male' ? 'none' : one(['none', 'none', 'light', 'bold'] as const),
      freckles: r() < 0.2, mole: r() < 0.15,
    },
    hair: locked('hair') && b ? b.hair : {
      front: locked('hair.front') ? b!.hair.front : one(HAIR_FRONT), back, side: r() < 0.3 ? 'locks' : 'none', color: hairColor,
      highlight: r() < 0.2 ? one(PALETTES.hair) : null,
    },
    wardrobe: locked('wardrobe') && b ? b.wardrobe : {
      top: null, bra: null, bottom: null, underwear: null, legwear: null, shoes: null, accessory: null,
      ...(outfit?.items ?? {}),
      ...(sex === 'male' ? { bra: null } : {}),
    },
    expressions: [one(['neutral', 'smile'] as const), ...EXPRESSIONS.filter((e) => e !== 'neutral' && e !== 'smile').slice(0, 5)],
    locked: false,
  });
}
