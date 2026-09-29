import type { Npc, Op, ScheduleSlot } from '@everloom/engine';
import { currentSlot, findDuplicateNpcs, relationshipLabel } from '@everloom/engine';
import { ArrowLeftRight, Contact, Lock, LockOpen, Merge, Plus, Search, Sparkles, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { post } from '@/lib/api';
import { useImageGen } from '@/lib/imagegen';
import { useCharacters } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Avatar, Badge, Button, confirm, EmptyState, Field, Icon, IconButton, Input, Select, Sheet, Textarea, ToggleRow } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

function minToClock(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function clockToMin(v: string) {
  const [h, m] = v.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export default function Npcs({ arg }: { arg?: string }) {
  const { state: s, apply, chat } = useGame();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(arg ?? null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [fromCard, setFromCard] = useState('');
  const chars = useCharacters();
  const npcs = useMemo(() => Object.values(s?.npcs ?? {}).sort((a, b) => b.lastSeenAt - a.lastSeenAt), [s]);
  const dupes = useMemo(() => (s ? findDuplicateNpcs(s) : []), [s]);
  if (!s) return <ToolSheet title="NPCs"><NoCampaign /></ToolSheet>;
  const n = q.trim().toLowerCase();
  const list = n ? npcs.filter((x) => x.name.toLowerCase().includes(n) || x.role.toLowerCase().includes(n) || x.aliases.some((a) => a.toLowerCase().includes(n))) : npcs;
  const npc = openId ? s.npcs[openId] : null;
  const where = (x: Npc) => (x.locationId ? s.locations[x.locationId]?.name : null);

  return (
    <ToolSheet
      title="NPCs"
      description={`${npcs.length} known`}
      footer={
        <Button variant="secondary" icon={UserPlus} block onClick={() => setAdding(true)}>
          Add NPC
        </Button>
      }
    >
      {dupes.length ? (
        <div className="mb-3 rounded-md bg-warning-soft px-3 py-2.5 text-sm">
          <p className="font-medium text-fg">Possible duplicates</p>
          {dupes.map((g) => (
            <div key={g.join()} className="mt-1.5 flex items-center gap-2">
              <span className="flex-1 truncate text-fg-2">{g.map((id) => s.npcs[id]?.name).join(' · ')}</span>
              <Button
                size="sm"
                variant="secondary"
                icon={Merge}
                onClick={async () => {
                  for (const from of g.slice(1)) await apply({ type: 'npc.merge', into: g[0], from } as Op);
                }}
              >
                Merge
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="relative">
        <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
        <Input placeholder="Search people" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
      </div>
      {list.length ? (
        <div className="mt-2 flex flex-col">
          {list.map((x) => {
            const rel = Object.values(s.relationships).find((r) => r.npcId === x.id);
            const here = x.locationId && x.locationId === s.currentLocationId;
            return (
              <button key={x.id} onClick={() => setOpenId(x.id)} className="pressable -mx-2 flex min-h-16 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-2">
                <Avatar src={x.portrait ? `/media/${x.portrait}` : chars.data?.find((c) => c.id === x.characterId)?.avatar} name={x.name} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{x.name}</span>
                    {x.locked ? <Icon icon={Lock} size={13} className="flex-none text-fg-3" /> : null}
                    {x.status !== 'alive' ? <Badge tone="danger">{x.status}</Badge> : null}
                  </span>
                  <span className="block truncate text-xs text-fg-2">
                    {[x.title || (x.role !== 'NPC' ? x.role : ''), where(x), rel ? relationshipLabel(rel) : ''].filter(Boolean).join(' · ') || 'Unknown whereabouts'}
                  </span>
                </span>
                {here ? <Badge tone="accent">Here</Badge> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Users} title={npcs.length ? 'Nobody matches' : 'No one met yet'} body={npcs.length ? undefined : 'People appear here as they show up in the story.'} />
      )}

      <NpcEditor npc={npc} onClose={() => setOpenId(null)} />

      <Sheet
        open={adding}
        onOpenChange={setAdding}
        title="Add NPC"
        size="md"
        footer={
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!newName.trim() && !fromCard}
            onClick={async () => {
              if (fromCard) {
                try {
                  await post(`/api/campaigns/${chat.campaignId}/npcs/from-character`, { chatId: chat.id, characterId: fromCard });
                  toast({ title: 'Added from character card', tone: 'success' });
                } catch (e) {
                  toastError(e);
                }
              } else await apply({ type: 'npc.upsert', name: newName.trim(), location: s.currentLocationId ? s.locations[s.currentLocationId]?.name : undefined } as Op);
              setAdding(false);
              setNewName('');
              setFromCard('');
            }}
          >
            Add
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor="nn">
            <Input id="nn" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={!!fromCard} />
          </Field>
          <Field label="Or from a character card" htmlFor="nc">
            <Select id="nc" value={fromCard} onChange={(e) => setFromCard(e.target.value)}>
              <option value="">None</option>
              {(chars.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Sheet>
    </ToolSheet>
  );
}

function NpcEditor({ npc, onClose }: { npc: Npc | null; onClose: () => void }) {
  const { state: s, apply, chat } = useGame();
  const navigate = useNavigate();
  const gen = useImageGen();
  const [d, setD] = useState<Npc | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  if (npc && npc.id !== lastId) {
    setLastId(npc.id);
    setD(structuredClone(npc));
  }
  if (!npc && lastId) {
    setLastId(null);
    setD(null);
  }
  if (!s) return null;
  const set = (p: Partial<Npc>) => setD((x) => (x ? { ...x, ...p } : x));
  const locations = Object.values(s.locations).sort((a, b) => a.name.localeCompare(b.name));
  const orgs = Object.values(s.orgs);
  const slot = d ? currentSlot(d, s.time.minutes, s) : null;
  const save = async () => {
    if (!d || !npc) return;
    const r = await apply(
      {
        type: 'npc.set',
        id: npc.id,
        patch: {
          name: d.name,
          aliases: d.aliases,
          role: d.role,
          title: d.title,
          age: d.age,
          locationId: d.locationId,
          appearance: d.appearance,
          personality: d.personality,
          notes: d.notes,
          rumors: d.rumors,
          secrets: d.secrets,
          orgs: d.orgs,
          status: d.status,
          phone: d.phone,
          locked: d.locked,
          schedule: d.schedule.map((x) => ({ id: x.id, days: x.days, from: x.from, to: x.to, activity: x.activity, locationId: x.locationId })),
        },
      } as Op,
      { quiet: true },
    );
    if (r) {
      toast({ title: 'Saved', tone: 'success' });
      onClose();
    }
  };
  const list = (label: string, key: 'rumors' | 'secrets') =>
    d ? (
      <Field label={label}>
        <div className="flex flex-col gap-1.5">
          {d[key].map((r, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`${label} ${i + 1}`} value={r} onChange={(e) => set({ [key]: d[key].map((x, j) => (j === i ? e.target.value : x)) } as Partial<Npc>)} />
              <IconButton icon={X} label="Remove" onClick={() => set({ [key]: d[key].filter((_, j) => j !== i) } as Partial<Npc>)} />
            </div>
          ))}
          <div>
            <Button size="sm" variant="quiet" icon={Plus} onClick={() => set({ [key]: [...d[key], ''] } as Partial<Npc>)}>
              Add
            </Button>
          </div>
        </div>
      </Field>
    ) : null;
  return (
    <Sheet
      open={!!npc}
      onOpenChange={(o) => !o && onClose()}
      title={npc?.name ?? ''}
      description={slot ? `Now: ${slot.activity}` : npc?.role}
      size="lg"
      headerActions={d ? <IconButton icon={d.locked ? Lock : LockOpen} label={d.locked ? 'Unlock (let the story change them)' : 'Lock (story can’t change them)'} active={d.locked} onClick={() => set({ locked: !d.locked })} /> : null}
      footer={
        <>
          <Button
            variant="quiet"
            icon={Trash2}
            aria-label="Remove NPC"
            onClick={async () => {
              if (!npc || !(await confirm({ title: `Remove ${npc.name}?`, confirmLabel: 'Remove', danger: true }))) return;
              await apply({ type: 'npc.remove', name: npc.id } as Op);
              onClose();
            }}
          />
          <Button variant="primary" size="lg" className="flex-1" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      {d && npc ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Avatar src={npc.portrait ? `/media/${npc.portrait}` : undefined} name={npc.name} size="lg" />
            <Button
              size="sm"
              variant="secondary"
              icon={Sparkles}
              loading={gen.busy === 'npc'}
              onClick={async () => {
                // Portrait uses the saved appearance; save edits first if any.
                if (d.appearance !== npc.appearance) await apply({ type: 'npc.set', id: npc.id, patch: { appearance: d.appearance } } as Op, { quiet: true });
                const r = await gen.run({ kind: 'npc', chatId: chat.id, npcId: npc.id });
                if (r) await apply({ type: 'npc.set', id: npc.id, patch: { portrait: r.id } } as Op, { quiet: true });
              }}
            >
              Draw portrait
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" htmlFor="npn">
              <Input id="npn" value={d.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Role" htmlFor="npr">
              <Input id="npr" value={d.role} onChange={(e) => set({ role: e.target.value })} />
            </Field>
            <Field label="Title" htmlFor="npt">
              <Input id="npt" value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="Store owner, barrier guardian…" />
            </Field>
            <Field label="Age" htmlFor="npa">
              <Input id="npa" type="number" min={0} value={d.age ?? ''} onChange={(e) => set({ age: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Also known as" htmlFor="npal" hint="Comma separated. Used to recognize them in the story.">
            <Input id="npal" value={d.aliases.join(', ')} onChange={(e) => set({ aliases: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Location" htmlFor="npl">
              <Select id="npl" value={d.locationId ?? ''} onChange={(e) => set({ locationId: e.target.value || null })}>
                <option value="">Unknown</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status" htmlFor="nps">
              <Select id="nps" value={d.status} onChange={(e) => set({ status: e.target.value as Npc['status'] })}>
                <option value="alive">Alive</option>
                <option value="missing">Missing</option>
                <option value="dead">Dead</option>
              </Select>
            </Field>
          </div>
          <Field label="Appearance" htmlFor="npap">
            <Textarea id="npap" rows={3} value={d.appearance} onChange={(e) => set({ appearance: e.target.value })} />
          </Field>
          <Field label="Personality" htmlFor="nppe">
            <Textarea id="nppe" rows={3} value={d.personality} onChange={(e) => set({ personality: e.target.value })} />
          </Field>
          <Field label="Organizations">
            <div className="flex flex-col gap-1.5">
              {d.orgs.map((o, i) => (
                <div key={i} className="flex gap-2">
                  <Select aria-label="Organization" value={o.orgId} onChange={(e) => set({ orgs: d.orgs.map((x, j) => (j === i ? { ...x, orgId: e.target.value } : x)) })}>
                    {orgs.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                  <Input aria-label="Rank" value={o.rank} onChange={(e) => set({ orgs: d.orgs.map((x, j) => (j === i ? { ...x, rank: e.target.value } : x)) })} className="max-w-[140px]" />
                  <IconButton icon={X} label="Remove" onClick={() => set({ orgs: d.orgs.filter((_, j) => j !== i) })} />
                </div>
              ))}
              {orgs.length ? (
                <div>
                  <Button size="sm" variant="quiet" icon={Plus} onClick={() => set({ orgs: [...d.orgs, { orgId: orgs[0].id, rank: 'Member' }] })}>
                    Add membership
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-fg-2">No organizations yet.</p>
              )}
            </div>
          </Field>
          {list('Rumors they spread', 'rumors')}
          {list('Secrets', 'secrets')}
          <ScheduleEditor schedule={d.schedule} onChange={(schedule) => set({ schedule })} locations={locations} weekdays={s.meta.calendar.weekdays} />
          <Field label="Notes" htmlFor="npno">
            <Textarea id="npno" rows={3} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
          <div className="flex flex-col divide-y divide-line">
            <ToggleRow label="Has your number" description="Can text you on the in-game phone." checked={d.phone} onChange={(v) => set({ phone: v })} />
          </div>
          {npc.knownRumors.length ? (
            <Field label="Has heard">
              <ul className="list-disc pl-5 text-sm text-fg-2">
                {npc.knownRumors.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </Field>
          ) : null}
          <div className="flex flex-wrap gap-2 pt-1">
            {npc.characterId ? (
              <Button variant="secondary" icon={Contact} onClick={() => navigate(`/characters/${npc.characterId}`)}>
                Open character card
              </Button>
            ) : (
              <Button
                variant="secondary"
                icon={ArrowLeftRight}
                onClick={async () => {
                  try {
                    const c = await post(`/api/campaigns/${chat.campaignId}/npcs/${npc.id}/to-character`, { chatId: chat.id });
                    toast({ title: `${c.name} is now a character card`, tone: 'success', action: { label: 'Open', run: () => navigate(`/characters/${c.id}`) } });
                  } catch (e) {
                    toastError(e);
                  }
                }}
              >
                Make a character card
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

function ScheduleEditor({ schedule, onChange, locations, weekdays }: { schedule: ScheduleSlot[]; onChange: (s: ScheduleSlot[]) => void; locations: Array<{ id: string; name: string }>; weekdays: string[] }) {
  const upd = (i: number, p: Partial<ScheduleSlot>) => onChange(schedule.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Field label="Schedule" hint="Where they are and what they do. The world simulation moves them as time passes.">
      <div className="flex flex-col gap-3">
        {schedule.map((sl, i) => (
          <div key={i} className="rounded-md bg-surface-2 p-3">
            <div className="flex gap-2">
              <Input aria-label="From" type="time" value={minToClock(sl.from)} onChange={(e) => upd(i, { from: clockToMin(e.target.value) })} />
              <Input aria-label="To" type="time" value={minToClock(sl.to)} onChange={(e) => upd(i, { to: clockToMin(e.target.value) })} />
              <IconButton icon={X} label="Remove slot" onClick={() => onChange(schedule.filter((_, j) => j !== i))} />
            </div>
            <Input aria-label="Activity" className="mt-2" value={sl.activity} placeholder="Rehearsing" onChange={(e) => upd(i, { activity: e.target.value })} />
            <Select aria-label="Where" className="mt-2" value={sl.locationId ?? ''} onChange={(e) => upd(i, { locationId: e.target.value || null })}>
              <option value="">Wherever they are</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
            <div className="mt-2 flex flex-wrap gap-1">
              {weekdays.map((w, wi) => {
                const on = sl.days.includes(wi);
                return (
                  <button key={w} type="button" onClick={() => upd(i, { days: on ? sl.days.filter((x) => x !== wi) : [...sl.days, wi].sort() })} className={`h-7 rounded-sm px-2 text-xs ${on ? 'bg-accent-soft font-medium text-accent-text' : 'bg-surface-3 text-fg-2'}`}>
                    {w.slice(0, 3)}
                  </button>
                );
              })}
              {!sl.days.length ? <span className="self-center pl-1 text-xs text-fg-3">Every day</span> : null}
            </div>
          </div>
        ))}
        <div>
          <Button size="sm" variant="quiet" icon={Plus} onClick={() => onChange([...schedule, { id: `slot_${Date.now().toString(36)}`, days: [], from: 9 * 60, to: 17 * 60, activity: '', locationId: null }])}>
            Add time slot
          </Button>
        </div>
      </div>
    </Field>
  );
}
