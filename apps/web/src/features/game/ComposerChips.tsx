import type { CampaignDTO } from '@everloom/engine';
import * as P from '@radix-ui/react-popover';
import { AtSign, Smile, Wand2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { post } from '@/lib/api';
import { cx } from '@/lib/format';
import { t } from '@/lib/motion';
import { toastError } from '@/lib/store';
import { Icon } from '@/ui';

const EMOTES = ['smiles', 'laughs', 'nods', 'shrugs', 'sighs', 'frowns', 'blushes', 'winks', 'looks away', 'crosses arms', 'leans in', 'waves'];

function Chip({ icon, label, active, onClick }: { icon: typeof AtSign; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cx('pressable flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-xs font-medium', active ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-fg-2 hover:text-fg')}>
      <Icon icon={icon} size={14} />
      {label}
    </button>
  );
}

export function ComposerChips({ campaign, target, setTarget, composer, setComposer, chatId, busy }: { campaign: CampaignDTO | null; target: string | null; setTarget: (t: string | null) => void; composer: string; setComposer: (v: string) => void; chatId: string; busy: boolean }) {
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const s = campaign?.state;
  const nearby = s ? Object.values(s.npcs).filter((n) => n.status === 'alive' && n.locationId && n.locationId === s.currentLocationId).map((n) => n.name) : [];
  const party = s ? Object.values(s.party).map((m) => m.name) : [];
  const people = [...new Set([...nearby, ...party])];
  const suggest = async () => {
    setLoading(true);
    try {
      const r = await post<{ actions: string[] }>(`/api/chats/${chatId}/suggest`);
      setSuggestions(r.actions);
    } catch (e) {
      toastError(e);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="mb-2">
      <AnimatePresence>
        {suggestions?.length ? (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={t.base} className="mb-2 flex flex-col gap-1.5">
            {suggestions.map((a, i) => (
              <button
                key={i}
                onClick={() => {
                  setComposer(a);
                  setSuggestions(null);
                }}
                className="pressable rounded-md bg-surface-2 px-3 py-2 text-left text-sm text-fg hover:bg-surface-3"
              >
                {a}
              </button>
            ))}
            <button onClick={() => setSuggestions(null)} className="self-end px-2 text-xs text-fg-3">
              Dismiss
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
        <P.Root>
          <P.Trigger asChild>
            <button type="button" className={cx('pressable flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-xs font-medium', target ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-fg-2 hover:text-fg')}>
              <Icon icon={AtSign} size={14} />
              {target ?? 'Everyone'}
            </button>
          </P.Trigger>
          <P.Portal>
            <P.Content side="top" align="start" sideOffset={8} className="z-[70] max-h-[50vh] min-w-[200px] overflow-y-auto rounded-md bg-surface p-1 shadow-3 dark:bg-surface-2">
              <P.Close asChild>
                <button className="flex min-h-10 w-full items-center rounded-sm px-3 text-left text-sm hover:bg-surface-2" onClick={() => setTarget(null)}>
                  Everyone
                </button>
              </P.Close>
              {people.map((p) => (
                <P.Close asChild key={p}>
                  <button className="flex min-h-10 w-full items-center rounded-sm px-3 text-left text-sm hover:bg-surface-2" onClick={() => setTarget(p)}>
                    {p}
                  </button>
                </P.Close>
              ))}
              {!people.length ? <p className="px-3 py-2 text-xs text-fg-2">Nobody else is here right now.</p> : null}
            </P.Content>
          </P.Portal>
        </P.Root>
        {target ? <button aria-label="Clear target" onClick={() => setTarget(null)} className="-ml-1 flex h-8 w-6 flex-none items-center justify-center text-fg-3"><Icon icon={X} size={14} /></button> : null}
        <P.Root>
          <P.Trigger asChild>
            <button type="button" className="pressable flex h-8 flex-none items-center gap-1.5 rounded-full bg-surface-2 px-3 text-xs font-medium text-fg-2 hover:text-fg">
              <Icon icon={Smile} size={14} />
              Emote
            </button>
          </P.Trigger>
          <P.Portal>
            <P.Content side="top" align="start" sideOffset={8} className="z-[70] grid w-[260px] grid-cols-2 gap-0.5 rounded-md bg-surface p-1 shadow-3 dark:bg-surface-2">
              {EMOTES.map((e) => (
                <P.Close asChild key={e}>
                  <button className="min-h-9 rounded-sm px-2.5 text-left text-sm hover:bg-surface-2" onClick={() => setComposer(`${composer}${composer && !composer.endsWith(' ') ? ' ' : ''}*${e}* `)}>
                    {e}
                  </button>
                </P.Close>
              ))}
            </P.Content>
          </P.Portal>
        </P.Root>
        <Chip icon={Wand2} label={loading ? 'Thinking…' : 'Suggest'} onClick={() => !busy && !loading && void suggest()} />
      </div>
    </div>
  );
}
