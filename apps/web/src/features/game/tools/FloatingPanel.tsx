/**
 * A tool as a floating panel (desktop only): the story stays usable underneath. Drag it by its
 * header, resize from the corner; where it sits is remembered per tool on this device.
 */
import { PanelRightClose, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useViewPrefs, type PanelPos } from '@/lib/viewPrefs';
import { IconButton } from '@/ui';

const MIN_W = 320;
const MIN_H = 260;

export const defaultPanel = (): PanelPos => {
  const w = Math.min(440, window.innerWidth - 48);
  const h = Math.min(640, window.innerHeight - 96);
  return { x: window.innerWidth - w - 24, y: 72, w, h };
};

function fit(p: PanelPos): PanelPos {
  const w = Math.max(MIN_W, Math.min(p.w, window.innerWidth - 16));
  const h = Math.max(MIN_H, Math.min(p.h, window.innerHeight - 16));
  return { w, h, x: Math.max(8, Math.min(p.x, window.innerWidth - w - 8)), y: Math.max(8, Math.min(p.y, window.innerHeight - h - 8)) };
}

export function FloatingPanel({ id, title, description, footer, headerActions, children, onClose }: { id: string; title: ReactNode; description?: ReactNode; footer?: ReactNode; headerActions?: ReactNode; children: ReactNode; onClose: () => void }) {
  const prefs = useViewPrefs();
  const [pos, setPos] = useState<PanelPos>(() => fit(prefs.floating[id] ?? defaultPanel()));
  const drag = useRef<{ mode: 'move' | 'size'; sx: number; sy: number; start: PanelPos } | null>(null);
  const labelId = useId();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onResize = () => setPos((p) => fit(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const begin = (mode: 'move' | 'size') => (e: RPointerEvent) => {
    if (e.button !== 0 || (mode === 'move' && (e.target as HTMLElement).closest('button'))) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: pos };
  };
  const move = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    setPos(fit(d.mode === 'move' ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy } : { ...d.start, w: d.start.w + dx, h: d.start.h + dy }));
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    prefs.set({ floating: { ...useViewPrefs.getState().floating, [id]: pos } });
  };
  const nudge = (dx: number, dy: number) => {
    const next = fit({ ...pos, x: pos.x + dx, y: pos.y + dy });
    setPos(next);
    prefs.set({ floating: { ...useViewPrefs.getState().floating, [id]: next } });
  };
  const dock = () => {
    const { [id]: _gone, ...rest } = useViewPrefs.getState().floating;
    prefs.set({ floating: rest });
  };
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelId}
      data-testid="floating-panel"
      className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-3"
      style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h }}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="flex flex-none cursor-grab items-start gap-2 px-4 pb-2 pt-3 active:cursor-grabbing"
        onPointerDown={begin('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        data-testid="panel-handle"
      >
        <div
          className="min-w-0 flex-1 select-none outline-none"
          tabIndex={0}
          aria-label="Move panel with the arrow keys"
          onKeyDown={(e) => {
            const step = e.shiftKey ? 40 : 10;
            if (e.key === 'ArrowLeft') nudge(-step, 0);
            else if (e.key === 'ArrowRight') nudge(step, 0);
            else if (e.key === 'ArrowUp') nudge(0, -step);
            else if (e.key === 'ArrowDown') nudge(0, step);
            else return;
            e.preventDefault();
          }}
        >
          <h2 id={labelId} className="truncate text-lg font-semibold">
            {title}
          </h2>
          {description ? <p className="truncate text-sm text-fg-2">{description}</p> : null}
        </div>
        {headerActions}
        <IconButton icon={PanelRightClose} label="Dock panel" onClick={dock} />
        <IconButton icon={X} label="Close" onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      {footer ? <div className="flex flex-none items-center gap-2 border-t border-line px-4 py-3">{footer}</div> : null}
      <div className="absolute bottom-0 right-0 size-4 cursor-nwse-resize" onPointerDown={begin('size')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden="true" data-testid="panel-resize" />
    </div>
  );
}
