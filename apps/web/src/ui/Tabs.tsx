import * as T from '@radix-ui/react-tabs';
import { motion } from 'motion/react';
import { useId, type ReactNode } from 'react';
import { cx } from '@/lib/format';
import { t } from '@/lib/motion';

export interface TabDef {
  value: string;
  label: ReactNode;
  count?: number;
}

/** Underline tabs with a sliding indicator. */
export function Tabs({ tabs, value, onChange, children, className, listClassName }: { tabs: TabDef[]; value: string; onChange: (v: string) => void; children?: ReactNode; className?: string; listClassName?: string }) {
  const id = useId();
  return (
    <T.Root value={value} onValueChange={onChange} className={className}>
      <T.List className={cx('no-scrollbar hairline-b flex gap-1 overflow-x-auto', listClassName)}>
        {tabs.map((tab) => (
          <T.Trigger key={tab.value} value={tab.value} className="relative flex h-11 flex-none items-center gap-1.5 px-3 text-sm font-medium text-fg-2 outline-none transition-colors hover:text-fg data-[state=active]:text-fg">
            {tab.label}
            {tab.count !== undefined ? <span className="text-xs text-fg-3">{tab.count}</span> : null}
            {value === tab.value ? <motion.span layoutId={`tab-${id}`} className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" transition={t.indicator} /> : null}
          </T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  );
}

export const TabPanel = ({ value, children, className }: { value: string; children: ReactNode; className?: string }) => (
  <T.Content value={value} className={cx('outline-none', className)}>
    {children}
  </T.Content>
);

/** Segmented control with a sliding thumb. */
export function Segmented<V extends string>({ options, value, onChange, size = 'md', className, label }: { options: Array<{ value: V; label: ReactNode }>; value: V; onChange: (v: V) => void; size?: 'sm' | 'md'; className?: string; label?: string }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex rounded-md bg-surface-2 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('pressable relative flex-1 whitespace-nowrap rounded-[8px] px-3 font-medium outline-none', size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm', value === o.value ? 'text-fg' : 'text-fg-2 hover:text-fg')}
        >
          {value === o.value ? <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-[8px] bg-surface shadow-1 dark:bg-surface-3" transition={t.indicator} /> : null}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
