import { PictureInPicture2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useViewPrefs } from '@/lib/viewPrefs';
import { IconButton, Sheet, useMedia } from '@/ui';
import { useGame } from '../context';
import { defaultPanel, FloatingPanel } from './FloatingPanel';

export function ToolSheet({ title, description, children, footer, size = 'lg', headerActions, flush }: { title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' | 'full'; headerActions?: ReactNode; flush?: boolean }) {
  const { close, toolId } = useGame();
  // Movable panels are a desktop thing: a wide window and a mouse.
  const desktop = useMedia('(min-width: 1024px) and (pointer: fine)');
  const floating = useViewPrefs((v) => (toolId ? v.floating[toolId] : undefined));
  const setPrefs = useViewPrefs((v) => v.set);
  // Full-size tools (the map, battles) stay sheets.
  const canFloat = desktop && !!toolId && size !== 'full';
  if (canFloat && floating) {
    return (
      <FloatingPanel id={toolId!} title={title} description={description} footer={footer} headerActions={headerActions} onClose={close}>
        {children}
      </FloatingPanel>
    );
  }
  const float = canFloat ? <IconButton icon={PictureInPicture2} label="Float this panel" onClick={() => setPrefs({ floating: { ...useViewPrefs.getState().floating, [toolId!]: defaultPanel() } })} /> : null;
  return (
    <Sheet open onOpenChange={(o) => !o && close()} title={title} description={description} footer={footer} size={size} headerActions={float || headerActions ? <>{headerActions}{float}</> : undefined} flush={flush}>
      {children}
    </Sheet>
  );
}

export function NoCampaign() {
  return <p className="py-10 text-center text-sm text-fg-2">This chat has no game campaign.</p>;
}
