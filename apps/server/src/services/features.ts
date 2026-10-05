/** The feature switches in force for a chat (Settings › Features, or the chat's own preset). */
import { effectiveFeatures, effectiveWorld, FEATURE_PRESETS, type ChatDTO, type FeaturePreset, type FeatureSet, type Settings } from '@everloom/engine';
import type { AppContext } from '../context.js';
import { getSettings } from './settings.js';

export function chatPreset(chat: Pick<ChatDTO, 'metadata'>): FeaturePreset | null {
  const p = chat.metadata?.features;
  return p && FEATURE_PRESETS.includes(p) ? p : null;
}

export function featuresFor(settings: Settings, chat: Pick<ChatDTO, 'metadata'> | null): FeatureSet {
  return effectiveFeatures(settings.features, chat ? chatPreset(chat) : null);
}

/** Settings with the world switches limited by the features (what the world engine may do here). */
export function settingsFor(ctx: AppContext, owner: string, chat: Pick<ChatDTO, 'metadata'> | null): { settings: Settings; features: FeatureSet } {
  const s = getSettings(ctx, owner);
  const features = featuresFor(s, chat);
  return { settings: { ...s, world: effectiveWorld(s.world, features) }, features };
}
