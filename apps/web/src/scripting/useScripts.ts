/** Script data for a chat (light: no sandbox code is loaded until something needs to run). */
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { useSettings } from '@/lib/queries';
import { scriptsSafeMode } from './bus';
import type { ActiveSet, ExtensionUi } from './types';

export function useScripts(chatId: string | null) {
  const settings = useSettings();
  const s = settings.data?.scripts;
  const safe = scriptsSafeMode();
  const on = !!s?.enabled && !safe;
  const active = useQuery({ queryKey: ['scripts-active', chatId], queryFn: () => get<ActiveSet>('/api/scripts/active', chatId ? { chatId } : undefined), enabled: !!settings.data && on, staleTime: 30_000 });
  const extensions = useQuery({ queryKey: ['extensions-ui'], queryFn: () => get<ExtensionUi[]>('/api/extensions/ui'), enabled: !!settings.data && on, staleTime: 60_000 });
  const runnable = on ? (active.data?.scripts ?? []).filter((x) => x.granted && x.script.enabled) : [];
  return { settings: s ?? null, safe, on, active: on ? (active.data ?? null) : null, extensions: on ? (extensions.data ?? []) : [], runnable };
}
