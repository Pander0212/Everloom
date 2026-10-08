/** The stage's emote picker: pick who (in a group) and what they do. Recorded like any story change. */
import { BUILTIN_EMOTES, EMOTE_CATEGORIES, installedEmotes, isPoseEmote, type EmoteCategory, type Op } from '@everloom/engine';
import { Smile } from 'lucide-react';
import { useState } from 'react';
import { useGame } from '@/features/game/context';
import { cx } from '@/lib/format';
import { IconButton, Popover } from '@/ui';
import { useAvatarClips, useAvatarPaired } from './api';

const CATEGORY_LABEL: Record<EmoteCategory, string> = { idle: 'Stand', talk: 'Talk', emotion: 'Feelings', social: 'Social', state: 'Poses', dance: 'Dance', battle: 'Battle' };

export function EmotePicker({ cast, className }: { cast: Array<{ id: string; name: string }>; className?: string }) {
  const { apply } = useGame();
  const clips = useAvatarClips();
  const paired = useAvatarPaired(cast.length > 1);
  const [who, setWho] = useState<string | null>(null);
  // In a group, "Everyone" makes the whole cast do it (a group dance stays in step).
  const target = who === '*' ? { id: '*', name: 'everyone' } : (cast.find((c) => c.id === who) ?? cast[0]);
  const emotes = installedEmotes((clips.data ?? []).map((c) => ({ id: c.id, label: c.label, category: c.category })));
  if (!target) return null;
  const play = (id: string) => {
    const e = emotes.find((x) => x.id === id)!;
    const op = (isPoseEmote(e) ? { type: 'avatar.pose', who: target.name, pose: id === 'idle' ? null : id } : { type: 'avatar.emote', who: target.name, emote: id }) as Op;
    void apply(op, { quiet: true });
  };
  // Paired animations: the picked character and the next ones in the cast, in that order.
  const together = (paired.data ?? []).filter((p) => p.participants <= cast.length);
  const playTogether = (clip: string | null, n: number) => {
    const order = target.id === '*' ? cast : [cast.find((c) => c.id === target.id)!, ...cast.filter((c) => c.id !== target.id)];
    void apply({ type: 'avatar.paired', clip, who: order.slice(0, Math.max(2, n)).map((c) => c.name) } as Op, { quiet: true });
  };
  return (
    <Popover trigger={<IconButton icon={Smile} label="Emotes" className={cx('!bg-surface/90 shadow-1', className)} />} side="bottom" align="end">
      <div className="flex max-h-[60dvh] w-72 flex-col gap-2 overflow-y-auto p-1" data-testid="emote-picker">
        {cast.length > 1 ? (
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Who">
            {[...cast, { id: '*', name: 'Everyone' }].map((c) => (
              <button key={c.id} role="radio" aria-checked={c.id === target.id} onClick={() => setWho(c.id)} className={cx('pressable rounded-full px-3 py-1 text-xs', c.id === target.id ? 'bg-accent text-accent-fg' : 'bg-surface-2')}>
                {c.name}
              </button>
            ))}
          </div>
        ) : null}
        {EMOTE_CATEGORIES.filter((cat) => cat !== 'talk').map((cat) => {
          const list = emotes.filter((e) => e.category === cat && e.id !== 'walk_in' && e.id !== 'walk_out');
          if (!list.length) return null;
          return (
            <section key={cat}>
              <h3 className="px-1 pb-1 text-xs font-semibold text-fg-2">{CATEGORY_LABEL[cat]}</h3>
              <div className="grid grid-cols-3 gap-1">
                {list.map((e) => (
                  <button key={e.id} onClick={() => play(e.id)} className="pressable min-h-10 rounded-md bg-surface-2 px-2 py-1.5 text-left text-sm hover:bg-surface-3">
                    {e.label}
                    {e.source === 'imported' ? <span className="sr-only"> (imported)</span> : null}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {together.length ? (
          <section data-testid="emote-together">
            <h3 className="px-1 pb-1 text-xs font-semibold text-fg-2">Together{target.id === '*' ? '' : ` (${[target, ...cast.filter((c) => c.id !== target.id)].slice(0, 2).map((c) => c.name).join(' & ')})`}</h3>
            <div className="grid grid-cols-3 gap-1">
              {together.map((p) => (
                <button key={p.id} onClick={() => playTogether(p.id, p.participants)} className="pressable min-h-10 rounded-md bg-surface-2 px-2 py-1.5 text-left text-sm hover:bg-surface-3">
                  {p.label}
                </button>
              ))}
              <button onClick={() => playTogether(null, 2)} className="pressable min-h-10 rounded-md bg-surface-2 px-2 py-1.5 text-left text-sm text-fg-2 hover:bg-surface-3">Stop</button>
            </div>
          </section>
        ) : null}
        <p className="px-1 text-xs text-fg-3">{BUILTIN_EMOTES.length} built in. Import more in Settings → 3D characters.</p>
      </div>
    </Popover>
  );
}
