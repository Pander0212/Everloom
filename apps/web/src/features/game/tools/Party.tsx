import type { EquipSlot, Op, PartyMember } from '@everloom/engine';
import { UserPlus, UsersRound, X } from 'lucide-react';
import { useState } from 'react';
import { useCharacters } from '@/lib/queries';
import { Avatar, Button, confirm, EmptyState, Field, IconButton, Input, Select, Sheet, StatBar } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

const SLOTS: EquipSlot[] = ['weapon', 'offhand', 'head', 'body', 'hands', 'legs', 'feet', 'back', 'accessory'];

export default function Party() {
  const { state: s, apply } = useGame();
  const chars = useCharacters();
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState('');
  const [role, setRole] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  if (!s) return <ToolSheet title="Party"><NoCampaign /></ToolSheet>;
  const members = Object.values(s.party);
  const open = openId ? s.party[openId] ?? null : null;
  const candidates = Object.values(s.npcs).filter((n) => n.status === 'alive' && !members.some((m) => m.npcId === n.id));
  const portrait = (m: PartyMember) => {
    const npc = m.npcId ? s.npcs[m.npcId] : null;
    return npc?.portrait ? `/media/${npc.portrait}` : chars.data?.find((c) => c.id === (m.characterId ?? npc?.characterId))?.avatar;
  };

  return (
    <ToolSheet
      title="Party"
      description={members.length ? `${members.length} ${members.length === 1 ? 'companion' : 'companions'}` : undefined}
      footer={
        <Button variant="secondary" icon={UserPlus} block onClick={() => setAdding(true)}>
          Add companion
        </Button>
      }
    >
      {members.length ? (
        <div className="flex flex-col gap-2">
          {members.map((m) => (
            <button key={m.id} onClick={() => setOpenId(m.id)} className="pressable flex items-center gap-3 rounded-md border border-line px-3 py-2.5 text-left hover:bg-surface-2">
              <Avatar src={portrait(m)} name={m.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{m.name}</span>
                <span className="block truncate text-xs text-fg-2">{[m.role, `Level ${m.level}`].filter(Boolean).join(' · ')}</span>
                <span className="mt-1.5 grid grid-cols-2 gap-2">
                  <StatBar label="HP" value={m.hp} max={m.maxHp} tone="danger" compact />
                  <StatBar label="MP" value={m.mp} max={m.maxMp} tone="accent" compact />
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState icon={UsersRound} title="Travelling alone" body="Companions fight beside you and show up in battles." />
      )}

      <Sheet
        open={!!open}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={open?.name ?? ''}
        description={open ? `Level ${open.level}` : undefined}
        size="md"
        headerActions={
          open ? (
            <IconButton
              icon={X}
              label="Leave party"
              onClick={async () => {
                if (!(await confirm({ title: `${open.name} leaves the party?`, confirmLabel: 'Remove', danger: true }))) return;
                if (await apply({ type: 'party.remove', name: open.name } as Op)) setOpenId(null);
              }}
            />
          ) : null
        }
      >
        {open ? (
          <div className="flex flex-col gap-4">
            <Field label="Role" htmlFor="pm-role">
              <Input id="pm-role" defaultValue={open.role} key={open.id} maxLength={60} onBlur={(e) => e.target.value.trim() !== open.role && apply({ type: 'party.update', name: open.name, role: e.target.value.trim() } as Op, { quiet: true })} />
            </Field>
            <div className="grid grid-cols-4 gap-2 text-center text-sm">
              {(['atk', 'def', 'spd', 'mag'] as const).map((k) => (
                <div key={k} className="rounded-md bg-surface-2 py-2">
                  <div className="text-xs uppercase text-fg-3">{k}</div>
                  <div className="font-semibold tabular-nums">{open.stats[k]}</div>
                </div>
              ))}
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Equipment</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SLOTS.map((slot) => {
                  const options = Object.values(s.inventory).filter((i) => i.slot === slot || (!i.slot && ['weapon', 'armor', 'clothing', 'accessory'].includes(i.category)));
                  return (
                    <Field key={slot} label={slot[0].toUpperCase() + slot.slice(1)} htmlFor={`eq-${slot}`}>
                      <Select id={`eq-${slot}`} value={open.equipment[slot] ?? ''} onChange={(e) => apply({ type: 'party.update', name: open.name, equip: { slot, item: e.target.value || null } } as Op, { quiet: true })}>
                        <option value="">Nothing</option>
                        {open.equipment[slot] && !options.some((i) => i.name === open.equipment[slot]) ? <option value={open.equipment[slot]}>{open.equipment[slot]}</option> : null}
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
            </div>
          </div>
        ) : null}
      </Sheet>

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
