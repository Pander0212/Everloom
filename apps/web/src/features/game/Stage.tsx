import type { CampaignDTO, ChatDTO, MessageDTO } from '@everloom/engine';
import type { ReactNode } from 'react';
import type { MessageActions } from '@/features/story/Message';

export interface StageProps {
  chat: ChatDTO;
  messages: MessageDTO[];
  campaign: CampaignDTO | null;
  busy: boolean;
  actions: MessageActions;
  streamText: string | null;
  streamingId: string | null;
  composer: ReactNode;
}

export default function Stage({ composer }: StageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1" />
      {composer}
    </div>
  );
}
