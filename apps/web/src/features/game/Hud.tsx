import { formatClock, formatDate, trackerState, type CampaignState } from '@everloom/engine';
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, Coins, GripVertical, MapPin, PanelTop, Sun, SunDim, Thermometer, Wind } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSettings } from '@/lib/queries';
import { useViewPrefs } from '@/lib/viewPrefs';
import { cx } from '@/lib/format';
import { Icon, IconButton, useMedia } from '@/ui';
import { useGame } from './context';
import { useFeatureOn } from '@/lib/features';

export const WEATHER_ICON = { clear: Sun, cloudy: Cloud, overcast: SunDim, rain: CloudRain, storm: CloudLightning, snow: CloudSnow, fog: CloudFog, wind: Wind, heat: Thermometer } as const;

function Mini({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <span className="flex min-w-[64px] flex-col gap-1" title={`${label} ${Math.round(value)}/${max}`}>
      <span className="flex items-baseline justify-between gap-1.5 text-xs leading-none">
        <span className="font-medium text-fg-2">{label}</span>
        <span className="tabular-nums text-fg">{Math.round(value)}</span>
      </span>
      <span className="h-1 overflow-hidden rounded-full bg-surface-3">
        <motion.span className="block h-full origin-left rounded-full" style={{ background: tone }} initial={false} animate={{ scaleX: pct }} transition={{ duration: 0.35 }} />
      </span>
    </span>
  );
}

export function HudItems({ s, pinned }: { s: CampaignState; pinned: string[] }) {
  const cal = s.meta.calendar;
  const loc = s.currentLocationId ? s.locations[s.currentLocationId] : null;
  const out: React.ReactNode[] = [];
  for (const id of pinned) {
    if (id === 'time') out.push(<span key={id} className="whitespace-nowrap text-sm font-medium tabular-nums text-fg">{formatClock(s.time.minutes, cal)}</span>);
    else if (id === 'date') out.push(<span key={id} className="text-xs text-fg-2">{formatDate(s.time.minutes, cal, '{mon} {day}')}</span>);
    else if (id === 'weather')
      out.push(
        <span key={id} className="flex items-center gap-1 text-xs text-fg-2" title={s.weather.kind}>
          <Icon icon={WEATHER_ICON[s.weather.kind] ?? Sun} size={16} />
          {s.weather.tempC}°
        </span>,
      );
    else if (id === 'location' && loc)
      out.push(
        <span key={id} className="flex max-w-[140px] items-center gap-1 text-xs text-fg-2">
          <Icon icon={MapPin} size={14} className="flex-none" />
          <span className="truncate">{loc.name}</span>
        </span>,
      );
    else if (id === 'currency')
      out.push(
        <span key={id} className="flex items-center gap-1 text-xs tabular-nums text-fg-2">
          <Icon icon={Coins} size={14} />
          {s.player.currency}
        </span>,
      );
    else if (s.player.bars[id] && id !== 'xp') out.push(<Mini key={id} label={s.player.bars[id].label} value={s.player.bars[id].cur} max={s.player.bars[id].max} tone={id === 'hp' ? 'var(--danger)' : 'var(--accent)'} />);
    else if (id === 'xp' && s.player.bars.xp) out.push(<Mini key={id} label={`Lv ${s.player.level}`} value={s.player.bars.xp.cur} max={s.player.bars.xp.max} tone="var(--success)" />);
    else if (s.trackers[id]) {
      const t = s.trackers[id];
      const sev = trackerState(t).severity;
      out.push(<Mini key={id} label={t.label} value={t.value} max={t.max} tone={sev >= 2 ? 'var(--warning)' : 'var(--text-2)'} />);
    } else if (id === 'status' && Object.keys(s.player.status).length)
      out.push(
        <span key={id} className="truncate text-xs text-fg-2">
          {Object.values(s.player.status)
            .map((x) => x.name)
            .join(', ')}
        </span>,
      );
  }
  return <>{out}</>;
}

/** What the status bar can show, in the order offered. */
export { HUD_OPTIONS } from './hud-options';

/** Thin, tappable HUD strip. Tap opens the full status sheet. On desktop it can float instead. */
export function Hud() {
  const { state, open, chat } = useGame();
  const settings = useSettings();
  const hudFloat = useViewPrefs((v) => v.hudFloat);
  const desktop = useMedia('(min-width: 1024px) and (pointer: fine)');
  const mapOn = useFeatureOn('map');
  // Hold the strip's space while the campaign loads so the story doesn't jump down.
  if (!state) return chat.campaignId ? <div className="h-11 flex-none hairline-b" aria-hidden="true" /> : null;
  const pinned = settings.data?.hud.pinned ?? ['time', 'weather', 'location', 'hp', 'hunger', 'energy'];
  if (desktop && hudFloat) return <FloatingHud at={hudFloat} onOpen={() => open('status')} items={<HudItems s={state} pinned={pinned} />} />;
  // The place is its own button (it opens the map); the rest opens the status sheet.
  const loc = pinned.includes('location') && mapOn && state.currentLocationId ? state.locations[state.currentLocationId] : null;
  return (
    <div className="ev-hud no-scrollbar flex h-11 w-full flex-none items-center overflow-x-auto hairline-b">
      {loc ? (
        <button onClick={() => open('map')} aria-label={`${loc.name}: open the map`} className="pressable flex h-full max-w-[150px] flex-none items-center gap-1 pl-4 pr-2 text-xs text-fg-2">
          <Icon icon={MapPin} size={14} className="flex-none" />
          <span className="truncate">{loc.name}</span>
        </button>
      ) : null}
      <button onClick={() => open('status')} className={cx('pressable flex h-full min-w-0 flex-1 items-center gap-4 py-2 pr-4 text-left [&>*]:flex-none', loc ? 'pl-2' : 'pl-4')}>
        <span className="sr-only">Status:</span>
        <HudItems s={state} pinned={loc ? pinned.filter((x) => x !== 'location') : pinned} />
      </button>
    </div>
  );
}

const EDGE = 24;

/** The status bar as a small pill: drag it by the grip, it snaps to nearby edges; Dock puts it back. */
function FloatingHud({ at, onOpen, items }: { at: { x: number; y: number }; onOpen: () => void; items: ReactNode }) {
  const set = useViewPrefs((v) => v.set);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  const drag = useRef<{ sx: number; sy: number; start: { x: number; y: number } } | null>(null);
  const clamp = (p: { x: number; y: number }) => {
    const w = box.current?.offsetWidth ?? 320;
    const h = box.current?.offsetHeight ?? 44;
    const maxX = window.innerWidth - w - 8;
    const maxY = window.innerHeight - h - 8;
    let x = Math.max(8, Math.min(p.x, maxX));
    let y = Math.max(8, Math.min(p.y, maxY));
    // Snap to an edge when close to it.
    if (x - 8 < EDGE) x = 8;
    if (maxX - x < EDGE) x = maxX;
    if (y - 8 < EDGE) y = 8;
    if (maxY - y < EDGE) y = maxY;
    return { x: Math.round(x), y: Math.round(y) };
  };
  useEffect(() => {
    setPos((p) => clamp(p));
    const onResize = () => setPos((p) => clamp(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (p: { x: number; y: number }) => set({ hudFloat: p });
  return (
    <div ref={box} data-testid="floating-hud" className="ev-hud fixed z-30 flex max-w-[min(720px,calc(100vw-16px))] items-center rounded-full border border-line bg-surface/95 shadow-2 backdrop-blur" style={{ left: pos.x, top: pos.y }}>
      <span
        className="flex h-11 cursor-grab touch-none items-center pl-2.5 pr-1 text-fg-3 outline-none active:cursor-grabbing"
        tabIndex={0}
        role="button"
        aria-label="Move the status bar (drag, or use the arrow keys)"
        data-testid="hud-handle"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { sx: e.clientX, sy: e.clientY, start: pos };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setPos(clamp({ x: d.start.x + e.clientX - d.sx, y: d.start.y + e.clientY - d.sy }));
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          drag.current = null;
          save(pos);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 40 : 10;
          const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          const dxy = delta[e.key];
          if (!dxy) return;
          e.preventDefault();
          const next = clamp({ x: pos.x + dxy[0], y: pos.y + dxy[1] });
          setPos(next);
          save(next);
        }}
      >
        <GripVertical size={16} />
      </span>
      <button onClick={onOpen} className="pressable no-scrollbar flex h-11 min-w-0 items-center gap-4 overflow-x-auto pr-2 text-left [&>*]:flex-none">
        <span className="sr-only">Status:</span>
        {items}
      </button>
      <IconButton size="sm" icon={PanelTop} label="Dock the status bar" className="mr-1.5" onClick={() => set({ hudFloat: null })} />
    </div>
  );
}
