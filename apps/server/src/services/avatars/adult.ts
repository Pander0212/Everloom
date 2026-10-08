/** Adult eligibility is enforced at writes and links, independently of browser controls. */
import { ageYears, AvatarConfigSchema, type AvatarConfig, type CardData, type CharacterGame } from '@everloom/engine';
import { HttpError, type AppContext } from '../../context.js';
import { getSettings } from '../settings.js';
import { assertHumanAssets } from './makehuman.js';

const minorWords = /\b(child|minor|underage|preteen|teenager|adolescent|little (?:girl|boy)|schoolgirl|schoolboy)\b/i;
export function describesMinor(text: string): boolean {
  if (minorWords.test(text)) return true;
  for (const match of text.matchAll(/\b(?:age[d]?\s*[:=]?\s*(\d{1,3})|(\d{1,3})\s*[- ]?years?\s*[- ]?old)\b/gi)) if (Number(match[1] ?? match[2]) < 18) return true;
  return /\b(?:seventeen|sixteen|fifteen|fourteen|thirteen|twelve|eleven|ten|nine|eight|seven|six|five)\s*[- ]?years?\s*[- ]?old\b/i.test(text);
}
export function assertAdultAvatar(ctx: AppContext, owner: string, config: AvatarConfig, avatarId?: string) {
  assertHumanAssets(ctx, owner, config);
  // Adult-rated skin layers and explicit body sliders make the avatar adult content: the same checks apply.
  const explicit = config.skinLayers.some((l) => l.adult) || (config.morphs?.sliders ?? []).some((s) => s.adult && (config.morphs!.values[s.id] ?? 0) !== 0);
  if (explicit && !config.content.adult) throw new HttpError(400, 'Adult-rated skin layers and explicit body sliders need this avatar rated adult (Content step).');
  if (!config.content.adult) return;
  const settings = getSettings(ctx, owner);
  if (settings.library.nsfw !== true || settings.library.adultConfirmed !== true) throw new HttpError(403, 'Enable Adult content (18+) and confirm you are an adult in Settings › Features first.');
  if (!config.content.confirmedAdult || config.content.age == null || config.content.age < 18) throw new HttpError(400, 'Record an age of 18 or older and confirm this character is an adult.');
  if (describesMinor(config.content.description)) throw new HttpError(400, 'Adult mode is refused because the character description identifies a minor.');
  if (config.makehuman && (ageYears(config.makehuman.macro.age) < 18 || config.makehuman.macro.proportions < 0.25)) throw new HttpError(400, 'Adult MakeHuman characters must keep adult age and proportion settings.');
  if (avatarId) for (const linked of ctx.db.prepare("SELECT card, game FROM characters WHERE owner_id = ? AND json_extract(game, '$.avatar3d') = ?").all(owner, avatarId) as Array<{ card: string; game: string }>) assertAdultCard(config, JSON.parse(linked.card), JSON.parse(linked.game));
}
export function assertAdultCard(config: AvatarConfig, card: CardData, game: CharacterGame) {
  if (!config.content.adult) return;
  if ((game.age != null && game.age < 18) || describesMinor([card.description, card.personality, card.scenario, card.creator_notes].join('\n'))) throw new HttpError(400, 'This character is described as a minor and cannot use an adult avatar.');
}
export function assertAdultLink(ctx: AppContext, owner: string, avatar: string, card: CardData, game: CharacterGame) {
  const row = ctx.db.prepare('SELECT config FROM avatars WHERE id = ? AND owner_id = ?').get(avatar, owner) as { config: string } | undefined;
  if (!row) return; // Missing legacy references already fall back to the character picture.
  const config = AvatarConfigSchema.parse(JSON.parse(row.config));
  assertAdultAvatar(ctx, owner, config); assertAdultCard(config, card, game);
}
