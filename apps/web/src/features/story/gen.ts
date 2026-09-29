/** Client-side generation driver: streams tokens from the server into a small store. */
import type { GenerateEvent, MessageDTO } from '@everloom/engine';
import { create } from 'zustand';
import { post, streamPost } from '@/lib/api';
import { upsertMessage } from '@/lib/queries';
import { toast } from '@/lib/store';

export type GenType = 'normal' | 'swipe' | 'regenerate' | 'continue' | 'impersonate';

interface GenState {
  chatId: string | null;
  messageId: string | null;
  swipeId: number;
  type: GenType | null;
  text: string;
  reasoning: string;
  controller: AbortController | null;
}

export const useGen = create<GenState>(() => ({ chatId: null, messageId: null, swipeId: 0, type: null, text: '', reasoning: '', controller: null }));

export function isBusy(chatId: string) {
  return useGen.getState().chatId === chatId;
}

/** Returns the impersonated text for 'impersonate', otherwise null. */
export async function generate(chatId: string, type: GenType, opts: { text?: string; characterId?: string | null } = {}): Promise<string | null> {
  if (useGen.getState().chatId) return null;
  const controller = new AbortController();
  useGen.setState({ chatId, messageId: null, swipeId: 0, type, text: '', reasoning: '', controller });
  let result: string | null = null;
  try {
    for await (const ev of streamPost<GenerateEvent>(`/api/chats/${chatId}/generate`, { type, text: opts.text, characterId: opts.characterId }, controller.signal)) {
      switch (ev.type) {
        case 'user':
          if (ev.message) upsertMessage(ev.message);
          break;
        case 'start':
          useGen.setState({ messageId: ev.messageId ?? null, swipeId: ev.swipeId ?? 0 });
          break;
        case 'delta':
          useGen.setState((s) => ({ text: s.text + (ev.text ?? '') }));
          break;
        case 'reasoning':
          useGen.setState((s) => ({ reasoning: s.reasoning + (ev.text ?? '') }));
          break;
        case 'done':
          if (ev.message) upsertMessage(ev.message as MessageDTO);
          if (type === 'impersonate') result = ev.text ?? useGen.getState().text;
          if (ev.error) toast({ title: 'Reply cut short', lines: [ev.error], tone: 'danger' });
          break;
        case 'error':
          toast({ title: 'Could not generate a reply', lines: [ev.error ?? 'Unknown error'], tone: 'danger' });
          break;
      }
    }
  } catch (e) {
    if (!controller.signal.aborted) toast({ title: 'Connection lost while generating', lines: [(e as Error).message], tone: 'danger' });
  } finally {
    useGen.setState({ chatId: null, messageId: null, type: null, text: '', reasoning: '', controller: null });
  }
  return result;
}

export async function stop(chatId: string) {
  await post(`/api/chats/${chatId}/stop`).catch(() => {});
}
