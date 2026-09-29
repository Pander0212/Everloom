import type { CampaignState, Op, Org } from '@everloom/engine';
import { formatDate, standingLabel } from '@everloom/engine';
import { Building, Lock, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cx } from '@/lib/format';
import { Badge, Button, confirm, EmptyState, Field, Icon, IconButton, Input, Select, Sheet, Slider, TabPanel, Tabs, Textarea, ToggleRow } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

const STANDING_TONE = { Enemy: 'danger', Hostile: 'warning', Neutral: 'neutral', Friendly: 'success' } as const;

function StandingMeter({ value }: { value: number }) {
  const label = standingLabel(value);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-label="Standing">
        {/* Thresholds at 15 / 35 / 65 */}
        {[15, 35, 65].map((t) => (
          <span key={t} className="absolute top-0 h-full w-px bg-bg" style={{ left: `${t}%` }} />
        ))}
        <span className="absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-300" style={{ transform: `scaleX(${Math.max(0, Math.min(100, value)) / 100})`, background: `var(--${STANDING_TONE[label] === 'neutral' ? 'text-3' : STANDING_TONE[label]})` }} />
      </div>
      <Badge tone={STANDING_TONE[label]}>{label}</Badge>
    </div>
  );
}

export default function Orgs({ arg }: { arg?: string }) {
  const { state: s, apply } = useGame();
  const [openId, setOpenId] = useState<string | null>(arg ?? null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const orgs = useMemo(() => Object.values(s?.orgs ?? {}).sort((a, b) => a.name.localeCompare(b.name)), [s]);
  if (!s) return <ToolSheet title="Organizations"><NoCampaign /></ToolSheet>;
  const org = openId ? s.orgs[openId] ?? null : null;

  return (
    <ToolSheet
      title="Organizations"
      description={orgs.length ? `${orgs.length} known` : undefined}
      footer={
        <Button variant="secondary" icon={Plus} block onClick={() => setAdding(true)}>
          Add organization
        </Button>
      }
    >
      {orgs.length ? (
        <div className="flex flex-col gap-2">
          {orgs.map((o) => {
            const bits = [
              o.members.length ? `${o.members.length} ${o.members.length === 1 ? 'member' : 'members'}` : null,
              o.influence.length ? `${o.influence.length} ${o.influence.length === 1 ? 'place' : 'places'}` : null,
              o.runins.length ? `${o.runins.length} run-in${o.runins.length === 1 ? '' : 's'}` : null,
            ].filter(Boolean);
            return (
              <button key={o.id} onClick={() => setOpenId(o.id)} className="pressable flex flex-col gap-2 rounded-md border border-line px-3 py-3 text-left hover:bg-surface-2">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{o.name}</span>
                  {o.locked ? <Icon icon={Lock} size={14} className="text-fg-3" /> : null}
                  {o.type ? <span className="flex-none text-xs text-fg-2">{o.type}</span> : null}
                </span>
                <StandingMeter value={o.standing} />
                {bits.length || o.mainLocationId ? (
                  <span className="text-xs text-fg-2">{[o.mainLocationId ? s.locations[o.mainLocationId]?.name : null, ...bits].filter(Boolean).join(' · ')}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Building} title="No organizations yet" body="Guilds, gangs, companies and courts appear here as the story introduces them." />
      )}

      <Dossier org={org} state={s} onClose={() => setOpenId(null)} />

      <Sheet
        open={adding}
        onOpenChange={setAdding}
        title="Add organization"
        size="md"
        footer={
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!name.trim()}
            onClick={async () => {
              if (await apply({ type: 'org.upsert', name: name.trim(), orgType: type.trim() || undefined } as Op, { quiet: true })) {
                setAdding(false);
                setName('');
                setType('');
              }
            }}
          >
            Add
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor="org-n">
            <Input id="org-n" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Type" htmlFor="org-t" hint="Guild, gang, company, church, court…">
            <Input id="org-t" value={type} onChange={(e) => setType(e.target.value)} maxLength={80} />
          </Field>
        </div>
      </Sheet>
    </ToolSheet>
  );
}

function Dossier({ org, state: s, onClose }: { org: Org | null; state: CampaignState; onClose: () => void }) {
  const { apply } = useGame();
  const [tab, setTab] = useState('info');
  useEffect(() => setTab('info'), [org?.id]);
  if (!org) return <Sheet open={false} onOpenChange={onClose} title="">{null}</Sheet>;
  const set = (patch: Record<string, unknown>) => apply({ type: 'org.set', id: org.id, patch } as Op, { quiet: true });

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={org.name}
      description={org.type || 'Organization'}
      size="lg"
      headerActions={
        <IconButton
          icon={Trash2}
          label="Remove organization"
          onClick={async () => {
            if (!(await confirm({ title: `Remove ${org.name}?`, description: 'Members keep their other ties. You can undo this from the change summary.', confirmLabel: 'Remove', danger: true }))) return;
            if (await apply({ type: 'org.remove', id: org.id } as Op)) onClose();
          }}
        />
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        listClassName="-mx-4 px-2 sm:-mx-5 sm:px-3"
        tabs={[
          { value: 'info', label: 'Info' },
          { value: 'members', label: 'Members', count: org.members.length || undefined },
          { value: 'influence', label: 'Influence', count: org.influence.length || undefined },
          { value: 'rules', label: 'Rules', count: org.rules.length || undefined },
          { value: 'runins', label: 'Run-ins', count: org.runins.length || undefined },
        ]}
      >
        <TabPanel value="info" className="pt-4">
          <InfoTab org={org} state={s} set={set} />
        </TabPanel>
        <TabPanel value="members" className="pt-4">
          <MembersTab org={org} state={s} />
        </TabPanel>
        <TabPanel value="influence" className="pt-4">
          <InfluenceTab org={org} state={s} set={set} />
        </TabPanel>
        <TabPanel value="rules" className="pt-4">
          <ListEditor
            items={org.rules}
            empty="No known rules or codes."
            placeholder="Add a rule or custom"
            onAdd={(text) => apply({ type: 'org.rule', org: org.id, text } as Op, { quiet: true })}
            onRemove={(text) => apply({ type: 'org.rule', org: org.id, text, remove: true } as Op, { quiet: true })}
          />
        </TabPanel>
        <TabPanel value="runins" className="pt-4">
          <RunIns org={org} state={s} />
        </TabPanel>
      </Tabs>
    </Sheet>
  );
}

/** Text input that commits on blur (one op per edit, not per keystroke). */
function BlurInput({ value, onCommit, multiline, ...rest }: { value: string; onCommit: (v: string) => void; multiline?: boolean; id?: string; maxLength?: number; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v.trim() !== value && onCommit(v.trim());
  return multiline ? <Textarea {...rest} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} /> : <Input {...rest} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

function InfoTab({ org, state: s, set }: { org: Org; state: CampaignState; set: (p: Record<string, unknown>) => void }) {
  const [standing, setStanding] = useState(org.standing);
  useEffect(() => setStanding(org.standing), [org.standing]);
  const npcs = Object.values(s.npcs).sort((a, b) => a.name.localeCompare(b.name));
  const locs = Object.values(s.locations).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col gap-4">
      <Field label={`Standing · ${Math.round(standing)}`}>
        <div onPointerUp={() => standing !== org.standing && set({ standing })} onKeyUp={() => standing !== org.standing && set({ standing })}>
          <Slider value={standing} onChange={setStanding} label="Standing" />
        </div>
        <StandingMeter value={standing} />
      </Field>
      <Field label="Name" htmlFor="o-name">
        <BlurInput id="o-name" value={org.name} maxLength={80} onCommit={(v) => v && set({ name: v })} />
      </Field>
      <Field label="Type" htmlFor="o-type">
        <BlurInput id="o-type" value={org.type} maxLength={120} onCommit={(v) => set({ type: v })} />
      </Field>
      <Field label="Purpose" htmlFor="o-purpose">
        <BlurInput id="o-purpose" multiline value={org.purpose} maxLength={2000} onCommit={(v) => set({ purpose: v })} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Leader title" htmlFor="o-lt">
          <BlurInput id="o-lt" value={org.leaderTitle} maxLength={80} placeholder="Guildmaster" onCommit={(v) => set({ leaderTitle: v })} />
        </Field>
        <Field label="Leader" htmlFor="o-leader">
          <Select id="o-leader" value={org.leaderNpcId ?? ''} onChange={(e) => set({ leaderNpcId: e.target.value || null })}>
            <option value="">Unknown</option>
            {npcs.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Headquarters" htmlFor="o-hq">
          <Select id="o-hq" value={org.mainLocationId ?? ''} onChange={(e) => set({ mainLocationId: e.target.value || null })}>
            <option value="">Unknown</option>
            {locs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reach" htmlFor="o-scale">
          <Select id="o-scale" value={org.influenceScale} onChange={(e) => set({ influenceScale: e.target.value })}>
            <option value="local">Local</option>
            <option value="regional">Regional</option>
            <option value="national">National</option>
            <option value="global">Global</option>
          </Select>
        </Field>
      </div>
      <ToggleRow label="Locked" description="The model can't change a locked organization." checked={org.locked} onChange={(v) => set({ locked: v })} />
    </div>
  );
}

function MembersTab({ org, state: s }: { org: Org; state: CampaignState }) {
  const { apply, open } = useGame();
  const [npc, setNpc] = useState('');
  const [rank, setRank] = useState('');
  const candidates = Object.values(s.npcs)
    .filter((n) => !org.members.some((m) => m.npcId === n.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col gap-3">
      {org.members.length ? (
        <ul className="flex flex-col divide-y divide-line">
          {org.members.map((m) => (
            <li key={m.npcId ?? m.name} className="flex min-h-12 items-center gap-3 py-2">
              <button className={cx('min-w-0 flex-1 text-left', m.npcId && 'pressable')} disabled={!m.npcId} onClick={() => m.npcId && open('npcs', m.npcId)}>
                <span className="block truncate text-sm font-medium">
                  {m.name}
                  {org.leaderNpcId && m.npcId === org.leaderNpcId ? <span className="ml-2 text-xs font-normal text-accent-text">Leader</span> : null}
                </span>
                <span className="block truncate text-xs text-fg-2">{m.rank}</span>
              </button>
              <IconButton size="sm" icon={X} label={`Remove ${m.name}`} onClick={() => apply({ type: 'org.member', org: org.id, npc: m.npcId ?? m.name, remove: true } as Op, { quiet: true })} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-3">No known members.</p>
      )}
      <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
        <div className="flex gap-2">
          <Select aria-label="Person" value={npc} onChange={(e) => setNpc(e.target.value)} className="min-w-0 flex-1">
            <option value="">Add a member…</option>
            {candidates.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
          <Input aria-label="Rank" placeholder="Rank" value={rank} onChange={(e) => setRank(e.target.value)} className="w-32" maxLength={60} />
        </div>
        <Button
          variant="secondary"
          icon={Plus}
          disabled={!npc}
          onClick={async () => {
            if (await apply({ type: 'org.member', org: org.id, npc, rank: rank.trim() || undefined } as Op, { quiet: true })) {
              setNpc('');
              setRank('');
            }
          }}
        >
          Add member
        </Button>
      </div>
    </div>
  );
}

function InfluenceTab({ org, state: s, set }: { org: Org; state: CampaignState; set: (p: Record<string, unknown>) => void }) {
  const { apply } = useGame();
  const [loc, setLoc] = useState('');
  const [local, setLocal] = useState(org.influence);
  useEffect(() => setLocal(org.influence), [org.influence]);
  const options = Object.values(s.locations)
    .filter((l) => !org.influence.some((i) => i.locationId === l.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col gap-3">
      {local.length ? (
        <ul className="flex flex-col gap-3">
          {local.map((i) => (
            <li key={i.locationId}>
              <div className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate font-medium">{s.locations[i.locationId]?.name ?? 'Unknown place'}</span>
                <span className="text-xs tabular-nums text-fg-2">{Math.round(i.strength)}</span>
                <IconButton size="sm" icon={X} label="Remove" onClick={() => set({ influence: org.influence.filter((x) => x.locationId !== i.locationId) })} />
              </div>
              <div onPointerUp={() => set({ influence: local })} onKeyUp={() => set({ influence: local })}>
                <Slider label={`Influence in ${s.locations[i.locationId]?.name ?? 'place'}`} value={i.strength} onChange={(v) => setLocal(local.map((x) => (x.locationId === i.locationId ? { ...x, strength: v } : x)))} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-3">No known territory.</p>
      )}
      <div className="flex gap-2">
        <Select aria-label="Place" value={loc} onChange={(e) => setLoc(e.target.value)} className="min-w-0 flex-1">
          <option value="">Add a place…</option>
          {options.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <IconButton
          icon={Plus}
          label="Add place"
          disabled={!loc}
          onClick={async () => {
            if (await apply({ type: 'org.influence', org: org.id, location: loc, strength: 50 } as Op, { quiet: true })) setLoc('');
          }}
        />
      </div>
    </div>
  );
}

function ListEditor({ items, empty, placeholder, onAdd, onRemove }: { items: string[]; empty: string; placeholder: string; onAdd: (t: string) => Promise<unknown>; onRemove: (t: string) => void }) {
  const [text, setText] = useState('');
  const add = async () => {
    if (!text.trim()) return;
    if (await onAdd(text.trim())) setText('');
  };
  return (
    <div className="flex flex-col gap-3">
      {items.length ? (
        <ul className="flex flex-col gap-1">
          {items.map((r) => (
            <li key={r} className="flex items-start gap-2 rounded-md bg-surface-2 py-2 pl-3 pr-1 text-sm">
              <span className="flex-1 pt-1">{r}</span>
              <IconButton size="sm" icon={X} label="Remove" onClick={() => onRemove(r)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-3">{empty}</p>
      )}
      <div className="flex gap-2">
        <Input aria-label={placeholder} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} maxLength={300} className="min-w-0 flex-1" />
        <IconButton icon={Plus} label="Add" disabled={!text.trim()} onClick={add} />
      </div>
    </div>
  );
}

function RunIns({ org, state: s }: { org: Org; state: CampaignState }) {
  const { apply } = useGame();
  const [text, setText] = useState('');
  const list = [...org.runins].sort((a, b) => b.at - a.at);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input aria-label="Note a run-in" placeholder="What happened?" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} className="min-w-0 flex-1" />
        <IconButton
          icon={Plus}
          label="Add run-in"
          disabled={!text.trim()}
          onClick={async () => {
            if (await apply({ type: 'org.runin', org: org.id, text: text.trim() } as Op, { quiet: true })) setText('');
          }}
        />
      </div>
      {list.length ? (
        <ol className="relative flex flex-col gap-4 border-l border-line pl-4">
          {list.map((r) => (
            <li key={r.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
              <p className="text-xs text-fg-3">{formatDate(r.at, s.meta.calendar)}</p>
              <p className="text-sm">{r.text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-fg-3">No encounters recorded.</p>
      )}
    </div>
  );
}
