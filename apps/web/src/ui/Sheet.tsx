import { HelpCircle, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { HelpNote } from './HelpNote';
import { Drawer } from 'vaul';
import { cx } from '@/lib/format';
import { IconButton } from './Button';
import { useDesktop } from './useMedia';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  /** md = compact, lg = roomy, full = nearly full height/width. */
  size?: 'md' | 'lg' | 'full';
  /** Remove body padding (for edge-to-edge content like maps). */
  flush?: boolean;
  dismissible?: boolean;
  /** "What is this?": plain words and an example, behind a help button in the header. */
  help?: string;
}

/**
 * Bottom sheet on phones (drag handle, follows the finger, swipe down to dismiss),
 * side panel on desktop. Built on vaul (Radix Dialog underneath) for focus trapping and a11y.
 */
export function Sheet({ open, onOpenChange, title, description, children, footer, headerActions, size = 'md', flush, dismissible = true, help }: SheetProps) {
  const desktop = useDesktop();
  const [showHelp, setShowHelp] = useState(false);
  const width = size === 'md' ? 'min(460px, 100vw)' : size === 'lg' ? 'min(640px, 100vw)' : 'min(960px, 100vw)';
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction={desktop ? 'right' : 'bottom'} dismissible={dismissible} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-overlay backdrop-blur-[2px]" />
        <Drawer.Content
          aria-describedby={undefined}
          className={cx(
            'fixed z-50 flex flex-col bg-surface outline-none',
            desktop ? 'bottom-2 right-2 top-2 rounded-lg shadow-3' : 'inset-x-0 bottom-0 rounded-t-lg shadow-3',
          )}
          style={desktop ? { width } : { maxHeight: size === 'full' ? 'calc(100dvh - var(--safe-top) - 12px)' : 'calc(92dvh - var(--safe-top))', height: size === 'full' ? 'calc(100dvh - var(--safe-top) - 12px)' : undefined }}
        >
          {!desktop ? <div className="mx-auto mt-2 h-1 w-9 flex-none rounded-full bg-line-strong" aria-hidden="true" /> : null}
          <div className="flex flex-none items-start gap-2 px-4 pb-2 pt-3 sm:px-5">
            <div className="min-w-0 flex-1 pt-1.5">
              <Drawer.Title className="truncate text-lg font-semibold text-fg">{title}</Drawer.Title>
              {description ? <Drawer.Description className="mt-0.5 text-sm text-fg-2">{description}</Drawer.Description> : null}
            </div>
            {headerActions}
            {help ? <IconButton icon={HelpCircle} label="What is this?" active={showHelp} onClick={() => setShowHelp((v) => !v)} /> : null}
            <IconButton icon={X} label="Close" onClick={() => onOpenChange(false)} />
          </div>
          <div className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain', !flush && 'px-4 pb-4 sm:px-5')} data-vaul-no-drag={flush ? '' : undefined}>
            {help && showHelp ? <HelpNote className={flush ? 'm-4' : 'mb-4'} onClose={() => setShowHelp(false)}>{help}</HelpNote> : null}
            {children}
          </div>
          {footer ? <div className="hairline-t flex flex-none items-center gap-2 px-4 py-3 safe-bottom sm:px-5">{footer}</div> : <div className="safe-bottom flex-none" />}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
