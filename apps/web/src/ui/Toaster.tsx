import { CheckCircle2, Sparkle, TriangleAlert, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';
import { cx } from '@/lib/format';
import { t } from '@/lib/motion';
import { useUi, type ToastItem } from '@/lib/store';
import { Icon } from './Icon';

function ToastView({ item }: { item: ToastItem }) {
  const dismiss = useUi((s) => s.dismiss);
  useEffect(() => {
    const ms = item.duration ?? (item.tone === 'danger' ? 6000 : 3600);
    const h = setTimeout(() => dismiss(item.id), ms);
    return () => clearTimeout(h);
  }, [item, dismiss]);
  const icon = item.tone === 'danger' ? TriangleAlert : item.tone === 'success' ? CheckCircle2 : item.tone === 'reward' ? Sparkle : null;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, transition: t.fast }}
      transition={t.base}
      role={item.tone === 'danger' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full max-w-[420px] items-start gap-3 rounded-md bg-surface px-3.5 py-3 shadow-3 dark:bg-surface-2"
    >
      {icon ? <Icon icon={icon} size={18} className={cx('mt-0.5 flex-none', item.tone === 'danger' ? 'text-danger' : item.tone === 'success' ? 'text-success' : 'text-accent-text')} /> : null}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{item.title}</p>
        {item.lines?.length ? <p className="mt-0.5 text-sm text-fg-2">{item.lines.join(' · ')}</p> : null}
      </div>
      {item.action ? (
        <button className="pressable -my-1 rounded-sm px-2 py-1 text-sm font-semibold text-accent-text hover:bg-accent-soft" onClick={() => { item.action!.run(); dismiss(item.id); }}>
          {item.action.label}
        </button>
      ) : null}
      <button aria-label="Dismiss" className="-m-1 rounded-sm p-1 text-fg-3 hover:text-fg" onClick={() => dismiss(item.id)}>
        <Icon icon={X} size={16} />
      </button>
    </motion.div>
  );
}

/** Toasts appear at the top so they never cover the composer or the thumb zone. */
export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] flex flex-col items-center gap-2 px-4 pt-[calc(var(--safe-top)+12px)]" aria-live="polite">
      <AnimatePresence initial={false}>{toasts.map((tt) => <ToastView key={tt.id} item={tt} />)}</AnimatePresence>
    </div>
  );
}
