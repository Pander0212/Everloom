/**
 * The story drives studio looks through state that rolls back with swipes: `studio.pose` (a
 * character's pose template), `studio.scene` (a scene template, its cast and options) and
 * `studio.option`; equipped inventory items pick outfit layers; the story's emotion picks the
 * expression.
 */
import type { TraitSheet, WardrobeSlot } from './traits.js';

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');

/**
 * Equipped items → wardrobe: an item whose name (or a tag) matches an outfit item a template has
 * ("White blouse" → white_blouse; a tag "blouse") takes that slot; the rest of the sheet's wardrobe
 * stays. Items nothing matches are ignored.
 */
export function wardrobeFromItems(sheet: TraitSheet, items: ReadonlyArray<{ name: string; tags?: string[] }>, offered: Partial<Record<string, string[]>>): TraitSheet['wardrobe'] {
  const out = { ...sheet.wardrobe };
  for (const it of items) {
    const keys = [slug(it.name), ...(it.tags ?? []).map(slug)];
    for (const [slot, ids] of Object.entries(offered)) {
      const hit = (ids ?? []).find((id) => keys.includes(id) || keys.some((k) => k.endsWith(`_${id}`) || id.endsWith(`_${k}`)));
      if (hit) { out[slot as WardrobeSlot] = hit; break; }
    }
  }
  return out;
}

const EMOTION_EXPRESSION: Record<string, string> = {
  joy: 'smile', amusement: 'laugh', love: 'pleased', pride: 'smile', relief: 'smile', curiosity: 'neutral',
  surprise: 'surprised', fear: 'surprised', nervousness: 'shy', embarrassment: 'shy',
  sadness: 'sad', anger: 'angry', disgust: 'angry', confusion: 'surprised',
};
export const expressionForEmotion = (emotion: string | null | undefined): string | undefined => (emotion ? EMOTION_EXPRESSION[emotion] : undefined);
