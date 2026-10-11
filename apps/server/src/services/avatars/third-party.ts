/**
 * Bought or downloaded avatars and outfits (imported from a Unity package and the like) are for the
 * owner's own use: they stay out of bundles, library exports and packs unless the owner confirms
 * they have the right to share them. The check lives here only; callers ask `shareable`.
 */
import type { AvatarConfig } from '@everloom/engine';

export const isThirdParty = (cfg: Pick<AvatarConfig, 'importReport'>): boolean => !!cfg.importReport?.thirdParty;

/** May this avatar's files leave the owner's install (bundles, exports to share, packs)? */
export const shareable = (cfg: Pick<AvatarConfig, 'importReport'>): boolean => !isThirdParty(cfg) || !!cfg.importReport?.rightsConfirmed;
