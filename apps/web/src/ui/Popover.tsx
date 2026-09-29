import * as P from '@radix-ui/react-popover';
import type { ReactNode } from 'react';

/** Small anchored panel (legends, quick info). Stays above sheets. */
export function Popover({ trigger, children, side = 'top', align = 'start' }: { trigger: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; align?: 'start' | 'center' | 'end' }) {
  return (
    <P.Root>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className="toast-enter z-[70] max-h-[var(--radix-popover-content-available-height)] max-w-[min(320px,calc(100vw-24px))] overflow-y-auto rounded-lg bg-surface p-3 shadow-3 outline-none"
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
