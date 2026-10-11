/** What every palette needs from settings: pins, feature switches, settings pages and characters to find. */
import type { FeatureId, FeatureSet } from '@everloom/engine';
import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useCharacters, useSettings } from '@/lib/queries';
import { toast } from '@/lib/store';
import { useSettingsPatch } from '@/features/settings/common';
import { FEATURES } from '@everloom/engine';
import { defaultPins } from './Palette';

export function usePaletteWiring(features: FeatureSet) {
  const settings = useSettings();
  const { update } = useSettingsPatch();
  const navigate = useNavigate();
  const characters = useCharacters();
  const preset = settings.data?.features.preset ?? 'full';
  const pins = settings.data?.ui?.pins ?? defaultPins(preset === 'custom' ? (features.on.inventory ? 'full' : features.on.game ? 'story' : 'classic') : preset);
  const onPins = useCallback((p: string[]) => void update({ ui: { pins: p } as never }), [update]);
  const onFeature = useCallback(
    (id: FeatureId, on: boolean) => {
      void update({ features: { set: { on: { [id]: on } } } as never });
      toast({ title: `${FEATURES.find((f) => f.id === id)?.label} ${on ? 'on' : 'off'}`, lines: ['Settings › Features'], tone: 'success' });
    },
    [update],
  );
  const onSettings = useCallback((page: string) => navigate(`/settings/${page}`), [navigate]);
  return {
    pins,
    onPins,
    onFeature,
    onSettings,
    characters: (characters.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    onCharacter: (id: string) => navigate(`/characters/${id}`),
    experimental: !!settings.data?.ui?.experimental,
  };
}
