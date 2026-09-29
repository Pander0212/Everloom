import { formatClock, formatDate, formatDuration, partOfDay, trackerState } from '@everloom/engine';
import { Clock, Coins, MapPin, Moon, Sunrise } from 'lucide-react';
import { Badge, Button, Icon, StatBar } from '@/ui';
import { useGame } from '../context';
import { WEATHER_ICON } from '../Hud';
import { NoCampaign, ToolSheet } from './ToolSheet';

export default function Status() {
  const { state: s, apply, open } = useGame();
  if (!s) return <ToolSheet title="Status"><NoCampaign /></ToolSheet>;
  const cal = s.meta.calendar;
  const loc = s.currentLocationId ? s.locations[s.currentLocationId] : null;
  const bars = Object.values(s.player.bars).filter((b) => b.id !== 'xp');
  return (
    <ToolSheet title={s.player.name} description={[s.player.className, `Level ${s.player.level}`].filter(Boolean).join(' · ')}>
      <div className="flex flex-col gap-6">
        <section className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Icon icon={Clock} size={18} className="text-fg-3" />
            <span>
              <span className="block font-medium tabular-nums">{formatClock(s.time.minutes, cal)}</span>
              <span className="block text-xs text-fg-2">{formatDate(s.time.minutes, cal)}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Icon icon={WEATHER_ICON[s.weather.kind]} size={18} className="text-fg-3" />
            <span>
              <span className="block font-medium capitalize">{s.weather.kind}</span>
              <span className="block text-xs text-fg-2">
                {s.weather.tempC}°C · {partOfDay(s.time.minutes)}
              </span>
            </span>
          </div>
          <button className="pressable -m-1 flex items-center gap-2 rounded-md p-1 text-left hover:bg-surface-2" onClick={() => open('map')}>
            <Icon icon={MapPin} size={18} className="text-fg-3" />
            <span className="min-w-0">
              <span className="block truncate font-medium">{loc?.name ?? 'Somewhere'}</span>
              <span className="block truncate text-xs text-fg-2">{loc?.parentId ? s.locations[loc.parentId]?.name : 'Open map'}</span>
            </span>
          </button>
          <div className="flex items-center gap-2">
            <Icon icon={Coins} size={18} className="text-fg-3" />
            <span>
              <span className="block font-medium tabular-nums">{s.player.currency}</span>
              <span className="block text-xs text-fg-2">{s.meta.currency.name}</span>
            </span>
          </div>
        </section>
        <section className="flex flex-col gap-4">
          {bars.map((b) => (
            <StatBar key={b.id} label={b.label} value={b.cur} max={b.max} tone={b.id === 'hp' ? 'danger' : 'accent'} />
          ))}
          {s.player.bars.xp ? <StatBar label={`Experience · level ${s.player.level}`} value={s.player.bars.xp.cur} max={s.player.bars.xp.max} tone="success" /> : null}
        </section>
        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-semibold text-fg-2">Needs</h3>
          {Object.values(s.trackers).map((t) => {
            const st = trackerState(t);
            return (
              <div key={t.id}>
                <StatBar label={`${t.label} · ${st.label}`} value={t.value} max={t.max} tone={st.severity >= 2 ? 'warning' : 'neutral'} />
              </div>
            );
          })}
        </section>
        {Object.keys(s.player.status).length ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-fg-2">Status effects</h3>
            <div className="flex flex-wrap gap-2">
              {Object.values(s.player.status).map((st) => (
                <Badge key={st.id} tone={st.kind === 'buff' ? 'success' : st.kind === 'debuff' ? 'danger' : 'neutral'}>
                  {st.name}
                  {st.expiresAt ? ` · ${formatDuration(st.expiresAt - s.time.minutes)}` : ''}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}
        <section>
          <h3 className="mb-2 text-sm font-semibold text-fg-2">Let time pass</h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => apply({ type: 'time.advance', minutes: 15 } as any)}>
              15 min
            </Button>
            <Button size="sm" onClick={() => apply({ type: 'time.advance', minutes: 60 } as any)}>
              1 hour
            </Button>
            <Button size="sm" icon={Sunrise} onClick={() => apply({ type: 'time.until', hour: 7, minute: 0 } as any)}>
              Until morning
            </Button>
            <Button size="sm" icon={Moon} onClick={() => apply({ type: 'time.until', hour: 20, minute: 0 } as any)}>
              Until evening
            </Button>
          </div>
        </section>
        <section className="grid grid-cols-4 gap-2 text-center text-xs text-fg-2">
          {(['atk', 'def', 'spd', 'mag'] as const).map((k) => (
            <div key={k} className="rounded-md bg-surface-2 py-2">
              <span className="block text-base font-semibold tabular-nums text-fg">{s.player.stats[k]}</span>
              {k.toUpperCase()}
            </div>
          ))}
        </section>
      </div>
    </ToolSheet>
  );
}
