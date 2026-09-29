import type { Battle as BattleT, Combatant, Op } from '@everloom/engine';
import { currentActor } from '@everloom/engine';
import { Footprints, Plus, Shield, Sparkles, Swords, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/lib/format';
import { t } from '@/lib/motion';
import { Badge, Button, EmptyState, IconButton, Input, Select, StatBar } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

interface EnemyRow {
  name: string;
  level: number;
  count: number;
}

export default function Battle() {
  const { state: s } = useGame();
  if (!s) return <ToolSheet title="Battle"><NoCampaign /></ToolSheet>;
  return s.battle ? <Fight battle={s.battle} /> : <Setup />;
}

function Setup() {
  const { apply } = useGame();
  const [rows, setRows] = useState<EnemyRow[]>([{ name: '', level: 1, count: 1 }]);
  const ok = rows.some((r) => r.name.trim());
  return (
    <ToolSheet
      title="Battle"
      description="Start a fight. Turns are resolved by the game, not the model."
      footer={
        <Button variant="primary" size="lg" icon={Swords} block disabled={!ok} onClick={() => apply({ type: 'battle.start', enemies: rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), level: r.level, count: r.count })) } as Op)}>
          Start battle
        </Button>
      }
    >
      <EmptyState icon={Swords} title="No battle right now" body="The story can start one, or set up opponents below." className="!py-6" />
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input aria-label="Opponent" placeholder="Opponent" value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="min-w-0 flex-1" maxLength={60} />
            <Select aria-label="Level" value={r.level} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, level: Number(e.target.value) } : x)))} className="w-20">
              {Array.from({ length: 30 }, (_, k) => k + 1).map((l) => (
                <option key={l} value={l}>
                  Lv {l}
                </option>
              ))}
            </Select>
            <Select aria-label="How many" value={r.count} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, count: Number(e.target.value) } : x)))} className="w-16">
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  ×{n}
                </option>
              ))}
            </Select>
            <IconButton size="sm" icon={X} label="Remove" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Button variant="quiet" size="sm" icon={Plus} className="self-start" disabled={rows.length >= 6} onClick={() => setRows([...rows, { name: '', level: 1, count: 1 }])}>
          Add opponent
        </Button>
      </div>
    </ToolSheet>
  );
}

function Fighter({ c, active, selected, onSelect }: { c: Combatant; active: boolean; selected: boolean; onSelect?: () => void }) {
  return (
    <motion.button
      layout
      type="button"
      disabled={!onSelect || !c.alive}
      onClick={onSelect}
      aria-pressed={onSelect ? selected : undefined}
      animate={{ opacity: c.alive ? 1 : 0.4 }}
      transition={t.base}
      className={cx('flex flex-col gap-1.5 rounded-md border px-3 py-2 text-left', selected ? 'border-accent bg-accent-soft' : active ? 'border-line-strong' : 'border-line', onSelect && c.alive && 'pressable hover:bg-surface-2')}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
        {active ? <Badge tone="accent">Turn</Badge> : null}
        {c.defending ? <Shield size={14} className="text-fg-2" aria-label="Defending" /> : null}
        {!c.alive ? <Badge tone="danger">Down</Badge> : null}
      </span>
      <StatBar label="HP" value={c.hp} max={c.maxHp} tone="danger" compact />
      {c.maxMp ? <StatBar label="MP" value={c.mp} max={c.maxMp} tone="accent" compact /> : null}
      {c.statuses.length ? <span className="text-xs text-fg-2">{c.statuses.map((st) => `${st.name} (${st.turns})`).join(', ')}</span> : null}
    </motion.button>
  );
}

function Fight({ battle: b }: { battle: BattleT }) {
  const { state: s, apply, run, close, busy } = useGame();
  const [target, setTarget] = useState<string | null>(null);
  const [skill, setSkill] = useState('');
  const [item, setItem] = useState('');
  const [acting, setActing] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);
  const actor = currentActor(b);
  const party = Object.values(b.combatants).filter((c) => c.side === 'party');
  const enemies = Object.values(b.combatants).filter((c) => c.side === 'enemy');
  const myTurn = b.status === 'active' && !!actor?.isPlayer;
  const skills = Object.values(s!.player.skills);
  const usable = Object.values(s!.inventory).filter((i) => i.qty > 0 && (Object.keys(i.effects?.bars ?? {}).length || Object.keys(i.effects?.trackers ?? {}).length || i.category === 'medicine' || i.category === 'consumable'));
  useEffect(() => {
    if (target && !b.combatants[target]?.alive) setTarget(null);
  }, [b, target]);
  useEffect(() => {
    logRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [b.log.length]);

  const act = async (op: Record<string, unknown>) => {
    setActing(true);
    await apply({ type: 'battle.action', ...op } as Op, { quiet: true });
    setActing(false);
  };
  const outcome = b.status === 'won' ? 'Victory' : b.status === 'lost' ? 'Defeat' : b.status === 'fled' ? 'Escaped' : null;

  return (
    <ToolSheet
      title={outcome ?? `Battle · Round ${b.round}`}
      description={outcome ? undefined : myTurn ? 'Your move' : `${actor?.name ?? '…'} is acting`}
      footer={
        outcome ? (
          <>
            <Button variant="secondary" className="flex-1" onClick={() => apply({ type: 'battle.end' } as Op)}>
              Close battle
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={busy}
              onClick={async () => {
                const last = b.log.slice(-6).map((l) => l.text).join(' ');
                await apply({ type: 'battle.end' } as Op, { quiet: true });
                close();
                void run('normal', `*${outcome}. ${last}*`);
              }}
            >
              Tell the story
            </Button>
          </>
        ) : (
          <div className="grid w-full grid-cols-4 gap-2">
            <Button variant="primary" icon={Swords} disabled={!myTurn || acting} onClick={() => act({ action: 'attack', target: target ?? undefined })}>
              Attack
            </Button>
            <Button variant="secondary" icon={Sparkles} disabled={!myTurn || acting || !skill} onClick={() => act({ action: 'skill', skill, target: target ?? undefined })}>
              Skill
            </Button>
            <Button variant="secondary" icon={Shield} disabled={!myTurn || acting} onClick={() => act({ action: 'defend' })}>
              Defend
            </Button>
            <Button variant="ghost" icon={Footprints} disabled={!myTurn || acting} onClick={() => act({ action: 'flee' })}>
              Flee
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {outcome && b.rewards ? (
          <div className="rounded-md bg-accent-soft px-3 py-2.5 text-sm">
            {[b.rewards.xp ? `+${b.rewards.xp} XP` : null, b.rewards.currency ? `+${b.rewards.currency} ${s!.meta.currency.name}` : null, ...b.rewards.items].filter(Boolean).join(' · ') || 'No spoils.'}
          </div>
        ) : null}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Opponents {myTurn ? '· tap to target' : ''}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {enemies.map((c) => (
              <Fighter key={c.id} c={c} active={actor?.id === c.id} selected={target === c.id} onSelect={myTurn ? () => setTarget(target === c.id ? null : c.id) : undefined} />
            ))}
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Your side</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {party.map((c) => (
              <Fighter key={c.id} c={c} active={actor?.id === c.id} selected={false} />
            ))}
          </div>
        </section>
        {!outcome ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Select aria-label="Skill" value={skill} onChange={(e) => setSkill(e.target.value)} disabled={!skills.length}>
              <option value="">{skills.length ? 'Choose a skill…' : 'No skills'}</option>
              {skills.map((sk) => (
                <option key={sk.id} value={sk.id}>
                  {sk.name}
                  {sk.costType !== 'none' ? ` · ${sk.cost} ${sk.costType.toUpperCase()}` : ''}
                </option>
              ))}
            </Select>
            <div className="flex gap-2">
              <Select aria-label="Item" value={item} onChange={(e) => setItem(e.target.value)} disabled={!usable.length} className="min-w-0 flex-1">
                <option value="">{usable.length ? 'Use an item…' : 'No usable items'}</option>
                {usable.map((i) => (
                  <option key={i.id} value={i.name}>
                    {i.name} ×{i.qty}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" disabled={!myTurn || acting || !item} onClick={() => act({ action: 'item', item })}>
                Use
              </Button>
            </div>
          </div>
        ) : null}
        <ol ref={logRef} className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md bg-surface-2 p-3 text-sm" aria-live="polite" aria-label="Battle log">
          <AnimatePresence initial={false}>
            {b.log.slice(-40).map((l, i) => (
              <motion.li key={`${b.log.length - 40 + i}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={t.fast} className={cx(l.kind === 'crit' || l.kind === 'defeat' ? 'font-medium text-fg' : l.kind === 'miss' ? 'text-fg-3' : l.kind === 'heal' ? 'text-success' : 'text-fg-2')}>
                {l.text}
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </div>
    </ToolSheet>
  );
}
