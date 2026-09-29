import type { Op, WeatherKind } from '@everloom/engine';
import { WEATHER_KINDS } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageOff, ImagePlus, Sparkles } from 'lucide-react';
import { get, patch, upload } from '@/lib/api';
import { cx } from '@/lib/format';
import { useImageGen } from '@/lib/imagegen';
import { qk, useSettings } from '@/lib/queries';
import { toastError } from '@/lib/store';
import { Button, FileButton, Icon, ToggleRow } from '@/ui';
import { useGame } from '../context';
import { WEATHER_ICON } from '../Hud';
import { ToolSheet } from './ToolSheet';

interface MediaItem {
  id: string;
  url: string;
  kind: string;
}

export default function AtmosphereTool() {
  const { chat, state: s, apply } = useGame();
  const qc = useQueryClient();
  const settings = useSettings();
  const gen = useImageGen();
  const backgrounds = useQuery({ queryKey: ['media', 'background'], queryFn: () => get<MediaItem[]>('/api/media', { kind: 'background' }) });
  const current = chat.metadata.background ?? null;

  const setBackground = async (id: string | null) => {
    try {
      const c = await patch(`/api/chats/${chat.id}`, { metadata: { background: id } });
      qc.setQueryData(qk.chat(chat.id), (x: any) => ({ ...x, ...c }));
    } catch (e) {
      toastError(e);
    }
  };
  const setAtmo = async (p: Partial<{ enabled: boolean; particles: boolean }>) => {
    try {
      await patch('/api/settings', { atmosphere: { ...settings.data?.atmosphere, ...p } });
      await qc.invalidateQueries({ queryKey: qk.settings });
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <ToolSheet title="Atmosphere" description="Scene background, weather and effects">
      <div className="flex flex-col gap-6">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Background</h3>
          <div className="relative mb-3 aspect-video overflow-hidden rounded-md bg-surface-2">
            {current ? <img src={`/media/${current}`} alt="Current background" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-fg-3">No background</div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={Sparkles}
              loading={gen.busy === 'background'}
              onClick={async () => {
                const r = await gen.run({ kind: 'background', chatId: chat.id, apply: true });
                if (r) {
                  qc.setQueryData(qk.chat(chat.id), (x: any) => ({ ...x, metadata: { ...x.metadata, background: r.id } }));
                  await qc.invalidateQueries({ queryKey: ['media', 'background'] });
                }
              }}
            >
              Paint this scene
            </Button>
            <FileButton
              variant="secondary"
              icon={ImagePlus}
              accept="image/png,image/jpeg,image/webp,image/gif"
              onFiles={async (files) => {
                try {
                  const r = await upload<{ id: string }>('/api/media', files[0], { kind: 'background' });
                  await setBackground(r.id);
                  await qc.invalidateQueries({ queryKey: ['media', 'background'] });
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              Upload
            </FileButton>
            {current ? (
              <Button variant="ghost" icon={ImageOff} onClick={() => setBackground(null)}>
                Clear
              </Button>
            ) : null}
          </div>
          {backgrounds.data?.length ? (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {backgrounds.data.slice(0, 24).map((m) => (
                <button key={m.id} onClick={() => setBackground(m.id)} aria-label="Use this background" aria-pressed={current === m.id} className={cx('pressable aspect-video overflow-hidden rounded-md border-2', current === m.id ? 'border-accent' : 'border-transparent')}>
                  <img src={m.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </section>

        {s ? (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Weather</h3>
            <div role="radiogroup" aria-label="Weather" className="grid grid-cols-3 gap-2">
              {WEATHER_KINDS.map((w) => (
                <button
                  key={w}
                  role="radio"
                  aria-checked={s.weather.kind === w}
                  onClick={() => s.weather.kind !== w && apply({ type: 'weather.set', kind: w as WeatherKind } as Op)}
                  className={cx('pressable flex h-16 flex-col items-center justify-center gap-1 rounded-md border text-xs capitalize', s.weather.kind === w ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-2 hover:bg-surface-2')}
                >
                  <Icon icon={WEATHER_ICON[w as WeatherKind]} size={20} />
                  {w}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-fg-3">Weather also changes on its own every few hours of game time.</p>
          </section>
        ) : null}

        <section className="flex flex-col gap-1">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">Effects</h3>
          <ToggleRow label="Time-of-day tint" description="Warm dawns, blue nights." checked={settings.data?.atmosphere.enabled !== false} onChange={(v) => setAtmo({ enabled: v })} />
          <ToggleRow label="Rain and snow particles" description="Off when your device asks for reduced motion." checked={settings.data?.atmosphere.particles !== false} onChange={(v) => setAtmo({ particles: v })} />
        </section>
      </div>
    </ToolSheet>
  );
}
