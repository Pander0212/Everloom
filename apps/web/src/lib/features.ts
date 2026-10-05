/** The feature switches in force: Settings › Features, or the chat's own preset. */
import { effectiveFeatures, presetFeatures, type ChatMeta, type FeatureId, type FeatureSet } from '@everloom/engine';
import { createContext, useContext } from 'react';
import { useSettings } from './queries';

export function useFeatures(meta?: Pick<ChatMeta, 'features'> | null): FeatureSet {
  const s = useSettings();
  // Until settings load, assume everything is on (what existing installs have).
  if (!s.data) return presetFeatures('full');
  return effectiveFeatures(s.data.features, meta?.features ?? null);
}

/** The switches for the chat on screen, for components deep inside it. */
export const FeaturesContext = createContext<FeatureSet | null>(null);
export function useFeatureOn(id: FeatureId): boolean {
  const ctx = useContext(FeaturesContext);
  const global = useFeatures(null);
  return (ctx ?? global).on[id];
}
