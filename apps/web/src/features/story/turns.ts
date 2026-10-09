/**
 * Undo and redo for turns (docs/ux/hakawati.md). Undo takes the last turn away (your message and
 * the reply to it) and rolls back its story changes, like deleting it; redo puts it back as it was
 * and reads its story changes again. Up to 50 turns per chat, kept until the page reloads; a new
 * turn clears what can be redone.
 */
import type { MessageDTO } from '@everloom/engine';
import { del, post } from '@/lib/api';
import { qk, queryClient, upsertMessage } from '@/lib/queries';

const redo = new Map<string, MessageDTO[][]>();

export const canRedo = (chatId: string) => (redo.get(chatId)?.length ?? 0) > 0;
export const clearRedo = (chatId: string) => redo.delete(chatId);

/** The last turn: the newest message, with the message of yours it answers. Never the opening. */
export function lastTurn(list: MessageDTO[]): MessageDTO[] {
  if (list.length < 2) return [];
  let i = list.length - 1;
  if (list[i]!.role !== 'user') {
    let j = i;
    while (j > 0 && list[j]!.role !== 'user') j--;
    if (list[j]!.role === 'user') i = j;
  }
  return i === 0 ? [] : list.slice(i);
}

export async function undoTurn(chatId: string): Promise<boolean> {
  const list = queryClient.getQueryData<MessageDTO[]>(qk.messages(chatId)) ?? [];
  const turn = lastTurn(list);
  if (!turn.length) return false;
  const r = await del<{ ids: string[] }>(`/api/messages/${turn[0]!.id}?after=1`);
  queryClient.setQueryData<MessageDTO[]>(qk.messages(chatId), (l) => l?.filter((x) => !r.ids.includes(x.id)));
  const stack = redo.get(chatId) ?? [];
  stack.push(turn);
  redo.set(chatId, stack.slice(-50));
  return true;
}

export async function redoTurn(chatId: string, game: boolean): Promise<boolean> {
  const stack = redo.get(chatId);
  const turn = stack?.pop();
  if (!turn) return false;
  const r = await post<{ messages: MessageDTO[] }>(`/api/chats/${chatId}/messages/restore`, {
    messages: turn.map((m) => ({ role: m.role, name: m.name, characterId: m.characterId, swipes: m.swipes, swipeId: m.swipeId, hidden: m.hidden, extra: m.extra })),
  });
  r.messages.forEach(upsertMessage);
  // Its story changes come back by reading the replies again.
  if (game) for (const m of r.messages) if (m.role === 'assistant') await post(`/api/messages/${m.id}/retrack`).catch(() => {});
  return true;
}
