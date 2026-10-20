/**
 * "Fill from description": the owner's utility model reads a character's card (description,
 * personality, appearance notes) and answers with a trait sheet in a fixed JSON shape; this module
 * builds that prompt and turns the answer into a valid sheet, mapping free words ("platinum
 * blonde", "emerald eyes", "petite") onto the catalogs and palettes. Anything it can't map keeps the
 * default; the owner reviews the result. A character described as under 18 gets no sheet.
 */
import { BODY_TYPES, CATALOG, FACE_PRESETS, HAIR_BACK, HAIR_FRONT, PALETTES, SIZES, TraitSheetSchema, type TraitSheet } from './traits.js';
import { hexToRgb, rgbToLab } from './color.js';

export function fillPrompt(card: { name: string; description: string; personality?: string; appearance?: string }): string {
  const list = (xs: ReadonlyArray<{ id: string }>) => xs.map((x) => x.id).join(' | ');
  return [
    'Read the character below and describe their look as JSON, nothing else. Use only the listed values; for colours give a hex code.',
    '{"sex":"female|male","age":number (adult; if the text gives none, a plausible adult age),',
    ` "body":{"type":"${list(CATALOG.bodyType)}","breast":"${SIZES.join(' | ')}","hips":"${SIZES.join(' | ')}","skin":"#hex"},`,
    ` "face":{"preset":"${list(CATALOG.facePreset)}","eyeColor":"#hex","freckles":bool,"mole":bool,"makeup":"none | light | bold"},`,
    ` "hair":{"front":"${list(CATALOG.hairFront)}","back":"${list(CATALOG.hairBack)}","color":"#hex"},`,
    ' "expressions":["neutral|smile|laugh|shy|angry|sad|surprised|pleased", ...] (the ones that fit their personality, most typical first)}',
    '',
    `Name: ${card.name}`,
    card.appearance ? `Appearance: ${card.appearance}` : '',
    `Description: ${card.description.slice(0, 4000)}`,
    card.personality ? `Personality: ${card.personality.slice(0, 1000)}` : '',
  ].filter(Boolean).join('\n');
}

const COLOR_WORDS: Record<string, string> = {
  black: '#1b1b1f', raven: '#1b1b1f', 'dark brown': '#3b2a22', brunette: '#3b2a22', brown: '#6b4426', chestnut: '#6b4426', auburn: '#8a3a22', copper: '#a0673a', ginger: '#b0582a', red: '#8a2b2b', crimson: '#8a2b2b',
  blonde: '#d9b27c', blond: '#d9b27c', golden: '#d9b27c', 'platinum blonde': '#efe2c4', platinum: '#efe2c4', silver: '#c9c9cf', white: '#e9e9ee', grey: '#9a9aa2', gray: '#9a9aa2', pink: '#d4566e', purple: '#5a3d8a', violet: '#5a3d8a', blue: '#2f5fa8', green: '#3f8a5c', teal: '#2f8a86',
  emerald: '#3d7a3a', hazel: '#6b5a2b', amber: '#d9a43a', sapphire: '#2f6db3', 'light blue': '#6aa7d8', 'sky blue': '#6aa7d8',
  pale: '#fbe3d3', fair: '#f3cfb6', tan: '#d29d78', tanned: '#d29d78', olive: '#c8a07a', dark: '#8a5a3c', ebony: '#5e3b26',
};

/** A hex colour from a model answer or a colour word; the nearest palette entry when close. */
export function colorFrom(v: unknown, palette: readonly string[], fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const s = v.trim().toLowerCase();
  const hex = /^#[0-9a-f]{6}$/.test(s) ? s : COLOR_WORDS[s] ?? Object.entries(COLOR_WORDS).find(([w]) => s.includes(w))?.[1];
  if (!hex) return fallback;
  // Snap to the palette when it's very close (keeps the editor's swatches selected).
  const lab = rgbToLab(hexToRgb(hex));
  let best = hex, bd = 6;
  for (const p of palette) { const q = rgbToLab(hexToRgb(p)); const d = Math.hypot(lab[0] - q[0], lab[1] - q[1], lab[2] - q[2]); if (d < bd) { bd = d; best = p; } }
  return best;
}

const oneOf = <T extends string>(v: unknown, xs: readonly T[], fallback: T, words: Record<string, T> = {}): T => {
  if (typeof v !== 'string') return fallback;
  const s = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if ((xs as readonly string[]).includes(s)) return s as T;
  for (const [w, t] of Object.entries(words)) if (s.includes(w)) return t;
  return fallback;
};

/** Turns the model's answer into a sheet (null when it says the character is under 18). */
export function sheetFromAnswer(name: string, answer: string): { sheet: TraitSheet | null; reason?: string } {
  const m = answer.match(/\{[\s\S]*\}/);
  let j: Record<string, any> = {};
  try { j = m ? JSON.parse(m[0]) : {}; } catch { j = {}; }
  const age = Number(j.age);
  if (Number.isFinite(age) && age < 18) return { sheet: null, reason: 'The description makes the character under 18: the studio only makes adults.' };
  const sex = oneOf(j.sex, ['female', 'male'] as const, 'female', { woman: 'female', girl: 'female', man: 'male', boy: 'male' });
  const sheet = TraitSheetSchema.parse({
    name, sex, age: Number.isFinite(age) ? Math.max(18, Math.round(age)) : 25,
    body: {
      type: oneOf(j.body?.type, BODY_TYPES, 'average', { petite: 'slim', thin: 'slim', fit: 'athletic', toned: 'athletic', voluptuous: 'curvy', buxom: 'curvy', stocky: 'muscular', chubby: 'plus', heavy: 'plus' }),
      breast: oneOf(j.body?.breast, SIZES, 'medium', { flat: 'small', modest: 'small', big: 'large', huge: 'large' }),
      hips: oneOf(j.body?.hips, SIZES, 'medium', { narrow: 'small', wide: 'large' }),
      skin: colorFrom(j.body?.skin, PALETTES.skin, '#f3cfb6'),
    },
    face: {
      preset: oneOf(j.face?.preset, FACE_PRESETS, 'soft'),
      eyeColor: colorFrom(j.face?.eyeColor, PALETTES.eyes, '#6b4a2b'),
      freckles: !!j.face?.freckles, mole: !!j.face?.mole,
      makeup: oneOf(j.face?.makeup, ['none', 'light', 'bold'] as const, 'none'),
    },
    hair: {
      front: oneOf(j.hair?.front, HAIR_FRONT, 'bangs', { fringe: 'bangs' }),
      back: oneOf(j.hair?.back, HAIR_BACK, 'long_straight', { pony: 'ponytail', twin: 'twin_tails', pigtail: 'twin_tails', wavy: 'long_wavy', curly: 'long_wavy', long: 'long_straight', pixie: 'short', crop: 'short' }),
      color: colorFrom(j.hair?.color, PALETTES.hair, '#3b2a22'),
    },
    expressions: Array.isArray(j.expressions) ? [...new Set(j.expressions.map((e: unknown) => oneOf(e, CATALOG.expression.map((x) => x.id), 'neutral')))] : undefined,
  });
  return { sheet };
}
