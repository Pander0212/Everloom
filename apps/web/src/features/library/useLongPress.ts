import { useRef } from 'react';

/**
 * Long-press on touch (and pen): fires after `ms` without moving; the click that follows is
 * swallowed. Mouse users get the context menu from right-click instead.
 */
export function useLongPress(onLongPress: (e: { clientX: number; clientY: number }) => void, ms = 480) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
      const pt = { clientX: e.clientX, clientY: e.clientY };
      clear();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(10);
        onLongPress(pt);
      }, ms);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: React.MouseEvent) => {
      // Right-click on desktop; on touch the long-press already handled it.
      e.preventDefault();
      if (!fired.current) onLongPress({ clientX: e.clientX, clientY: e.clientY });
    },
    /** Call from onClick: true when the click should be ignored (it ended a long-press). */
    swallowClick: () => {
      if (fired.current) {
        fired.current = false;
        return true;
      }
      return false;
    },
  };
}
