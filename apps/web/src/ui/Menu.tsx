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
  /** A heading shown above the first item of each group. */
  group?: string;
  /** One line under the label. */
  description?: string;
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
          className="z-[70] max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[200px] overflow-y-auto rounded-md bg-surface p-1 shadow-3 outline-none data-[state=open]:animate-[tooltip-in_140ms_var(--ease-out)] dark:bg-surface-2"
        >
          {items.map((it, i) => (
            <div key={i}>
              {it.separatorBefore || (it.group && i > 0 && items[i - 1]!.group !== it.group) ? <M.Separator className="my-1 h-px bg-line" /> : null}
              {it.group && items[i - 1]?.group !== it.group ? <M.Label className="px-3 pb-0.5 pt-1.5 text-xs font-medium text-fg-3">{it.group}</M.Label> : null}
              <M.Item
                disabled={it.disabled}
                onSelect={it.onSelect}
                className={cx(
                  'flex min-h-10 cursor-pointer select-none items-center gap-3 rounded-sm px-3 text-sm outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-2 dark:data-[highlighted]:bg-surface-3',
                  it.danger ? 'text-danger' : 'text-fg',
                )}
              >
                {it.icon ? <Icon icon={it.icon} size={18} className={it.danger ? '' : 'text-fg-2'} /> : null}
                {it.description ? (
                  <span className="flex min-w-0 flex-col py-1.5">
                    <span>{it.label}</span>
                    <span className={cx('text-xs', it.danger ? 'opacity-80' : 'text-fg-2')}>{it.description}</span>
                  </span>
                ) : (
                  it.label
                )}
              </M.Item>
            </div>
          ))}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
