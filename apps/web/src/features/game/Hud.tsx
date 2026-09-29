import { formatClock, formatDate, trackerState, type CampaignState } from '@everloom/engine';
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, Coins, MapPin, Sun, SunDim, Thermometer, Wind } from 'lucide-react';
import { motion } from 'motion/react';
import { useSettings } from '@/lib/queries';
import { cx } from '@/lib/format';
import { Icon } from '@/ui';
import { useGame } from './context';

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

/** Thin, tappable HUD strip. Tap opens the full status sheet. */
export function Hud() {
  const { state, open } = useGame();
  const settings = useSettings();
  if (!state) return null;
  const pinned = settings.data?.hud.pinned ?? ['time', 'weather', 'location', 'hp', 'hunger', 'energy'];
  return (
    <button onClick={() => open('status')} aria-label="Status" className={cx('pressable no-scrollbar flex w-full flex-none items-center gap-4 overflow-x-auto px-4 py-2 hairline-b text-left [&>*]:flex-none')}>
      <HudItems s={state} pinned={pinned} />
    </button>
  );
}
