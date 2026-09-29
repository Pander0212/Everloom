import type { Op } from '@everloom/engine';
import { ACTIVITY_RATES } from '@everloom/engine';
import { Bath, BedDouble, BookOpen, Briefcase, ChefHat, Compass, Dumbbell, Minus, Plus, Sofa, TimerReset, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { cx } from '@/lib/format';
import { Button, Icon, IconButton, ToggleRow } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

type Kind = 'sleep' | 'nap' | 'rest' | 'work' | 'train' | 'study' | 'explore' | 'cook' | 'bathe';

const META: Record<Kind, { label: string; icon: LucideIcon; verb: string }> = {
  sleep: { label: 'Sleep', icon: BedDouble, verb: 'sleep' },
  nap: { label: 'Nap', icon: TimerReset, verb: 'take a nap' },
  rest: { label: 'Rest', icon: Sofa, verb: 'rest' },
  work: { label: 'Work', icon: Briefcase, verb: 'work' },
  train: { label: 'Train', icon: Dumbbell, verb: 'train' },
  study: { label: 'Study', icon: BookOpen, verb: 'study' },
  explore: { label: 'Explore', icon: Compass, verb: 'explore the area' },
  cook: { label: 'Cook', icon: ChefHat, verb: 'cook a meal' },
  bathe: { label: 'Bathe', icon: Bath, verb: 'wash up' },
};

function effectsLine(kind: Kind, hours: number, labelFor: (id: string) => string | null, currency: string): string {
  const spec = ACTIVITY_RATES[kind];
  const bits: string[] = [];
  for (const [id, v] of Object.entries(spec.perHour)) {
    const label = labelFor(id);
    if (label && v) bits.push(`${label} ${v > 0 ? '+' : '−'}${Math.min(100, Math.round(Math.abs(v * hours)))}`);
  }
  for (const [id, v] of Object.entries(spec.bars ?? {})) if (v) bits.push(`${id.toUpperCase()} +${Math.round(v * hours)}`);
  if (spec.xpPerHour) bits.push(`XP +${Math.round(spec.xpPerHour * hours)}`);
  if (spec.payPerHour) bits.push(`${currency} +${Math.round(spec.payPerHour * hours)}`);
  if (kind === 'cook') bits.push(`${currency} −3`, 'a meal');
  return bits.join(' · ');
}

export default function Activities() {
  const { state: s, apply, run, close, busy } = useGame();
  const [kind, setKind] = useState<Kind>('rest');
  const [hours, setHours] = useState(ACTIVITY_RATES.rest.hours);
  const [narrate, setNarrate] = useState(true);
  const [going, setGoing] = useState(false);
  if (!s) return <ToolSheet title="Activities"><NoCampaign /></ToolSheet>;
  const labelFor = (id: string) => s.trackers[id]?.label ?? null;
  const pick = (k: Kind) => {
    setKind(k);
    setHours(ACTIVITY_RATES[k].hours);
  };
  const step = hours < 1 ? 0.25 : hours < 4 ? 0.5 : 1;
  const fixed = kind === 'cook' || kind === 'bathe';
  const fmt = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h} h`);

  return (
    <ToolSheet
      title="Activities"
      description="Spend time doing something. Needs and time update right away."
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          loading={going}
          disabled={busy && narrate}
          onClick={async () => {
            setGoing(true);
            const r = await apply({ type: 'activity', kind, hours: fixed ? undefined : hours } as Op);
            setGoing(false);
            if (!r) return;
            close();
            if (narrate) void run('normal', `*I ${META[kind].verb}${fixed ? '' : ` for ${fmt(hours)}`}.*`);
          }}
        >
          {META[kind].label}
          {fixed ? '' : ` for ${fmt(hours)}`}
        </Button>
      }
    >
      <div role="radiogroup" aria-label="Activity" className="grid grid-cols-3 gap-2">
        {(Object.keys(META) as Kind[]).map((k) => (
          <button
            key={k}
            role="radio"
            aria-checked={kind === k}
            onClick={() => pick(k)}
            className={cx('pressable flex h-20 flex-col items-center justify-center gap-1.5 rounded-md border text-sm', kind === k ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-2 hover:bg-surface-2')}
          >
            <Icon icon={META[k].icon} size={22} />
            {META[k].label}
          </button>
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-4">
        {!fixed ? (
          <div className="flex items-center gap-3">
            <span className="flex-1 text-sm font-medium">How long</span>
            <IconButton icon={Minus} label="Less time" disabled={hours <= 0.25} onClick={() => setHours(Math.max(0.25, hours - step))} />
            <span className="w-16 text-center text-sm tabular-nums">{fmt(hours)}</span>
            <IconButton icon={Plus} label="More time" disabled={hours >= 24} onClick={() => setHours(Math.min(24, hours + (hours < 1 ? 0.25 : hours < 4 ? 0.5 : 1)))} />
          </div>
        ) : null}
        <p className="rounded-md bg-surface-2 px-3 py-2.5 text-sm text-fg-2">{effectsLine(kind, fixed ? ACTIVITY_RATES[kind].hours : hours, labelFor, s.meta.currency.name) || 'Time passes.'}</p>
        <ToggleRow label="Write it into the story" description="Sends a short line so the model narrates it." checked={narrate} onChange={setNarrate} />
      </div>
    </ToolSheet>
  );
}
