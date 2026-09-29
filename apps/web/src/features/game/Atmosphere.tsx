import { partOfDay, type CampaignState } from '@everloom/engine';
import { memo, useMemo } from 'react';
import { useSettings } from '@/lib/queries';

const TINT: Record<string, string> = {
  night: 'rgb(10 18 40 / 0.45)',
  dawn: 'rgb(255 170 120 / 0.14)',
  morning: 'rgb(255 240 210 / 0.05)',
  afternoon: 'rgb(0 0 0 / 0)',
  evening: 'rgb(255 150 80 / 0.14)',
  dusk: 'rgb(90 60 120 / 0.2)',
};

/** GPU-cheap weather + time-of-day overlay: a tint layer and a few transform-only particles. */
export const Atmosphere = memo(function Atmosphere({ state }: { state: CampaignState | null }) {
  const settings = useSettings();
  const enabled = settings.data?.atmosphere.enabled !== false;
  const particles = settings.data?.atmosphere.particles !== false;
  const kind = state?.weather.kind ?? 'clear';
  const pod = state ? partOfDay(state.time.minutes) : 'afternoon';
  const drops = useMemo(() => {
    const n = kind === 'storm' ? 70 : kind === 'rain' ? 45 : kind === 'snow' ? 40 : 0;
    return Array.from({ length: n }, (_, i) => ({ left: (i * 37.3) % 100, delay: (i * 0.173) % 2, dur: kind === 'snow' ? 6 + ((i * 0.7) % 4) : 0.7 + ((i * 0.13) % 0.5), size: kind === 'snow' ? 2 + (i % 3) : 1 }));
  }, [kind]);
  if (!enabled || !state) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 transition-colors duration-1000" style={{ background: TINT[pod] }} />
      {kind === 'fog' || kind === 'overcast' ? <div className="absolute inset-0" style={{ background: kind === 'fog' ? 'rgb(200 205 210 / 0.22)' : 'rgb(120 125 130 / 0.12)' }} /> : null}
      {particles && drops.length ? (
        <div className="atmo-layer absolute inset-0">
          {drops.map((d, i) => (
            <span
              key={i}
              className={kind === 'snow' ? 'atmo-snow' : 'atmo-rain'}
              style={{ left: `${d.left}%`, animationDelay: `-${d.delay}s`, animationDuration: `${d.dur}s`, width: kind === 'snow' ? d.size * 2 : 1, height: kind === 'snow' ? d.size * 2 : 18 }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
});
