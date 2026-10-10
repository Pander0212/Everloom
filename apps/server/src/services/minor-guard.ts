/**
 * The minor guard: explicit content (adult skin layers, explicit body sliders, anatomy settings,
 * 18+ MakeHuman assets) is never applied to a character who is, or looks like, a minor.
 *
 * There is no adult mode, switch or confirmation: adult characters never notice this check. It
 * only refuses, on the server, when explicit content would go on a character
 *   - whose recorded age is under 18 (the avatar's own, or a linked character card's),
 *   - who is described as a child (avatar description or a linked card's text),
 *   - or whose body is in the child range (MakeHuman age/proportions, a code-made body's age
 *     stage, the character editor's age slider).
 * Every write path runs through `assertAvatarAllowed` / `assertLinkAllowed`, so a request sent
 * straight to the API is refused the same way as one from the app.
 *
 * Tests: apps/server/test/minor-guard.test.ts.
 */
import { ageYears, AvatarConfigSchema, type AvatarConfig, type CardData, type CharacterGame } from '@everloom/engine';
import { HttpError, type AppContext } from '../context.js';

/** The one message a refusal gives. */
export const REFUSED = 'Explicit content is never applied to a character under 18 or described as a child.';

// Words about the character itself; mentions of other people ("her kid") are left alone.
const MINOR_WORDS = /\b(child|minor|underage|under-age|preteen|pre-teen|teenager|adolescent|little (?:girl|boy)|young (?:girl|boy)|schoolgirl|schoolboy|loli|lolita|shota|elementary school(?:er)?|middle school(?:er)?|junior high)\b|小学生|中学生|幼女|ロリ|ショタ/i;
const WORD_AGES = /\b(?:seventeen|sixteen|fifteen|fourteen|thirteen|twelve|eleven|ten|nine|eight|seven|six|five|four|three|two|one)[- ]?(?:years?[- ]?old|yo)\b/i;

/** True when a text describes the character as a minor ("a 15-year-old", "age: 12", "schoolgirl"). */
export function describesMinor(text: string): boolean {
  if (!text) return false;
  if (MINOR_WORDS.test(text) || WORD_AGES.test(text)) return true;
  for (const m of text.matchAll(/\b(?:aged?\s*[:=]?\s*(\d{1,3})|(\d{1,3})\s*[- ]?(?:years?[- ]?old|yo|y\/o)|(\d{1,2})\s*歳)/gi)) if (Number(m[1] ?? m[2] ?? m[3]) < 18) return true;
  return false;
}

/** Whether the avatar carries explicit content (what this guard protects). */
export function hasExplicitContent(config: AvatarConfig): boolean {
  if (config.skinLayers.some((l) => l.adult)) return true;
  if ((config.morphs?.sliders ?? []).some((s) => s.adult && (config.morphs!.values[s.id] ?? 0) !== 0)) return true;
  const anatomy = (config as AvatarConfig & { anatomy?: { enabled?: boolean } }).anatomy;
  if (anatomy?.enabled) return true;
  return false;
}

/** Why this avatar's own settings say minor, or null. */
function avatarMinorReason(config: AvatarConfig): string | null {
  if (config.content.age != null && config.content.age < 18) return 'age';
  if (describesMinor(config.content.description)) return 'description';
  if (config.makehuman && (ageYears(config.makehuman.macro.age) < 18 || config.makehuman.macro.proportions < 0.25)) return 'body';
  if (config.recipe && (config.recipe.body.age === 'child' || config.recipe.body.age === 'teen')) return 'body';
  const editor = (config as AvatarConfig & { character?: { body?: { age?: number } } }).character;
  if (editor?.body?.age != null && editor.body.age < 18) return 'body';
  return null;
}

/** Why a character card says minor, or null. */
export function cardMinorReason(card: Pick<CardData, 'description' | 'personality' | 'scenario' | 'creator_notes'>, game: Pick<CharacterGame, 'age'> | null | undefined): string | null {
  if (game?.age != null && game.age < 18) return 'card age';
  if (describesMinor([card.description, card.personality, card.scenario, card.creator_notes].filter(Boolean).join('\n'))) return 'card description';
  return null;
}

/**
 * Refuses explicit content on a minor: the avatar's own settings and every character card linked
 * to it. MakeHuman 18+ assets count as explicit (checked by the MakeHuman service through
 * `isMinorAvatar`).
 */
export function assertAvatarAllowed(ctx: AppContext, owner: string, config: AvatarConfig, avatarId?: string): void {
  if (!hasExplicitContent(config)) return;
  if (isMinorAvatar(ctx, owner, config, avatarId)) throw new HttpError(400, REFUSED);
}

/** True when the avatar, or a character linked to it, is a minor (whatever the avatar carries). */
export function isMinorAvatar(ctx: AppContext, owner: string, config: AvatarConfig, avatarId?: string): boolean {
  if (avatarMinorReason(config)) return true;
  if (!avatarId) return false;
  const linked = ctx.db.prepare("SELECT card, game FROM characters WHERE owner_id = ? AND json_extract(game, '$.avatar3d') = ?").all(owner, avatarId) as Array<{ card: string; game: string }>;
  return linked.some((l) => cardMinorReason(JSON.parse(l.card), JSON.parse(l.game)) !== null);
}

/** Linking a character card to an avatar: refused when the avatar is explicit and the card a minor. */
export function assertLinkAllowed(ctx: AppContext, owner: string, avatar: string, card: CardData, game: CharacterGame): void {
  const row = ctx.db.prepare('SELECT config FROM avatars WHERE id = ? AND owner_id = ?').get(avatar, owner) as { config: string } | undefined;
  if (!row) return; // A missing avatar falls back to the character picture.
  const config = AvatarConfigSchema.parse(JSON.parse(row.config));
  if (!hasExplicitContent(config)) return;
  if (avatarMinorReason(config) || cardMinorReason(card, game)) throw new HttpError(400, REFUSED);
}
