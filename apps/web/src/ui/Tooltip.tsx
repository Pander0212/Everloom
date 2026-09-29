import * as T from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

/** Tooltip — fade/rise adapted from Uiverse.io by EcheverriaJesus (see CREDITS.md). */
export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <T.Root delayDuration={350}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="tooltip">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const TooltipProvider = T.Provider;
