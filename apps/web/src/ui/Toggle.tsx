import type { ReactNode } from 'react';
import { cx } from '@/lib/format';

/** Switch — styles adapted from Uiverse.io by zanina-yassine (see CREDITS.md). */
export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <span className="switch">
      <input id={id} type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span className="thumb" />
    </span>
  );
}

/** Checkbox — tick animation adapted from Uiverse.io by elijahgummer (see CREDITS.md). */
export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <span className="check">
      <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <polyline points="15 6 8.5 13 5 9.5" />
      </svg>
    </span>
  );
}

/** A settings-style row: label + description on the left, control on the right. Tapping the row toggles. */
export function ToggleRow({ label, description, checked, onChange, disabled }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cx('flex min-h-[52px] cursor-pointer items-center justify-between gap-4 py-2', disabled && 'opacity-50')}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-fg-2">{description}</span> : null}
      </span>
      <Switch checked={checked} onChange={onChange} label={typeof label === 'string' ? label : 'Toggle'} disabled={disabled} />
    </label>
  );
}
