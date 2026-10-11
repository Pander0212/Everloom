import { HelpCircle, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cx } from '@/lib/format';
import { Icon } from './Icon';

/** "What is this?": a short plain-language note with an example, shown at the top of a screen. */
export function HelpNote({ children, onClose, className }: { children: ReactNode; onClose?: () => void; className?: string }) {
  return (
    <div role="note" aria-label="What is this?" className={cx('ev-help flex items-start gap-2.5 rounded-md bg-accent-soft px-3 py-2.5 text-sm leading-6 text-fg', className)}>
      <Icon icon={HelpCircle} size={18} className="mt-0.5 flex-none text-accent-text" />
      <div className="min-w-0 flex-1">
        <span className="font-medium">What is this? </span>
        {children}
      </div>
      {onClose ? (
        <button onClick={onClose} aria-label="Hide help" className="-m-1 rounded-sm p-1 text-fg-3 hover:text-fg">
          <Icon icon={X} size={16} />
        </button>
      ) : null}
    </div>
  );
}

/** A "What is this?" link that opens the note in place (settings pages and groups). */
export function HelpToggle({ help, className }: { help: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      {open ? (
        <HelpNote onClose={() => setOpen(false)}>{help}</HelpNote>
      ) : (
        <button onClick={() => setOpen(true)} className="pressable flex items-center gap-1.5 rounded-sm text-xs font-medium text-accent-text">
          <Icon icon={HelpCircle} size={14} /> What is this?
        </button>
      )}
    </div>
  );
}
