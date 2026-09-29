import * as M from '@radix-ui/react-dropdown-menu';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '@/lib/format';
import { Icon } from './Icon';

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export function Menu({ trigger, items, align = 'end' }: { trigger: ReactNode; items: MenuItem[]; align?: 'start' | 'end' | 'center' }) {
  return (
    <M.Root modal={false}>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="z-[70] min-w-[200px] rounded-md bg-surface p-1 shadow-3 outline-none data-[state=open]:animate-[tooltip-in_140ms_var(--ease-out)] dark:bg-surface-2"
        >
          {items.map((it, i) => (
            <div key={i}>
              {it.separatorBefore ? <M.Separator className="my-1 h-px bg-line" /> : null}
              <M.Item
                disabled={it.disabled}
                onSelect={it.onSelect}
                className={cx(
                  'flex min-h-10 cursor-pointer select-none items-center gap-3 rounded-sm px-3 text-sm outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2 dark:data-[highlighted]:bg-surface-3',
                  it.danger ? 'text-danger' : 'text-fg',
                )}
              >
                {it.icon ? <Icon icon={it.icon} size={18} className={it.danger ? '' : 'text-fg-2'} /> : null}
                {it.label}
              </M.Item>
            </div>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
