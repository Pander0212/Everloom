import type { CampaignDTO, ChatDTO } from '@everloom/engine';
import type { ReactNode } from 'react';

export interface GameLayerProps {
  chat: ChatDTO;
  campaign: CampaignDTO | null;
  busy: boolean;
  onRun: (type: 'normal' | 'continue', text?: string) => Promise<unknown>;
  setComposer: (v: string) => void;
  children: ReactNode;
}

export function GameLayer({ children }: GameLayerProps) {
  return <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>;
}
