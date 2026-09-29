import type { LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '@/lib/format';
import { Icon } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
export type ButtonSize = 'sm' | 'md' | 'lg';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover font-semibold',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3 font-medium',
  ghost: 'bg-transparent text-fg hover:bg-surface-2 font-medium',
  quiet: 'bg-transparent text-fg-2 hover:text-fg hover:bg-surface-2 font-medium',
  danger: 'bg-danger-soft text-danger hover:bg-danger hover:text-white font-semibold',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-sm',
  md: 'h-10 px-4 text-sm gap-2 rounded-md tap',
  lg: 'h-12 px-5 text-base gap-2 rounded-md',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        'pressable inline-flex select-none items-center justify-center whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" style={{ width: 16, height: 16 }} /> : icon ? <Icon icon={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
      {iconRight && !loading ? <Icon icon={iconRight} size={size === 'sm' ? 16 : 18} /> : null}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: 'sm' | 'md';
  active?: boolean;
  tone?: 'default' | 'accent' | 'danger';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 'md', active, tone = 'default', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'pressable inline-flex flex-none items-center justify-center rounded-md disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-8 w-8' : 'tap h-10 w-10',
        tone === 'accent' ? 'bg-accent text-accent-fg hover:bg-accent-hover' : tone === 'danger' ? 'text-danger hover:bg-danger-soft' : active ? 'bg-accent-soft text-accent-text' : 'text-fg-2 hover:bg-surface-2 hover:text-fg',
        className,
      )}
      {...rest}
    >
      <Icon icon={icon} size={size === 'sm' ? 18 : 20} />
    </button>
  );
});
