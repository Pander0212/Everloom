import type { Battle as BattleT, Combatant, Op } from '@everloom/engine';
import { currentActor, iconForItem } from '@everloom/engine';
import { ArrowLeftRight, Crown, Footprints, Plus, Shield, Sparkles, Swords, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { ArtPicture } from '@/lib/art';
import { cx } from '@/lib/format';
import { t } from '@/lib/motion';
import { Badge, Button, EmptyState, IconButton, Input, Select, StatBar } from '@/ui';
import { useGame } from '../context';
import { ItemGlyph } from '../ItemGlyph';
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
            <Select aria-label="How many" value={r.count} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, count: Number(e.target.value) } : x)))} className="w-20">
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

/** Everloom's picture for a common kind of foe, by name. */
const ENEMY_ART: Array<[RegExp, string]> = [
  [/\b(wolf|wolves|hound|jackal|warg|dog)\b/i, 'wolf'],
  [/\b(bandit|thief|brigand|thug|raider|mugger|pirate|outlaw|cutpurse)\b/i, 'bandit'],
  [/\b(slime|ooze|blob|jelly)\b/i, 'slime'],
  [/\bdrone\b/i, 'drone'],
  [/\b(robot|bot|android|mech|automaton|golem|sentry)\b/i, 'robot'],
  [/\b(wyvern|dragon|drake|wyrm)\b/i, 'wyvern'],
];
const enemyArt = (name: string) => ENEMY_ART.find(([re]) => re.test(name))?.[1] ?? null;

function Fighter({ c, b, active, selected, onSelect, leader }: { c: Combatant; b: BattleT; active: boolean; selected: boolean; onSelect?: () => void; leader?: boolean }) {
  const broken = (c.brokenTurns ?? 0) > 0;
  const weakKnown = c.side === 'enemy' && b.log.some((l) => l.text.includes(`hits ${c.name} (weak point)`));
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
        {c.side === 'enemy' && enemyArt(c.name) ? <ArtPicture src={`enemies/${enemyArt(c.name)}`} avif={false} width={36} height={36} className="flex-none" imgClassName="h-9 w-9 rounded-sm object-contain" /> : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
        {leader ? <Crown size={13} className="flex-none text-accent" aria-label="Leader" /> : null}
        {c.row === 'back' ? <Badge>Back</Badge> : null}
        {active ? <Badge tone="accent">Turn</Badge> : null}
        {broken ? <Badge tone="warning">Broken</Badge> : null}
        {c.defending ? <Shield size={14} className="text-fg-2" aria-label="Defending" /> : null}
        {!c.alive ? <Badge tone="danger">Down</Badge> : null}
      </span>
      <StatBar label="HP" value={c.hp} max={c.maxHp} tone="danger" compact />
      {c.maxMp && c.side === 'party' ? <StatBar label="MP" value={c.mp} max={c.maxMp} tone="accent" compact /> : null}
      {c.breakMax && c.alive ? (
        <span className="flex items-center gap-1" aria-label={broken ? 'Broken' : `Guard ${c.breakCur ?? c.breakMax} of ${c.breakMax}`}>
          {Array.from({ length: c.breakMax }, (_, i) => (
            <span key={i} className={cx('h-1.5 flex-1 rounded-full', !broken && i < (c.breakCur ?? c.breakMax ?? 0) ? 'bg-fg-2' : 'bg-surface-2')} />
          ))}
        </span>
      ) : null}
      {c.intent && c.alive ? <span className="text-xs text-fg-2">Next: {c.intent.label}</span> : null}
      {weakKnown && c.weaknesses?.length ? <span className="text-xs text-fg-2">Weak to {c.weaknesses.join(', ')}</span> : null}
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
  const party = Object.values(b.combatants).filter((c) => c.side === 'party' && !c.reserve);
  const reserves = Object.values(b.combatants).filter((c) => c.side === 'party' && c.reserve);
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
      size="full"
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
          <section aria-label="Battle summary" className="flex flex-col gap-2 rounded-md bg-accent-soft px-3 py-3 text-sm">
            <p className="font-medium">
              {[b.rewards.xp ? `+${b.rewards.xp} XP` : null, b.rewards.currency ? `+${b.rewards.currency} ${s!.meta.currency.name}` : null, ...b.rewards.items].filter(Boolean).join(' · ') || 'No spoils.'}
            </p>
            {b.rewards.items.length ? (
              <ul aria-label="Loot" className="flex flex-wrap gap-2">
                {b.rewards.items.map((name, i) => (
                  <li key={i} className="flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs">
                    <ItemGlyph icon={iconForItem(name, 'misc')} name={name} size={20} className="text-fg-2" />
                    {name}
                  </li>
                ))}
              </ul>
            ) : null}
            {b.summary ? (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-fg-2">Rounds</dt>
                    <dd className="font-semibold tabular-nums">{b.summary.rounds}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-2">Damage dealt</dt>
                    <dd className="font-semibold tabular-nums">{b.summary.dealt}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-2">Damage taken</dt>
                    <dd className="font-semibold tabular-nums">{b.summary.taken}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-2">Breaks</dt>
                    <dd className="font-semibold tabular-nums">{b.summary.breaks}</dd>
                  </div>
                </dl>
                {b.summary.mvp ? <p className="text-xs text-fg-2">Most damage: {b.summary.mvp}</p> : null}
                {b.summary.levelUps.length ? <p className="text-xs font-medium">Level up! {b.summary.levelUps.join(' · ')}</p> : null}
                {b.summary.injuries.length ? <p className="text-xs text-danger">{b.summary.injuries.join(' · ')}</p> : null}
              </>
            ) : null}
          </section>
        ) : null}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Opponents {myTurn ? '· tap to target' : ''}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {enemies.map((c) => (
              <Fighter key={c.id} c={c} b={b} active={actor?.id === c.id} selected={target === c.id} onSelect={myTurn ? () => setTarget(target === c.id ? null : c.id) : undefined} />
            ))}
          </div>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Your side</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {party.map((c) => (
              <Fighter key={c.id} c={c} b={b} active={actor?.id === c.id} selected={false} leader={b.leader === c.id} />
            ))}
          </div>
        </section>
        {reserves.length && !outcome ? (
          <section aria-label="Reserve">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Reserve · swapping in uses your turn</h3>
            <ul className="flex flex-col gap-1.5">
              {reserves.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-md border border-line px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{c.name}</span>
                    <StatBar label="HP" value={c.hp} max={c.maxHp} tone="danger" compact />
                  </span>
                  <Button size="sm" variant="secondary" icon={ArrowLeftRight} disabled={!myTurn || acting || !c.alive} onClick={() => act({ action: 'swap', target: c.id })} aria-label={`Swap in ${c.name}`}>
                    Swap in
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
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
