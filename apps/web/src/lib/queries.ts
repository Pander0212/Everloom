import type {
  CampaignDTO, CharacterDTO, CharacterSummary, ChatDTO, ChatSummary, ConnectionDTO, GroupDTO, LorebookDTO, MessageDTO, PersonaDTO, PresetDTO, Settings,
} from '@everloom/engine';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { get } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, e: any) => n < 2 && e?.status !== 401 && e?.status !== 404, refetchOnWindowFocus: false },
  },
});

export const qk = {
  settings: ['settings'] as const,
  characters: ['characters'] as const,
  character: (id: string) => ['character', id] as const,
  chats: (f?: object) => ['chats', f ?? {}] as const,
  chat: (id: string) => ['chat', id] as const,
  messages: (chatId: string) => ['messages', chatId] as const,
  campaign: (id: string) => ['campaign', id] as const,
  personas: ['personas'] as const,
  lorebooks: ['lorebooks'] as const,
  presets: ['presets'] as const,
  connections: ['connections'] as const,
  groups: ['groups'] as const,
};

export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: () => get<Settings>('/api/settings') });
export const useCharacters = () => useQuery({ queryKey: qk.characters, queryFn: () => get<CharacterSummary[]>('/api/characters') });
export const useCharacter = (id?: string | null) => useQuery({ queryKey: qk.character(id ?? ''), queryFn: () => get<CharacterDTO>(`/api/characters/${id}`), enabled: !!id });
export const useChats = (f?: { characterId?: string; groupId?: string }) => useQuery({ queryKey: qk.chats(f), queryFn: () => get<ChatSummary[]>('/api/chats', f as any) });
export const useChat = (id?: string) => useQuery({ queryKey: qk.chat(id ?? ''), queryFn: () => get<ChatDTO & { generating?: boolean }>(`/api/chats/${id}`), enabled: !!id });
export const useMessages = (chatId?: string) => useQuery({ queryKey: qk.messages(chatId ?? ''), queryFn: () => get<MessageDTO[]>(`/api/chats/${chatId}/messages`), enabled: !!chatId, staleTime: 5 * 60_000 });
export const useCampaign = (id?: string | null) => useQuery({ queryKey: qk.campaign(id ?? ''), queryFn: () => get<CampaignDTO>(`/api/campaigns/${id}`), enabled: !!id, staleTime: 5 * 60_000 });
export const usePersonas = () => useQuery({ queryKey: qk.personas, queryFn: () => get<PersonaDTO[]>('/api/personas') });
export const useLorebooks = () => useQuery({ queryKey: qk.lorebooks, queryFn: () => get<LorebookDTO[]>('/api/lorebooks') });
export const usePresets = () => useQuery({ queryKey: qk.presets, queryFn: () => get<PresetDTO[]>('/api/presets') });
export const useConnections = () => useQuery({ queryKey: qk.connections, queryFn: () => get<ConnectionDTO[]>('/api/connections') });
export const useGroups = () => useQuery({ queryKey: qk.groups, queryFn: () => get<GroupDTO[]>('/api/groups') });

/** Insert or replace a message in the cached list for its chat. */
export function upsertMessage(m: MessageDTO) {
  queryClient.setQueryData<MessageDTO[]>(qk.messages(m.chatId), (list) => {
    if (!list) return list;
    const i = list.findIndex((x) => x.id === m.id);
    if (i >= 0) {
      const next = list.slice();
      next[i] = m;
      return next;
    }
    return [...list, m].sort((a, b) => a.seq - b.seq);
  });
}

export function removeMessages(chatId: string, ids: string[]) {
  queryClient.setQueryData<MessageDTO[]>(qk.messages(chatId), (list) => list?.filter((m) => !ids.includes(m.id)));
}

export function setCampaignState(campaignId: string, state: CampaignDTO['state']) {
  queryClient.setQueryData<CampaignDTO>(qk.campaign(campaignId), (c) => (c ? { ...c, state } : { id: campaignId, name: state.meta.title, state, updatedAt: Date.now() }));
}
