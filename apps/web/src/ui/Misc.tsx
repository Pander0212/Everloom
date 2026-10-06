import { ArtPicture } from '@/lib/art';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '@/lib/format';
import { Icon } from './Icon';

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'danger' | 'success' | 'warning'; className?: string }) {
  const tones = {
    neutral: 'bg-surface-2 text-fg-2',
    accent: 'bg-accent-soft text-accent-text',
    danger: 'bg-danger-soft text-danger',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
  };
  return <span className={cx('inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-sans text-xs text-fg-2">{children}</kbd>;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('spinner inline-block text-fg-2', className)} role="status" aria-label="Loading" />;
}

/** Typing indicator — adapted from Uiverse.io by adamgiebl (see CREDITS.md). */
export function Typing({ className }: { className?: string }) {
  return (
    <span className={cx('typing', className)} role="status" aria-label="Writing">
      <span />
      <span />
      <span />
    </span>
  );
}

export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center justify-between gap-2 pb-2 pt-5', className)}>
      <h2 className="text-sm font-semibold text-fg-2">{children}</h2>
      {action}
    </div>
  );
}

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
  chevron?: boolean;
  active?: boolean;
  className?: string;
}

/** List over cards: a pressable row with hairline separators handled by the parent (divide-y). */
export function ListRow({ title, subtitle, leading, trailing, onClick, chevron, active, className }: ListRowProps) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx('flex min-h-14 w-full items-center gap-3 px-1 py-2.5 text-left', onClick && 'pressable -mx-1 rounded-md px-2 hover:bg-surface-2', active && 'bg-accent-soft', className)}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-medium text-fg">{title}</span>
        {subtitle ? <span className="mt-0.5 block truncate text-sm text-fg-2">{subtitle}</span> : null}
      </span>
      {trailing}
      {chevron ? <Icon icon={ChevronRight} size={18} className="flex-none text-fg-3" /> : null}
    </Comp>
  );
}

/** An empty screen. `art` names one of Everloom's spot illustrations (art/empty/<art>), shown instead of the icon while illustrations are on. */
export function EmptyState({ icon, art, title, body, action, className }: { icon?: LucideIcon; art?: string; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  const iconEl = icon ? <Icon icon={icon} size={28} className="mb-3 text-fg-3" /> : null;
  return (
    <div className={cx('flex flex-col items-center px-6 py-12 text-center', className)}>
      {art ? <ArtPicture src={`empty/${art}`} avif={false} width={160} height={160} className="mb-3 block" imgClassName="h-32 w-32 object-contain" fallback={iconEl} /> : iconEl}
      <p className="text-base font-medium text-fg">{title}</p>
      {body ? <p className="mt-1 max-w-[340px] text-sm text-fg-2">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-lg border border-line bg-surface', className)}>{children}</div>;
}
