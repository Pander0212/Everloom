import type { CampaignState, CharacterSpec } from '@everloom/engine';
import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import { post } from '@/lib/api';
import { usePrefs3D } from '@/features/avatars/prefs';
import type { CastMember } from '../StageLayer';
/** Only NPCs actually present in the current scene are considered; at most three builds per scene. */
export function useNpcLooks(state: CampaignState | null | undefined, enabled: boolean) {
  const mode = usePrefs3D(p => p.npcLooks);
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set());
  const layers = Object.values(state?.stage?.layers ?? {});
  const candidates = enabled && mode !== 'off' ? Object.values(state?.npcs ?? {}).filter(n => !n.characterId && n.status === 'alive' && (layers.length ? layers.some(l => l.name.toLowerCase() === n.name.toLowerCase() && l.position !== 'off') : !!n.locationId && n.locationId === state?.currentLocationId)).slice(0, 3) : [];
  const queries = useQueries({ queries: candidates.map(n => ({
    queryKey: ['npc-creator-look', n.id, n.name, n.appearance, n.age, n.personality],
    queryFn: () => post<{ spec: CharacterSpec; minor: boolean }>('/api/avatars/creator-recipe', { name: n.name, text: `${n.age == null ? '' : `Age: ${n.age}. `}${n.appearance}\n${n.personality}` }),
    enabled: mode === 'automatic' || accepted.has(n.id), staleTime: Infinity, retry: false,
  })) });
  const cast: CastMember[] = candidates.flatMap((n, i) => {
    const data = queries[i]?.data; if (!data) return [];
    const layer = layers.find(l => l.name.toLowerCase() === n.name.toLowerCase());
    const direction = state?.stage?.avatars?.[n.name.toLowerCase()];
    return [{ id: `npc:${n.id}`, avatarId: null, creator: data.spec, emotion: layer?.expression ?? 'neutral', speaking: false, slot: layer?.position === 'off' ? undefined : layer?.position, pose: direction?.pose, emote: direction?.emote, outfit: direction?.outfit }];
  });
  return { cast, pending: candidates.filter((n, i) => mode === 'ask' && !accepted.has(n.id) && !queries[i]?.data), accept: (id: string) => setAccepted(old => new Set([...old, id])), errors: queries.filter(q => q.isError).map(q => q.error.message) };
}
