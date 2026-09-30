/**
 * A windowed grid or list: only the rows near the viewport are in the DOM, so thousands of
 * characters stay smooth on a phone. Uses the page's own scroll container (no nested scroller).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

function scrollParent(el: HTMLElement | null): HTMLElement | Window {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'auto' || o === 'scroll') return p;
  }
  return window;
}

export interface VirtualGridProps<T> {
  items: T[];
  /** Grid: columns follow the width; list: one column. */
  mode: 'grid' | 'list';
  /** Minimum card width in grid mode (px). */
  minColumnWidth?: number;
  gap?: number;
  /** Row height for a given column width. */
  rowHeight: (columnWidth: number) => number;
  overscan?: number;
  getKey: (item: T) => string;
  render: (item: T, index: number) => ReactNode;
  className?: string;
  label?: string;
}

export function VirtualGrid<T>({ items, mode, minColumnWidth = 150, gap = 12, rowHeight, overscan = 3, getKey, render, className, label }: VirtualGridProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 12]);
  const cols = mode === 'list' ? 1 : Math.max(2, Math.floor((width + gap) / (minColumnWidth + gap)) || 2);
  const colW = width ? (width - gap * (cols - 1)) / cols : minColumnWidth;
  const rowH = rowHeight(colW);
  const rows = Math.ceil(items.length / cols);
  const total = rows ? rows * rowH + (rows - 1) * gap : 0;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sp = scrollParent(el);
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = el.getBoundingClientRect().top;
      const viewTop = sp === window ? 0 : (sp as HTMLElement).getBoundingClientRect().top;
      const viewH = sp === window ? window.innerHeight : (sp as HTMLElement).clientHeight;
      const offset = viewTop - top; // how far the grid top is above the viewport top
      const stride = rowH + gap;
      const first = Math.max(0, Math.floor(offset / stride) - overscan);
      const last = Math.min(rows, Math.ceil((offset + viewH) / stride) + overscan);
      setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
    };
    const on = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    sp.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      sp.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [rows, rowH, gap, overscan]);

  const children: ReactNode[] = [];
  for (let r = range[0]; r < Math.min(range[1], rows); r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= items.length) break;
      children.push(
        <div key={getKey(items[i])} role="listitem" style={{ position: 'absolute', top: r * (rowH + gap), left: c * (colW + gap), width: colW, height: rowH }}>
          {render(items[i], i)}
        </div>,
      );
    }
  }
  return (
    <div ref={ref} role="list" aria-label={label} aria-rowcount={rows} className={className} style={{ position: 'relative', height: total }} data-rendered={children.length}>
      {children}
    </div>
  );
}
