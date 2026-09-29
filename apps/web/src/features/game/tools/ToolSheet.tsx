import type { ReactNode } from 'react';
import { Sheet } from '@/ui';
import { useGame } from '../context';

export function ToolSheet({ title, description, children, footer, size = 'lg', headerActions, flush }: { title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' | 'full'; headerActions?: ReactNode; flush?: boolean }) {
  const { close } = useGame();
  return (
    <Sheet open onOpenChange={(o) => !o && close()} title={title} description={description} footer={footer} size={size} headerActions={headerActions} flush={flush}>
      {children}
    </Sheet>
  );
}

export function NoCampaign() {
  return <p className="py-10 text-center text-sm text-fg-2">This chat has no game campaign.</p>;
}
