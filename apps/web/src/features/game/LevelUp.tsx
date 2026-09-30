import { newlyAvailable, type CampaignState, type Who } from '@everloom/engine';
import { Sparkles } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '@/ui';
import { useGame } from './context';

interface Moment {
  who: string;
  memberId: string | null;
  from: number;
  to: number;
}

const levels = (s: CampaignState) => ({ player: s.player.level, ...Object.fromEntries(Object.values(s.party).map((m) => [m.id, m.level])) }) as Record<string, number>;

/** The level-up moment: when anyone's level goes up (never on undo or first load), celebrate once. */
export function LevelUpMoment() {
  const { state: s, campaign, open } = useGame();
  const reduce = useReducedMotion();
  const prev = useRef<{ id: string | null; levels: Record<string, number> } | null>(null);
  const [queue, setQueue] = useState<Moment[]>([]);
  useEffect(() => {
    if (!s) return;
    const now = levels(s);
    const was = prev.current;
    prev.current = { id: campaign?.id ?? null, levels: now };
    if (!was || was.id !== (campaign?.id ?? null)) return;
    const ups: Moment[] = [];
    for (const [id, lvl] of Object.entries(now)) {
      const before = was.levels[id];
      if (before !== undefined && lvl > before) ups.push({ who: id === 'player' ? s.player.name || 'You' : (s.party[id]?.name ?? id), memberId: id === 'player' ? null : id, from: before, to: lvl });
    }
    if (ups.length) setQueue((q) => [...q, ...ups]);
  }, [s, campaign?.id]);
  const cur = queue[0];
  if (!s || !cur) return null;
  const m = cur.memberId ? s.party[cur.memberId] : null;
  const who: Who | null = cur.memberId ? (m ? { kind: 'member', m } : null) : { kind: 'player' };
  const fresh = who ? newlyAvailable(s, who) : [];
  const pts = cur.memberId ? (m?.statPoints ?? 0) : (s.player.statPoints ?? 0);
  const skillPts = cur.memberId ? (m?.skillPoints ?? 0) : (s.player.skillPoints ?? 0);
  const dismiss = () => setQueue((q) => q.slice(1));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && dismiss()}
      title={`${cur.who} reached level ${cur.to}`}
      footer={
        <>
          <Button variant="quiet" onClick={dismiss}>
            Later
          </Button>
          {pts || skillPts ? (
            <Button
              variant="primary"
              onClick={() => {
                dismiss();
                open('party', cur.memberId ?? 'player');
              }}
            >
              Spend points
            </Button>
          ) : null}
        </>
      }
    >
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <motion.span
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-2xl font-semibold tabular-nums text-accent-text"
          aria-hidden="true"
        >
          {cur.to}
        </motion.span>
        <p className="text-sm text-fg-2">
          {[pts ? `${pts} stat point${pts === 1 ? '' : 's'}` : null, skillPts ? `${skillPts} skill point${skillPts === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ') || 'Stronger than before.'}
          {pts || skillPts ? ' to spend.' : ''}
        </p>
        {fresh.length ? (
          <p className="text-sm">
            <Sparkles size={14} className="mr-1 inline text-accent" aria-hidden="true" />
            New to learn: {fresh.map((n) => n.name).join(', ')}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
