/** The stage's emote picker: pick who (in a group) and what they do. Recorded like any story change. */
import { BUILTIN_EMOTES, bodyFromMapping, EMOTE_CATEGORIES, emotesForBody, installedEmotes, isPoseEmote, type EmoteCategory, type EmoteInfo, type Op } from '@everloom/engine';
import { useQueries } from '@tanstack/react-query';
import { Smile } from 'lucide-react';
import { useState } from 'react';
import { useGame } from '@/features/game/context';
import { cx } from '@/lib/format';
import { IconButton, Popover } from '@/ui';
import { avatarKeys, useAvatarClips, useAvatarPaired, type AvatarDetail } from './api';
import { get } from '@/lib/api';

const CATEGORY_LABEL: Record<EmoteCategory, string> = { idle: 'Stand', talk: 'Talk', emotion: 'Feelings', social: 'Social', state: 'Poses', dance: 'Dance', battle: 'Battle' };

export function EmotePicker({ cast, className }: { cast: Array<{ id: string; name: string; avatarId?: string | null }>; className?: string }) {
  const { apply } = useGame();
  const clips = useAvatarClips();
  const paired = useAvatarPaired(cast.length > 1);
  const [who, setWho] = useState<string | null>(null);
  // In a group, "Everyone" makes the whole cast do it (a group dance stays in step).
  const target = who === '*' ? { id: '*', name: 'everyone' } : (cast.find((c) => c.id === who) ?? cast[0]);
  const all = installedEmotes((clips.data ?? []).map((c) => ({ id: c.id, label: c.label, category: c.category })));
  // Each character's body decides what it can do: a pony has no dance clips but wags its tail
  // (docs/3d-import/creatures.md); its own clips appear by name.
  const details = useQueries({ queries: cast.map((c) => ({ queryKey: avatarKeys.one(c.avatarId ?? ''), queryFn: () => get<AvatarDetail>(`/api/avatars/${c.avatarId}`), enabled: !!c.avatarId, staleTime: 60_000 })) });
  const fitsFor = (id: string): EmoteInfo[] => {
    const i = cast.findIndex((c) => c.id === id);
    const d = details[i]?.data;
    if (!d) return emotesForBody(all, bodyFromMapping(null, { hips: 'x', spine: 'x', head: 'x', leftUpperArm: 'x', rightUpperArm: 'x', leftUpperLeg: 'x', rightUpperLeg: 'x' }));
    return emotesForBody(all, bodyFromMapping(d.config.rig ?? (d.info as { rig?: { family?: string; roles?: Array<{ role: string }> } }).rig, d.config.boneMap, d.info.animations ?? []));
  };
  // Everyone: what all of them can do (own clips are each one's own, so not shared).
  const emotes = target?.id === '*' ? cast.map((c) => fitsFor(c.id)).reduce((a, b) => a.filter((x) => x.body !== 'own' && b.some((y) => y.id === x.id))) : target ? fitsFor(target.id) : [];
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
          const list = emotes.filter((e) => e.category === cat && e.body !== 'own' && e.id !== 'walk_in' && e.id !== 'walk_out');
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
        {emotes.some((e) => e.body === 'own') ? (
          <section data-testid="emote-own">
            <h3 className="px-1 pb-1 text-xs font-semibold text-fg-2">From its file</h3>
            <div className="grid grid-cols-3 gap-1">
              {emotes.filter((e) => e.body === 'own').map((e) => (
                <button key={e.id} onClick={() => play(e.id)} className="pressable min-h-10 truncate rounded-md bg-surface-2 px-2 py-1.5 text-left text-sm hover:bg-surface-3" title={e.label}>
                  {e.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}
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
