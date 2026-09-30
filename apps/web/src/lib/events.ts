/** Live sync over SSE: keeps every open device (phone + desktop) in step. */
import type { MessageDTO } from '@everloom/engine';
import { create } from 'zustand';
import { clientId } from './api';
import { queryClient, qk, removeMessages, setCampaignState, upsertMessage } from './queries';
import { toast, useUi } from './store';

interface LiveState {
  /** Streaming text for messages generated on another device. */
  streams: Record<string, { text: string; reasoning: string; swipeId: number }>;
  tracker: Record<string, 'running' | 'done' | 'error'>;
}

export const useLive = create<LiveState>(() => ({ streams: {}, tracker: {} }));

let source: EventSource | null = null;
let retry = 0;

export function startEvents() {
  if (source) return;
  const es = new EventSource('/api/events');
  source = es;
  const on = (type: string, fn: (d: any) => void) =>
    es.addEventListener(type, (ev) => {
      try {
        fn(JSON.parse((ev as MessageEvent).data));
      } catch {
        /* ignore malformed */
      }
    });
  es.onopen = () => {
    const wasDown = useUi.getState().connection !== 'online';
    useUi.getState().setConnection('online');
    retry = 0;
    if (wasDown) void queryClient.invalidateQueries();
  };
  es.onerror = () => {
    useUi.getState().setConnection(navigator.onLine ? 'reconnecting' : 'offline');
    if (es.readyState === EventSource.CLOSED) {
      source = null;
      setTimeout(startEvents, Math.min(15000, 1000 * 2 ** retry++));
    }
  };
  on('message.created', (d) => upsertMessage(d.message as MessageDTO));
  on('message.updated', (d) => {
    upsertMessage(d.message as MessageDTO);
    useLive.setState((s) => {
      const streams = { ...s.streams };
      delete streams[d.message.id];
      return { streams };
    });
  });
  on('message.stream', (d) => {
    if (d.origin === clientId) return;
    useLive.setState((s) => ({ streams: { ...s.streams, [d.messageId]: { text: d.text, reasoning: d.reasoning ?? '', swipeId: d.swipeId } } }));
  });
  on('message.deleted', (d) => removeMessages(d.chatId, d.ids));
  on('campaign.state', (d) => {
    setCampaignState(d.campaignId, d.state);
    if (d.changes?.length && (d.source !== 'user' || d.origin !== clientId)) toast({ title: d.source === 'ai' ? 'Story update' : 'Updated', lines: d.changes });
  });
  on('campaign.toast', (d) => d.changes?.length && toast({ title: 'Story update', lines: d.changes }));
  on('tracker.status', (d) => useLive.setState((s) => ({ tracker: { ...s.tracker, [d.messageId]: d.status } })));
  on('characters.changed', () => {
    void queryClient.invalidateQueries({ queryKey: ['characters'] });
    void queryClient.invalidateQueries({ queryKey: ['collections'] });
  });
  on('memory.changed', () => void queryClient.invalidateQueries({ queryKey: ['memory'] }));
  on('chat.created', () => void queryClient.invalidateQueries({ queryKey: ['chats'] }));
  on('chat.deleted', () => void queryClient.invalidateQueries({ queryKey: ['chats'] }));
  on('chat.updated', (d) => {
    queryClient.setQueryData(qk.chat(d.chat.id), (c: any) => ({ ...(c ?? {}), ...d.chat }));
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
  });
  on('settings.updated', (d) => {
    const { origin: _o, ...settings } = d;
    queryClient.setQueryData(qk.settings, settings);
  });
}

export function stopEvents() {
  source?.close();
  source = null;
}

window.addEventListener('online', () => {
  if (!source) startEvents();
});
