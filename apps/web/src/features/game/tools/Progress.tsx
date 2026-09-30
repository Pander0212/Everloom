import { allClasses, allSkillNodes, curveOf, findClass, learnProblems, powerAt, rankOf, STAT_KEYS, xpToNext, type CampaignState, type Op, type SkillNode, type Who } from '@everloom/engine';
import { Lock, Plus } from 'lucide-react';
import { cx } from '@/lib/format';
import { Badge, Button, Field, IconButton, Select } from '@/ui';
import { useGame } from '../context';

const STAT_LABEL = { atk: 'Attack', def: 'Defense', spd: 'Speed', mag: 'Magic', hp: 'Max HP', mp: 'Max MP' } as const;
const TARGET_LABEL = { single: 'one foe', all: 'all foes', row: 'a row', random: '3 random hits', self: 'self', ally: 'one ally', allies: 'all allies' } as const;

/** Class, level, stat points and the skill tree, for the player or a companion. */
export function ProgressPanel({ s, who }: { s: CampaignState; who: Who }) {
  const { apply } = useGame();
  const whoName = who.kind === 'player' ? undefined : who.m.id;
  const level = who.kind === 'player' ? s.player.level : who.m.level;
  const xp = who.kind === 'player' ? (s.player.bars.xp?.cur ?? 0) : (who.m.xp ?? 0);
  const need = who.kind === 'player' ? (s.player.bars.xp?.max ?? xpToNext(level, curveOf(s))) : xpToNext(level, curveOf(s));
  const classId = (who.kind === 'player' ? s.player.classId : who.m.classId) ?? '';
  const statPts = (who.kind === 'player' ? s.player.statPoints : who.m.statPoints) ?? 0;
  const skillPts = (who.kind === 'player' ? s.player.skillPoints : who.m.skillPoints) ?? 0;
  const stats = who.kind === 'player' ? s.player.stats : who.m.stats;
  const nodes = allSkillNodes(s).filter((n) => !n.classId || n.classId === classId);
  const cls = classId ? findClass(s, classId) : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Level {level}</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (xp / Math.max(1, need)) * 100)}%` }} />
        </span>
        <span className="text-xs tabular-nums text-fg-2">
          {Math.round(xp)}/{need} XP
        </span>
      </div>
      <Field label="Class" htmlFor={`class-${whoName ?? 'me'}`} hint={cls?.desc}>
        <Select id={`class-${whoName ?? 'me'}`} value={classId} onChange={(e) => e.target.value && apply({ type: 'class.set', who: whoName, class: e.target.value } as Op, { quiet: true })}>
          <option value="">No class (even growth)</option>
          {allClasses(s).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <section aria-label="Stats">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-3">Stats</h3>
          {statPts ? <Badge tone="accent">{statPts} to spend</Badge> : null}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[...STAT_KEYS, 'hp' as const, 'mp' as const].map((k) => {
            const val = k === 'hp' ? (who.kind === 'player' ? s.player.bars.hp?.max : who.m.maxHp) : k === 'mp' ? (who.kind === 'player' ? s.player.bars.mp?.max : who.m.maxMp) : stats[k];
            if (val === undefined) return null;
            return (
              <div key={k} className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-fg-3">{STAT_LABEL[k]}</span>
                  <span className="block text-sm font-semibold tabular-nums">{Math.round(val)}</span>
                </span>
                {statPts ? <IconButton size="sm" icon={Plus} label={`Raise ${STAT_LABEL[k]}`} onClick={() => apply({ type: 'stats.spend', who: whoName, stat: k, points: 1 } as Op, { quiet: true })} /> : null}
              </div>
            );
          })}
        </div>
      </section>
      <section aria-label="Skill tree">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-3">Skills</h3>
          <Badge tone={skillPts ? 'accent' : 'neutral'}>
            {skillPts} skill point{skillPts === 1 ? '' : 's'}
          </Badge>
        </div>
        {nodes.length ? (
          <ul className="flex flex-col gap-2">
            {nodes.map((n) => (
              <SkillRow key={n.id} s={s} who={who} node={n} onLearn={() => apply({ type: 'skill.learn', who: whoName, skill: n.id } as Op, { quiet: true })} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-2">Choose a class to see its skill tree.</p>
        )}
      </section>
    </div>
  );
}

function SkillRow({ s, who, node, onLearn }: { s: CampaignState; who: Who; node: SkillNode; onLearn: () => void }) {
  const rank = rankOf(s, who, node.id);
  const problems = learnProblems(s, who, node);
  const maxed = rank >= node.maxRank;
  const blockers = problems.filter((p) => p !== 'No skill points');
  return (
    <li className={cx('rounded-md border p-3', rank ? 'border-line-strong' : 'border-line')}>
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            {!rank && blockers.length ? <Lock size={13} className="flex-none text-fg-3" aria-label="Locked" /> : null}
            <span className="truncate text-sm font-medium">{node.name}</span>
            {rank ? (
              <Badge tone="accent">
                Rank {rank}/{node.maxRank}
              </Badge>
            ) : null}
          </span>
          <span className="block text-xs text-fg-2">
            {node.kind} · {TARGET_LABEL[node.target]}
            {node.element ? ` · ${node.element}` : ''}
            {node.power ? ` · power ${powerAt(node, Math.max(1, rank))}` : ''}
            {node.costType !== 'none' ? ` · ${node.cost} ${node.costType.toUpperCase()}` : ''}
          </span>
          {!maxed && blockers.length ? <span className="mt-1 block text-xs text-fg-3">{blockers.join(' · ')}</span> : null}
        </span>
        {!maxed ? (
          <Button size="sm" variant={problems.length ? 'secondary' : 'primary'} disabled={!!problems.length} onClick={onLearn} aria-label={`${rank ? 'Rank up' : 'Learn'} ${node.name}`}>
            {rank ? 'Rank up' : 'Learn'}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
