import type { GroupDTO } from '@everloom/engine';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { post, put } from '@/lib/api';
import { useCharacters } from '@/lib/queries';
import { toastError } from '@/lib/store';
import { Avatar, Button, Checkbox, Field, Input, Segmented, Sheet } from '@/ui';

export function GroupSheet({ open, onOpenChange, group }: { open: boolean; onOpenChange: (o: boolean) => void; group?: GroupDTO | null }) {
  const chars = useCharacters();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [members, setMembers] = useState<GroupDTO['members']>([]);
  const [strategy, setStrategy] = useState<GroupDTO['strategy']>('natural');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setMembers(group?.members ?? []);
    setStrategy(group?.strategy ?? 'natural');
  }, [open, group]);
  const toggle = (id: string, on: boolean) => setMembers((m) => (on ? [...m, { characterId: id, muted: false }] : m.filter((x) => x.characterId !== id)));
  const save = async () => {
    setBusy(true);
    try {
      const body = { name: name.trim() || 'Group', members, strategy };
      if (group) await put(`/api/groups/${group.id}`, body);
      else await post('/api/groups', body);
      await qc.invalidateQueries({ queryKey: ['groups'] });
      onOpenChange(false);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={group ? 'Edit group' : 'New group'}
      size="lg"
      footer={
        <Button variant="primary" size="lg" block disabled={members.length < 2} loading={busy} onClick={save}>
          {group ? 'Save group' : 'Create group'}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Name" htmlFor="gname">
          <Input id="gname" value={name} onChange={(e) => setName(e.target.value)} placeholder="The band" />
        </Field>
        <Field label="Turn order" hint={strategy === 'natural' ? 'Whoever is mentioned speaks next; otherwise by talkativeness.' : strategy === 'list' ? 'Members take turns in order.' : 'You pick who speaks each time.'}>
          <Segmented
            label="Turn order"
            value={strategy}
            onChange={setStrategy}
            options={[
              { value: 'natural', label: 'Natural' },
              { value: 'list', label: 'In order' },
              { value: 'manual', label: 'Manual' },
            ]}
          />
        </Field>
        <div>
          <p className="mb-1 text-sm font-medium">Members</p>
          <div className="flex flex-col">
            {(chars.data ?? []).map((c) => {
              const m = members.find((x) => x.characterId === c.id);
              return (
                <label key={c.id} className="flex min-h-14 cursor-pointer items-center gap-3 py-1.5">
                  <Checkbox checked={!!m} onChange={(v) => toggle(c.id, v)} label={c.name} />
                  <Avatar src={c.avatar} name={c.name} size="sm" />
                  <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
                  {m ? (
                    <button type="button" className="pressable rounded-sm px-2 py-1 text-xs font-medium text-fg-2 hover:bg-surface-2" onClick={(e) => { e.preventDefault(); setMembers((all) => all.map((x) => (x.characterId === c.id ? { ...x, muted: !x.muted } : x))); }}>
                      {m.muted ? 'Muted' : 'Speaks'}
                    </button>
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
