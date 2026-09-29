import type { CampaignState, Op, Relationship } from '@everloom/engine';
import { formatDate, relationshipLabel } from '@everloom/engine';
import { HeartHandshake, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCharacters } from '@/lib/queries';
import { Avatar, Badge, Button, EmptyState, Field, IconButton, Input, Select, Sheet, Slider } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

/** A -100…100 meter that fills from the centre. */
function Bipolar({ label, value }: { label: string; value: number }) {
  const v = Math.max(-100, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 flex-none text-xs text-fg-2">{label}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" role="meter" aria-label={label} aria-valuemin={-100} aria-valuemax={100} aria-valuenow={Math.round(v)}>
        <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
        <span
          className="absolute inset-y-0 w-1/2 rounded-full transition-transform duration-300"
          style={v >= 0 ? { left: '50%', transformOrigin: 'left', transform: `scaleX(${v / 100})`, background: 'var(--accent)' } : { right: '50%', transformOrigin: 'right', transform: `scaleX(${-v / 100})`, background: 'var(--danger)' }}
        />
      </div>
      <span className="w-9 flex-none text-right text-xs tabular-nums text-fg-2">{Math.round(v)}</span>
    </div>
  );
}

export default function Social({ arg }: { arg?: string }) {
  const { state: s, apply } = useGame();
  const chars = useCharacters();
  const [openId, setOpenId] = useState<string | null>(arg ?? null);
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState('');
  const rels = useMemo(() => Object.values(s?.relationships ?? {}).sort((a, b) => b.affection + b.trust - (a.affection + a.trust)), [s]);
  if (!s) return <ToolSheet title="Social"><NoCampaign /></ToolSheet>;
  const rel = openId ? s.relationships[openId] ?? null : null;
  const portrait = (r: Relationship) => {
    const npc = r.npcId ? s.npcs[r.npcId] : null;
    return npc?.portrait ? `/media/${npc.portrait}` : chars.data?.find((c) => c.id === npc?.characterId)?.avatar;
  };
  const candidates = Object.values(s.npcs).filter((n) => !rels.some((r) => r.npcId === n.id));

  return (
    <ToolSheet
      title="Social"
      description={rels.length ? `${rels.length} ${rels.length === 1 ? 'bond' : 'bonds'}` : undefined}
      footer={
        <Button variant="secondary" icon={Plus} block onClick={() => setAdding(true)} disabled={!candidates.length}>
          Track someone
        </Button>
      }
    >
      {rels.length ? (
        <div className="flex flex-col">
          {rels.map((r) => (
            <button key={r.id} onClick={() => setOpenId(r.id)} className="pressable -mx-2 flex items-center gap-3 rounded-md px-2 py-3 text-left hover:bg-surface-2">
              <Avatar src={portrait(r)} name={r.name} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{r.name}</span>
                  <Badge tone={r.affection < -25 ? 'danger' : r.affection >= 45 ? 'accent' : 'neutral'}>{r.label || relationshipLabel(r)}</Badge>
                </span>
                <span className="mt-1.5 flex flex-col gap-1">
                  <Bipolar label="Affection" value={r.affection} />
                  <Bipolar label="Trust" value={r.trust} />
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState icon={HeartHandshake} title="No bonds yet" body="How people feel about you is tracked here as the story unfolds." />
      )}

      <RelSheet rel={rel} state={s} onClose={() => setOpenId(null)} />

      <Sheet
        open={adding}
        onOpenChange={setAdding}
        title="Track someone"
        size="md"
        footer={
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!who}
            onClick={async () => {
              if (await apply({ type: 'relationship.delta', name: who, affection: 0, trust: 0 } as Op, { quiet: true })) {
                setAdding(false);
                setWho('');
              }
            }}
          >
            Add
          </Button>
        }
      >
        <Field label="Person" htmlFor="soc-who">
          <Select id="soc-who" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Choose…</option>
            {candidates.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
        </Field>
      </Sheet>
    </ToolSheet>
  );
}

function RelSheet({ rel, state: s, onClose }: { rel: Relationship | null; state: CampaignState; onClose: () => void }) {
  const { apply } = useGame();
  const [draft, setDraft] = useState<{ id: string; a: number; t: number } | null>(null);
  const [note, setNote] = useState('');
  if (!rel) return <Sheet open={false} onOpenChange={onClose} title="">{null}</Sheet>;
  const a = draft?.id === rel.id ? draft.a : rel.affection;
  const t = draft?.id === rel.id ? draft.t : rel.trust;
  const dirty = a !== rel.affection || t !== rel.trust;
  const key = rel.npcId ?? rel.name;
  const memories = [...rel.memories].sort((x, y) => y.at - x.at);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && (setDraft(null), onClose())}
      title={rel.name}
      description={rel.label || relationshipLabel(rel)}
      size="lg"
      footer={
        dirty ? (
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Reset
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={async () => {
                if (await apply({ type: 'relationship.delta', name: key, affection: a - rel.affection, trust: t - rel.trust } as Op)) setDraft(null);
              }}
            >
              Save
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <Field label={`Affection · ${Math.round(a)}`}>
            <Slider label="Affection" min={-100} max={100} value={a} onChange={(v) => setDraft({ id: rel.id, a: v, t })} />
          </Field>
          <Field label={`Trust · ${Math.round(t)}`}>
            <Slider label="Trust" min={-100} max={100} value={t} onChange={(v) => setDraft({ id: rel.id, a, t: v })} />
          </Field>
          {dirty ? <p className="text-xs text-fg-2">Would read as “{relationshipLabel({ affection: a, trust: t })}”.</p> : null}
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">Memories</h3>
          <div className="mb-3 flex gap-2">
            <Input aria-label="Add a memory" placeholder="Something to remember together" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="min-w-0 flex-1" />
            <IconButton
              icon={Plus}
              label="Add memory"
              disabled={!note.trim()}
              onClick={async () => {
                if (await apply({ type: 'relationship.memory', name: key, text: note.trim() } as Op, { quiet: true })) setNote('');
              }}
            />
          </div>
          {memories.length ? (
            <ol className="relative flex flex-col gap-4 border-l border-line pl-4">
              {memories.map((m) => (
                <li key={m.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                  <p className="text-xs text-fg-3">{formatDate(m.at, s.meta.calendar)}</p>
                  <p className="text-sm">{m.text}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-fg-3">No shared memories yet.</p>
          )}
        </div>
      </div>
    </Sheet>
  );
}
