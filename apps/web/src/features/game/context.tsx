import type { CampaignDTO, CampaignState, ChatDTO, Op } from '@everloom/engine';
import { createContext, useContext } from 'react';
import { post } from '@/lib/api';
import { setCampaignState } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';

export type ToolId =
  | 'journal' | 'diary' | 'map' | 'orgs' | 'activities' | 'battle'
  | 'persona' | 'inventory' | 'characters' | 'party' | 'social'
  | 'databank' | 'phone' | 'npcs' | 'calendar' | 'atmosphere' | 'helper'
  | 'status' | 'newgame' | 'log' | 'help';

export interface GameCtx {
  chat: ChatDTO;
  campaign: CampaignDTO | null;
  state: CampaignState | null;
  busy: boolean;
  open: (tool: ToolId, arg?: string) => void;
  close: () => void;
  /** Apply user ops through the server (anchored to the latest message). Returns the change summary. */
  apply: (ops: Op[] | Op, opts?: { quiet?: boolean }) => Promise<string[] | null>;
  run: (type: 'normal' | 'continue', text?: string) => Promise<unknown>;
  setComposer: (v: string) => void;
}

export const GameContext = createContext<GameCtx | null>(null);

export function useGame(): GameCtx {
  const g = useContext(GameContext);
  if (!g) throw new Error('useGame outside GameLayer');
  return g;
}

export async function applyOps(chat: ChatDTO, ops: Op[], quiet?: boolean): Promise<string[] | null> {
  if (!chat.campaignId) {
    toast({ title: 'This chat has no game campaign', tone: 'danger' });
    return null;
  }
  try {
    const r = await post<{ state: CampaignState; summary: string[]; errors: string[] }>(`/api/campaigns/${chat.campaignId}/ops`, { chatId: chat.id, ops });
    setCampaignState(chat.campaignId, r.state);
    if (r.errors.length) toast({ title: r.errors[0], tone: 'danger' });
    else if (!quiet && r.summary.length) toast({ title: 'Updated', lines: r.summary });
    return r.summary;
  } catch (e) {
    toastError(e);
    return null;
  }
}
