import * as D from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { t } from '@/lib/motion';
import { Button } from './Button';

export function Dialog({ open, onOpenChange, title, description, children, footer }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <D.Portal forceMount>
            <D.Overlay asChild>
              <motion.div className="fixed inset-0 z-[60] bg-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={t.fast} />
            </D.Overlay>
            <div className="pointer-events-none fixed inset-0 z-[61] flex items-center justify-center p-4">
              <D.Content asChild aria-describedby={description ? undefined : undefined}>
                <motion.div
                  className="pointer-events-auto w-full max-w-[400px] rounded-lg bg-surface p-5 shadow-3"
                  initial={{ opacity: 0, scale: 0.97, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={t.base}
                >
                  <D.Title className="text-lg font-semibold">{title}</D.Title>
                  {description ? <D.Description className="mt-1.5 text-sm text-fg-2">{description}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
                  {children ? <div className="mt-4">{children}</div> : null}
                  {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
                </motion.div>
              </D.Content>
            </div>
          </D.Portal>
        ) : null}
      </AnimatePresence>
    </D.Root>
  );
}

interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ req: ConfirmRequest | null; set: (r: ConfirmRequest | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

/** Promise-based confirmation for destructive actions. */
export function confirm(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.getState().set({ ...opts, resolve }));
}

export function ConfirmHost() {
  const { req, set } = useConfirmStore();
  const [busy, setBusy] = useState(false);
  const close = (ok: boolean) => {
    req?.resolve(ok);
    set(null);
    setBusy(false);
  };
  return (
    <Dialog
      open={!!req}
      onOpenChange={(o) => !o && close(false)}
      title={req?.title ?? ''}
      description={req?.description}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            variant={req?.danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => {
              setBusy(true);
              close(true);
            }}
          >
            {req?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    />
  );
}

interface PasswordRequest {
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Allow an empty answer ("no password"). */
  optional?: boolean;
  resolve: (password: string | null) => void;
}
const usePasswordStore = create<{ req: PasswordRequest | null; set: (r: PasswordRequest | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

/** Ask for a password (exports, encrypted imports). Resolves null when cancelled. */
export function askPassword(opts: Omit<PasswordRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => usePasswordStore.getState().set({ ...opts, resolve }));
}

export function PasswordHost() {
  const { req, set } = usePasswordStore();
  const [value, setValue] = useState('');
  const close = (v: string | null) => {
    req?.resolve(v);
    set(null);
    setValue('');
  };
  return (
    <Dialog
      open={!!req}
      onOpenChange={(o) => !o && close(null)}
      title={req?.title ?? ''}
      description={req?.description}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(null)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!req?.optional && !value} onClick={() => close(value)}>
            {req?.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (req?.optional || value) close(value);
        }}
      >
        <input
          type="password"
          autoFocus
          aria-label="Password"
          autoComplete="new-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-11 w-full rounded-md border border-line bg-surface-2 px-3 text-base outline-none focus-visible:border-accent"
        />
      </form>
    </Dialog>
  );
}
