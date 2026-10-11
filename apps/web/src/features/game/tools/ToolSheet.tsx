import { HelpCircle, PictureInPicture2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { entryForTool } from '@/lib/registry';
import { HelpNote } from '@/ui/HelpNote';
import { useViewPrefs } from '@/lib/viewPrefs';
import { IconButton, Sheet, useMedia } from '@/ui';
import { useGame } from '../context';
import { defaultPanel, FloatingPanel } from './FloatingPanel';

export function ToolSheet({ title, description, children, footer, size = 'lg', headerActions, flush, help }: { title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' | 'full'; headerActions?: ReactNode; flush?: boolean; /** "What is this?" (defaults to the tool's entry in lib/registry). */ help?: string }) {
  const { close, toolId } = useGame();
  const [showHelp, setShowHelp] = useState(false);
  const helpText = help ?? (toolId ? entryForTool(toolId)?.help : undefined);
  const helpBtn = helpText ? <IconButton icon={HelpCircle} label="What is this?" active={showHelp} onClick={() => setShowHelp((v) => !v)} /> : null;
  const body = (
    <>
      {showHelp && helpText ? <HelpNote className={flush ? 'm-4' : 'mb-4'} onClose={() => setShowHelp(false)}>{helpText}</HelpNote> : null}
      {children}
    </>
  );
  // Movable panels are a desktop thing: a wide window and a mouse.
  const desktop = useMedia('(min-width: 1024px) and (pointer: fine)');
  const floating = useViewPrefs((v) => (toolId ? v.floating[toolId] : undefined));
  const setPrefs = useViewPrefs((v) => v.set);
  // Full-size tools (the map, battles) stay sheets.
  const canFloat = desktop && !!toolId && size !== 'full';
  if (canFloat && floating) {
    return (
      <FloatingPanel id={toolId!} title={title} description={description} footer={footer} headerActions={<>{headerActions}{helpBtn}</>} onClose={close}>
        {body}
      </FloatingPanel>
    );
  }
  const float = canFloat ? <IconButton icon={PictureInPicture2} label="Float this panel" onClick={() => setPrefs({ floating: { ...useViewPrefs.getState().floating, [toolId!]: defaultPanel() } })} /> : null;
  return (
    <Sheet open onOpenChange={(o) => !o && close()} title={title} description={description} footer={footer} size={size} headerActions={float || headerActions || helpBtn ? <>{headerActions}{helpBtn}{float}</> : undefined} flush={flush}>
      {body}
    </Sheet>
  );
}

export function NoCampaign() {
  return <p className="py-10 text-center text-sm text-fg-2">This chat has no game campaign.</p>;
}
