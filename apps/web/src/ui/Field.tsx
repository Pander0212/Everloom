import { forwardRef, useId, useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from '@/lib/format';

export function Field({ label, hint, error, children, htmlFor, className, trailing }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; className?: string; trailing?: ReactNode }) {
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label ? (
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
            {label}
          </label>
          {trailing}
        </div>
      ) : null}
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : hint ? <p className="text-xs text-fg-2">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cx('field', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx('field', className)} {...rest}>
      {children}
    </select>
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoGrow?: boolean;
  maxRows?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, autoGrow = true, maxRows = 16, value, ...rest }, ref) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || !autoGrow) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight + 2, line * maxRows + 24)}px`;
  }, [value, autoGrow, maxRows]);
  return (
    <textarea
      ref={(el) => {
        inner.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      value={value}
      className={cx('field resize-none', className)}
      rows={rest.rows ?? 3}
      {...rest}
    />
  );
});

export function useFieldId(prefix = 'f') {
  return `${prefix}-${useId().replace(/:/g, '')}`;
}
