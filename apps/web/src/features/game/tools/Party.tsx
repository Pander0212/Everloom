import { CURVES, type CampaignState, type EquipSlot, type LevelCurve, type Op, type PartyMember, type TacticRule, type Tactics, type XpSource } from '@everloom/engine';
import { Crown, Plus, SlidersHorizontal, Trash2, UserMinus, UserPlus, UsersRound, X } from 'lucide-react';
import { useState } from 'react';
import { cx } from '@/lib/format';
import { useCharacters } from '@/lib/queries';
import { Avatar, Badge, Button, confirm, EmptyState, Field, IconButton, Input, Segmented, Select, Sheet, StatBar, TabPanel, Tabs, ToggleRow } from '@/ui';
import { useGame } from '../context';
import { ProgressPanel } from './Progress';
import { NoCampaign, ToolSheet } from './ToolSheet';

const SLOTS: EquipSlot[] = ['weapon', 'offhand', 'head', 'body', 'hands', 'legs', 'feet', 'back', 'accessory'];
const ROLE_KINDS = ['tank', 'healer', 'damage', 'support', 'scout'] as const;
const PRESETS: Array<{ value: Tactics['preset']; label: string; desc: string }> = [
  { value: 'balanced', label: 'Balanced', desc: 'Heals when someone is badly hurt, otherwise attacks the weakest foe.' },
  { value: 'aggressive', label: 'Aggressive', desc: 'Uses skills freely and finishes off broken foes.' },
  { value: 'defensive', label: 'Defensive', desc: 'Guards when hurt and heals early.' },
  { value: 'heal-first', label: 'Heal first', desc: 'Keeps everyone topped up before attacking.' },
  { value: 'conserve', label: 'Conserve', desc: 'Saves MP; heals only in emergencies.' },
];
const WHEN: Record<TacticRule['when'], string> = { allyHpBelow: 'An ally is below', selfHpBelow: 'Own HP is below', enemyBroken: 'A foe is broken', always: 'Otherwise' };
const DO: Record<TacticRule['do'], string> = { heal: 'Heal them', defend: 'Defend', attackWeakest: 'Attack the weakest', attackStrongest: 'Attack the strongest', skill: 'Use a skill' };

export default function Party({ arg }: { arg?: string }) {
  const { state: s, apply } = useGame();
  const chars = useCharacters();
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  const [who, setWho] = useState('');
  const [role, setRole] = useState('');
  const [openId, setOpenId] = useState<string | null>(arg ?? null);
  if (!s) return <ToolSheet title="Party"><NoCampaign /></ToolSheet>;
  const members = Object.values(s.party);
  const active = members.filter((m) => m.active !== false);
  const reserve = members.filter((m) => m.active === false);
  const open = openId === 'player' ? 'player' : openId ? (s.party[openId] ?? null) : null;
  const candidates = Object.values(s.npcs).filter((n) => n.status === 'alive' && !members.some((m) => m.npcId === n.id));
  const portrait = (m: PartyMember) => {
    const npc = m.npcId ? s.npcs[m.npcId] : null;
    return npc?.portrait ? `/media/${npc.portrait}` : chars.data?.find((c) => c.id === (m.characterId ?? npc?.characterId))?.avatar;
  };
  const leader = s.partyMeta.leader;
  const row = (m: PartyMember) => (
    <button key={m.id} onClick={() => setOpenId(m.id)} className="pressable flex items-center gap-3 rounded-md border border-line px-3 py-2.5 text-left hover:bg-surface-2">
      <Avatar src={portrait(m)} name={m.name} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{m.name}</span>
          {leader === m.id ? <Crown size={13} className="flex-none text-accent" aria-label="Leader" /> : null}
          {m.row === 'back' ? <Badge>Back row</Badge> : null}
          {m.injuries?.length ? <Badge tone="danger">{m.injuries[0]}</Badge> : null}
        </span>
        <span className="block truncate text-xs text-fg-2">{[m.roleKind ?? m.role, `Level ${m.level}`, (m.statPoints || m.skillPoints) ? 'points to spend' : null].filter(Boolean).join(' · ')}</span>
        <span className="mt-1.5 grid grid-cols-2 gap-2">
          <StatBar label="HP" value={m.hp} max={m.maxHp} tone="danger" compact />
          <StatBar label="MP" value={m.mp} max={m.maxMp} tone="accent" compact />
        </span>
      </span>
    </button>
  );

  return (
    <ToolSheet
      title="Party"
      description={members.length ? `${active.length} active${reserve.length ? ` · ${reserve.length} in reserve` : ''}` : undefined}
      headerActions={<IconButton icon={SlidersHorizontal} label="Party settings" onClick={() => setSettings(true)} />}
      footer={
        <Button variant="secondary" icon={UserPlus} block onClick={() => setAdding(true)}>
          Add companion
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <button onClick={() => setOpenId('player')} className="pressable flex items-center gap-3 rounded-md border border-line px-3 py-2.5 text-left hover:bg-surface-2">
          <Avatar name={s.player.name || 'You'} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{s.player.name || 'You'}</span>
              {leader === 'player' ? <Crown size={13} className="flex-none text-accent" aria-label="Leader" /> : null}
            </span>
            <span className="block truncate text-xs text-fg-2">
              {[s.player.className || 'No class', `Level ${s.player.level}`, (s.player.statPoints || s.player.skillPoints) ? 'points to spend' : null].filter(Boolean).join(' · ')}
            </span>
          </span>
        </button>
        {members.length ? (
          <>
            <section aria-label="Active party" className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-3">
                Active · {active.length}/{s.partyMeta.maxActive}
              </h3>
              {active.map(row)}
            </section>
            {reserve.length ? (
              <section aria-label="Reserve" className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-3">Reserve</h3>
                {reserve.map(row)}
              </section>
            ) : null}
          </>
        ) : (
          <EmptyState icon={UsersRound} title="Travelling alone" body="Companions fight beside you and show up in battles." />
        )}
      </div>

      <Sheet open={open === 'player'} onOpenChange={(o) => !o && setOpenId(null)} title={s.player.name || 'You'} description="Class, stats and skills" size="md">
        {open === 'player' ? <ProgressPanel s={s} who={{ kind: 'player' }} /> : null}
      </Sheet>

      <Sheet
        open={!!open && open !== 'player'}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={open && open !== 'player' ? open.name : ''}
        description={open && open !== 'player' ? `Level ${open.level}` : undefined}
        size="md"
        headerActions={
          open && open !== 'player' ? (
            <IconButton
              icon={UserMinus}
              label="Leave party"
              onClick={async () => {
                if (!(await confirm({ title: `${open.name} leaves the party?`, confirmLabel: 'Remove', danger: true }))) return;
                if (await apply({ type: 'party.remove', name: open.name } as Op)) setOpenId(null);
              }}
            />
          ) : null
        }
      >
        {open && open !== 'player' ? <MemberView s={s} m={open} /> : null}
      </Sheet>

      <SettingsSheet s={s} open={settings} onOpenChange={setSettings} />

      <Sheet
        open={adding}
        onOpenChange={setAdding}
        title="Add companion"
        size="md"
        footer={
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!who.trim()}
            onClick={async () => {
              if (await apply({ type: 'party.add', name: who.trim(), role: role.trim() || undefined } as Op)) {
                setAdding(false);
                setWho('');
                setRole('');
              }
            }}
          >
            Add
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Who" htmlFor="pa-who" hint="Pick someone you've met or type a new name.">
            <Input id="pa-who" list="pa-npcs" value={who} onChange={(e) => setWho(e.target.value)} maxLength={80} />
            <datalist id="pa-npcs">
              {candidates.map((n) => (
                <option key={n.id} value={n.name} />
              ))}
            </datalist>
          </Field>
          <Field label="Role" htmlFor="pa-role">
            <Input id="pa-role" placeholder="Healer, scout…" value={role} onChange={(e) => setRole(e.target.value)} maxLength={60} />
          </Field>
        </div>
      </Sheet>
    </ToolSheet>
  );
}

function MemberView({ s, m }: { s: CampaignState; m: PartyMember }) {
  const { apply } = useGame();
  const [tab, setTab] = useState('overview');
  const q = { quiet: true };
  const isActive = m.active !== false;
  return (
    <Tabs
      value={tab}
      onChange={setTab}
      tabs={[
        { value: 'overview', label: 'Overview' },
        { value: 'tactics', label: 'Tactics' },
        { value: 'growth', label: 'Growth' },
        { value: 'gear', label: 'Gear' },
      ]}
    >
      <TabPanel value="overview" className="flex flex-col gap-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Place" htmlFor="pm-active">
            <Segmented
              label="Place"
              value={isActive ? 'active' : 'reserve'}
              onChange={(v) => apply({ type: 'party.formation', name: m.id, active: v === 'active' } as Op, q)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'reserve', label: 'Reserve' },
              ]}
            />
          </Field>
          <Field label="Row" htmlFor="pm-row">
            <Segmented
              label="Row"
              value={m.row ?? 'front'}
              onChange={(v) => apply({ type: 'party.formation', name: m.id, row: v } as Op, q)}
              options={[
                { value: 'front', label: 'Front' },
                { value: 'back', label: 'Back' },
              ]}
            />
          </Field>
        </div>
        {s.partyMeta.leader === m.id ? (
          <p className="flex items-center gap-2 text-sm text-fg-2">
            <Crown size={14} className="text-accent" /> Leads the party (acts first in battle)
          </p>
        ) : (
          <Button variant="secondary" icon={Crown} className="self-start" disabled={!isActive} onClick={() => apply({ type: 'party.leader', name: m.id } as Op, q)}>
            Make leader
          </Button>
        )}
        <Field label="Role" htmlFor="pm-role">
          <Input id="pm-role" defaultValue={m.role} key={m.id} maxLength={60} onBlur={(e) => e.target.value.trim() !== m.role && apply({ type: 'party.update', name: m.id, role: e.target.value.trim() } as Op, q)} />
        </Field>
        <Vitals m={m} />
        {m.injuries?.length ? (
          <section aria-label="Injuries">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Injuries</h3>
            <ul className="flex flex-col gap-1">
              {m.injuries.map((x) => (
                <li key={x} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{x}</span>
                  <Button size="sm" variant="quiet" onClick={() => apply({ type: 'party.injury', name: m.id, injury: x, remove: true } as Op, q)}>
                    Healed
                  </Button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-fg-3">A night's sleep clears knock-outs.</p>
          </section>
        ) : null}
      </TabPanel>
      <TabPanel value="tactics" className="pt-4">
        <TacticsEditor m={m} />
      </TabPanel>
      <TabPanel value="growth" className="pt-4">
        <ProgressPanel s={s} who={{ kind: 'member', m }} />
      </TabPanel>
      <TabPanel value="gear" className="pt-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SLOTS.map((slot) => {
            const options = Object.values(s.inventory).filter((i) => i.slot === slot || (!i.slot && ['weapon', 'armor', 'clothing', 'accessory'].includes(i.category)));
            return (
              <Field key={slot} label={slot[0]!.toUpperCase() + slot.slice(1)} htmlFor={`eq-${slot}`}>
                <Select id={`eq-${slot}`} value={m.equipment[slot] ?? ''} onChange={(e) => apply({ type: 'party.update', name: m.id, equip: { slot, item: e.target.value || null } } as Op, q)}>
                  <option value="">Nothing</option>
                  {m.equipment[slot] && !options.some((i) => i.name === m.equipment[slot]) ? <option value={m.equipment[slot]}>{m.equipment[slot]}</option> : null}
                  {options.map((i) => (
                    <option key={i.id} value={i.name}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              </Field>
            );
          })}
        </div>
      </TabPanel>
    </Tabs>
  );
}

function Vitals({ m }: { m: PartyMember }) {
  const { apply } = useGame();
  const [label, setLabel] = useState('');
  const vitals = Object.entries(m.vitals ?? {});
  return (
    <section aria-label="Vitals">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Vitals</h3>
      <div className="flex flex-col gap-2">
        <StatBar label="HP" value={m.hp} max={m.maxHp} tone="danger" />
        <StatBar label="MP" value={m.mp} max={m.maxMp} tone="accent" />
        {vitals.map(([id, v]) => (
          <div key={id} className="flex items-center gap-2">
            <StatBar label={v.label} value={v.cur} max={v.max} className="flex-1" />
            <IconButton size="sm" icon={Trash2} label={`Remove ${v.label}`} onClick={() => apply({ type: 'party.vital', name: m.id, id, label: v.label, remove: true } as Op, { quiet: true })} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input aria-label="New vital" placeholder="Add a vital (Sanity, Stamina…)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} />
        <Button disabled={!label.trim()} onClick={() => apply({ type: 'party.vital', name: m.id, label: label.trim(), max: 100 } as Op, { quiet: true }).then(() => setLabel(''))}>
          Add
        </Button>
      </div>
    </section>
  );
}

function TacticsEditor({ m }: { m: PartyMember }) {
  const { apply } = useGame();
  const t = m.tactics ?? { preset: 'balanced', rules: [] };
  const rules = t.rules;
  const save = (next: TacticRule[]) => apply({ type: 'party.tactics', name: m.id, rules: next } as Op, { quiet: true });
  return (
    <div className="flex flex-col gap-4">
      <Field label="Battle role" htmlFor="pm-rolekind">
        <Select id="pm-rolekind" value={m.roleKind ?? ''} onChange={(e) => apply({ type: 'party.tactics', name: m.id, roleKind: e.target.value || null } as Op, { quiet: true })}>
          <option value="">None</option>
          {ROLE_KINDS.map((r) => (
            <option key={r} value={r}>
              {r[0]!.toUpperCase() + r.slice(1)}
            </option>
          ))}
        </Select>
      </Field>
      <div role="radiogroup" aria-label="Tactics" className="flex flex-col gap-1">
        {PRESETS.map((p) => {
          const on = !rules.length && t.preset === p.value;
          return (
            <button
              key={p.value}
              role="radio"
              aria-checked={on}
              onClick={() => apply({ type: 'party.tactics', name: m.id, preset: p.value, rules: [] } as Op, { quiet: true })}
              className={cx('pressable flex flex-col rounded-md border px-3 py-2 text-left', on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}
            >
              <span className="text-sm font-medium">{p.label}</span>
              <span className="text-xs text-fg-2">{p.desc}</span>
            </button>
          );
        })}
      </div>
      <section aria-label="Custom rules">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-3">Custom rules</h3>
        <p className="mb-2 text-xs text-fg-2">Checked top to bottom; the first that fits is used. Custom rules replace the preset.</p>
        <ul className="flex flex-col gap-2">
          {rules.map((r, i) => (
            <li key={i} className="grid grid-cols-[1fr_4rem_1fr_auto] items-center gap-2">
              <Select aria-label="When" value={r.when} onChange={(e) => save(rules.map((x, j) => (j === i ? { ...x, when: e.target.value as TacticRule['when'] } : x)))}>
                {Object.entries(WHEN).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
              <Input aria-label="Percent" type="number" min={0} max={100} disabled={!r.when.endsWith('Below')} value={r.value} onChange={(e) => save(rules.map((x, j) => (j === i ? { ...x, value: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } : x)))} />
              <Select aria-label="Then" value={r.do} onChange={(e) => save(rules.map((x, j) => (j === i ? { ...x, do: e.target.value as TacticRule['do'] } : x)))}>
                {Object.entries(DO).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
              <IconButton size="sm" icon={X} label="Remove rule" onClick={() => save(rules.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
        <Button size="sm" variant="quiet" icon={Plus} className="mt-1" disabled={rules.length >= 8} onClick={() => save([...rules, { when: 'allyHpBelow', value: 40, do: 'heal' }])}>
          Add rule
        </Button>
      </section>
    </div>
  );
}

const SOURCES: Array<{ id: XpSource; label: string; desc: string }> = [
  { id: 'battle', label: 'Battles', desc: 'Winning a fight; the active party shares it.' },
  { id: 'quests', label: 'Quests', desc: 'Finishing a quest: 30 + 10 per level.' },
  { id: 'discovery', label: 'Discovery', desc: 'Reaching a place for the first time: 10.' },
  { id: 'crafting', label: 'Crafting', desc: 'A quarter of crafting experience.' },
];

function SettingsSheet({ s, open, onOpenChange }: { s: CampaignState; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { apply } = useGame();
  const q = { quiet: true };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Party settings" size="md">
      <div className="flex flex-col gap-4">
        <Field label="Level curve" htmlFor="ps-curve" hint="How much XP each level takes.">
          <Select id="ps-curve" value={s.partyMeta.curve ?? 'standard'} onChange={(e) => apply({ type: 'party.meta', curve: e.target.value as LevelCurve } as Op, q)}>
            {Object.entries(CURVES).map(([k, c]) => (
              <option key={k} value={k}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Active companions" htmlFor="ps-max" hint="The rest wait in reserve and can swap in during a battle.">
          <Select id="ps-max" value={s.partyMeta.maxActive} onChange={(e) => apply({ type: 'party.meta', maxActive: Number(e.target.value) } as Op, q)}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <section aria-label="XP sources">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-3">XP comes from</h3>
          <div className="divide-y divide-line">
            {SOURCES.map((src) => (
              <ToggleRow key={src.id} label={src.label} description={src.desc} checked={s.partyMeta.xpSources?.[src.id] !== false} onChange={(v) => apply({ type: 'party.meta', xpSources: { [src.id]: v } } as Op, q)} />
            ))}
          </div>
        </section>
      </div>
    </Sheet>
  );
}
