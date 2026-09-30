/**
 * A menu at the pointer (desktop right-click) or a bottom sheet (long-press on a phone).
 * Keyboard: arrows move, Enter picks, Escape closes.
 */
import type { LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/lib/format';
import { Icon, Sheet, useDesktop } from '@/ui';

export interface ContextItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  separatorBefore?: boolean;
}

export function ContextMenu({ at, onClose, items, header, title }: { at: { clientX: number; clientY: number } | null; onClose: () => void; items: ContextItem[]; header?: ReactNode; title: string }) {
  const desktop = useDesktop();
  if (!at) return null;
  if (!desktop)
    return (
      <Sheet open onOpenChange={(o) => !o && onClose()} title={title} size="md">
        {header}
        <div className="mt-2 flex flex-col">
          {items.map((it, i) => (
            <div key={i}>
              {it.separatorBefore ? <div className="my-1 h-px bg-line" /> : null}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  it.onSelect();
                }}
                className={cx('pressable flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left text-base', it.danger ? 'text-danger' : 'text-fg')}
              >
                {it.icon ? <Icon icon={it.icon} size={20} className={it.danger ? '' : 'text-fg-2'} /> : null}
                {it.label}
              </button>
            </div>
          ))}
        </div>
      </Sheet>
    );
  return <FloatingMenu at={at} onClose={onClose} items={items} title={title} />;
}

function FloatingMenu({ at, onClose, items, title }: { at: { clientX: number; clientY: number }; onClose: () => void; items: ContextItem[]; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.clientX, top: at.clientY });
  const [active, setActive] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.min(at.clientX, window.innerWidth - r.width - 8), top: Math.min(at.clientY, window.innerHeight - r.height - 8) });
    el.querySelector<HTMLButtonElement>('button')?.focus();
  }, [at]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);
  const move = (d: number) => {
    const n = (active + d + items.length) % items.length;
    setActive(n);
    ref.current?.querySelectorAll<HTMLButtonElement>('button')[n]?.focus();
  };
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          move(-1);
        }
      }}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[80] min-w-[220px] rounded-md bg-surface p-1 shadow-3 outline-none animate-[tooltip-in_140ms_var(--ease-out)] dark:bg-surface-2"
    >
      {items.map((it, i) => (
        <div key={i}>
          {it.separatorBefore ? <div className="my-1 h-px bg-line" /> : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className={cx('flex min-h-10 w-full items-center gap-3 rounded-sm px-3 text-left text-sm outline-none hover:bg-surface-2 focus:bg-surface-2 dark:hover:bg-surface-3 dark:focus:bg-surface-3', it.danger ? 'text-danger' : 'text-fg')}
          >
            {it.icon ? <Icon icon={it.icon} size={18} className={it.danger ? '' : 'text-fg-2'} /> : null}
            {it.label}
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
