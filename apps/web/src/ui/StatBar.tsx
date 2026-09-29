import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/format';
import { t } from '@/lib/motion';

const TONES = {
  accent: 'var(--accent)',
  danger: 'var(--danger)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  neutral: 'var(--text-2)',
} as const;

/**
 * A stat bar that animates to its new value (scaleX, GPU-cheap) and floats the
 * +/- difference up when it changes.
 */
export function StatBar({ label, value, max, tone = 'accent', compact, showValue = true, className }: { label: string; value: number; max: number; tone?: keyof typeof TONES; compact?: boolean; showValue?: boolean; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const prev = useRef(value);
  const [delta, setDelta] = useState<{ id: number; d: number } | null>(null);
  useEffect(() => {
    const d = Math.round(value - prev.current);
    prev.current = value;
    if (d) {
      const id = Date.now();
      setDelta({ id, d });
      const h = setTimeout(() => setDelta((x) => (x?.id === id ? null : x)), 1400);
      return () => clearTimeout(h);
    }
  }, [value]);
  return (
    <div className={cx('relative min-w-0', className)} role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
      <div className={cx('flex items-baseline justify-between gap-2', compact ? 'mb-1 text-xs' : 'mb-1.5 text-sm')}>
        <span className="truncate font-medium text-fg-2">{label}</span>
        {showValue ? (
          <span className="tabular-nums text-fg">
            {Math.round(value)}
            <span className="text-fg-3">/{max}</span>
          </span>
        ) : null}
      </div>
      <div className={cx('overflow-hidden rounded-full bg-surface-3', compact ? 'h-1' : 'h-1.5')}>
        <motion.div className="h-full origin-left rounded-full" style={{ background: TONES[tone] }} initial={false} animate={{ scaleX: pct }} transition={t.slow} />
      </div>
      <AnimatePresence>
        {delta ? (
          <motion.span
            key={delta.id}
            className={cx('pointer-events-none absolute right-0 -top-3 text-xs font-semibold tabular-nums', delta.d > 0 ? 'text-success' : 'text-danger')}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: -6 }}
            exit={{ opacity: 0, y: -14 }}
            transition={t.slow}
          >
            {delta.d > 0 ? '+' : '−'}
            {Math.abs(delta.d)}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
