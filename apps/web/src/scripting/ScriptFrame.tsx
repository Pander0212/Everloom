/** One sandboxed frame (script, panel, message block or extension page), attached to the host. */
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/format';
import { attach, type FrameSpec } from './host';

export function ScriptFrame({ spec, hidden, className, minHeight = 0, maxHeight = 4000, onStopped, title }: { spec: FrameSpec; hidden?: boolean; className?: string; minHeight?: number; maxHeight?: number; onStopped?: (why: string) => void; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  const [stopped, setStopped] = useState<string | null>(null);
  // Re-attach only when what runs changes.
  const sig = `${spec.key}|${spec.kind}|${spec.code ?? ''}|${spec.html ?? ''}|${spec.permissions.join(',')}|${spec.messageId ?? ''}`;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setStopped(null);
    const h = attach(el, spec, {
      onHeight: (px) => setHeight(Math.max(minHeight, Math.min(maxHeight, px))),
      onStopped: (why) => {
        setStopped(why);
        onStopped?.(why);
      },
    });
    return () => h.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return (
    <div className={cx(hidden && 'hidden', className)}>
      <iframe
        ref={ref}
        title={title ?? (hidden ? `${spec.name} (background)` : spec.name)}
        className={cx('block w-full border-0 bg-transparent', !hidden && 'transition-[height] duration-200 ease-out motion-reduce:transition-none')}
        style={{ height: hidden ? 0 : height, colorScheme: 'normal' }}
        aria-hidden={hidden || undefined}
        tabIndex={hidden ? -1 : undefined}
      />
      {stopped && !hidden ? <p className="mt-1 text-xs text-fg-3">{stopped}</p> : null}
    </div>
  );
}
