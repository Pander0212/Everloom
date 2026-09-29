import type { LineageMember } from '@everloom/engine';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCharacters } from '@/lib/queries';
import { cx } from '@/lib/format';
import { Avatar, Button, Dialog, Field, IconButton, Input, Select } from '@/ui';

export const RELATIONS = ['Parent', 'Child', 'Sibling', 'Spouse/Partner', 'Grandparent', 'Grandchild', 'Aunt', 'Uncle', 'Cousin', 'Guardian', 'Step-family', 'Childhood Friend', 'Other'];

const GENERATION: Record<string, number> = {
  Grandparent: -2,
  Parent: -1,
  Aunt: -1,
  Uncle: -1,
  Guardian: -1,
  'Step-family': -1,
  Sibling: 0,
  'Spouse/Partner': 0,
  Cousin: 0,
  'Childhood Friend': 0,
  Other: 0,
  Child: 1,
  Grandchild: 2,
};

const GEN_LABEL: Record<number, string> = { [-2]: 'Grandparents', [-1]: 'Parents & elders', 0: 'Your generation', 1: 'Children', 2: 'Grandchildren' };

/** A clean generational family tree: one row per generation, the persona in the middle row. */
export function LineageEditor({ personaName, members, onChange }: { personaName: string; members: LineageMember[]; onChange: (m: LineageMember[]) => void }) {
  const chars = useCharacters();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('Parent');
  const avatars = useMemo(() => new Map((chars.data ?? []).map((c) => [c.id, c.avatar])), [chars.data]);
  const rows = useMemo(() => {
    const byGen = new Map<number, LineageMember[]>();
    for (const m of members) {
      const g = GENERATION[m.relation] ?? 0;
      if (!byGen.has(g)) byGen.set(g, []);
      byGen.get(g)!.push(m);
    }
    const gens = [...new Set([...byGen.keys(), 0])].sort((a, b) => a - b);
    return gens.map((g) => ({ gen: g, members: byGen.get(g) ?? [] }));
  }, [members]);

  const add = () => {
    const ch = chars.data?.find((c) => c.id === pick);
    const n = ch?.name ?? name.trim();
    if (!n) return;
    onChange([...members, { id: `lin_${Date.now().toString(36)}`, name: n, relation, characterId: ch?.id ?? null }]);
    setOpen(false);
    setPick('');
    setName('');
  };

  return (
    <div>
      <div className="flex flex-col items-stretch">
        {rows.map((row, i) => (
          <div key={row.gen} className="relative">
            {i > 0 ? <div className="mx-auto h-5 w-px bg-line-strong" aria-hidden="true" /> : null}
            <p className="mb-2 text-center text-xs font-medium text-fg-3">{GEN_LABEL[row.gen] ?? ''}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {row.gen === 0 ? <Node name={personaName} relation="You" highlight /> : null}
              {row.members.map((m) => (
                <Node key={m.id} name={m.name} relation={m.relation} avatar={m.characterId ? avatars.get(m.characterId) : null} onRemove={() => onChange(members.filter((x) => x.id !== m.id))} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex justify-center">
        <Button variant="secondary" icon={Plus} onClick={() => setOpen(true)}>
          Add family member
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add lineage member"
        description="Pick an existing character or type a new name, then say who they are to you."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={add} disabled={!pick && !name.trim()}>
              Add member
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Existing character" htmlFor="lpick">
            <Select id="lpick" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">None</option>
              {(chars.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {!pick ? (
            <Field label="Or a new name" htmlFor="lname">
              <Input id="lname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
            </Field>
          ) : null}
          <Field label="Relationship to you" htmlFor="lrel">
            <Select id="lrel" value={relation} onChange={(e) => setRelation(e.target.value)}>
              {RELATIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

function Node({ name, relation, avatar, highlight, onRemove }: { name: string; relation: string; avatar?: string | null; highlight?: boolean; onRemove?: () => void }) {
  return (
    <div className={cx('group flex min-w-[132px] items-center gap-2.5 rounded-md py-2 pl-2 pr-1', highlight ? 'bg-accent-soft' : 'bg-surface-2')}>
      <Avatar src={avatar} name={name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-fg-2">{relation}</p>
      </div>
      {onRemove ? <IconButton size="sm" icon={Trash2} label={`Remove ${name}`} onClick={onRemove} /> : <span className="w-2" />}
    </div>
  );
}
