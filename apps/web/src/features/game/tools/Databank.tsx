import type { Fact, Op } from '@everloom/engine';
import { formatDate } from '@everloom/engine';
import { useQuery } from '@tanstack/react-query';
import { Database, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { get } from '@/lib/api';
import { cx } from '@/lib/format';
import { Button, EmptyState, Field, Icon, IconButton, Input, Sheet, Textarea } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

export default function Databank() {
  const { state: s, apply, chat } = useGame();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Fact> | null>(null);
  const hits = useQuery({
    queryKey: ['fts', chat.campaignId, q],
    queryFn: () => get<Array<{ kind: string; refId: string; snippet: string; title: string }>>('/api/search', { q, campaignId: chat.campaignId, kinds: 'fact,memory,runin,diary,quest' }),
    enabled: q.trim().length > 2,
  });
  const facts = useMemo(() => Object.values(s?.databank ?? {}).sort((a, b) => b.at - a.at), [s]);
  const tags = useMemo(() => [...new Set(facts.flatMap((f) => f.tags))].slice(0, 16), [facts]);
  if (!s) return <ToolSheet title="Facts"><NoCampaign /></ToolSheet>;
  const n = q.trim().toLowerCase();
  const list = facts.filter((f) => (!tag || f.tags.includes(tag)) && (!n || `${f.title} ${f.text} ${f.tags.join(' ')}`.toLowerCase().includes(n)));
  const others = (hits.data ?? []).filter((h) => h.kind !== 'fact');
  return (
    <ToolSheet
      title="Facts"
      description="What you've learned. The most relevant facts go into the prompt automatically."
      footer={
        <Button variant="secondary" icon={Plus} block onClick={() => setEdit({ text: '', title: '', tags: [] })}>
          Add fact
        </Button>
      }
    >
      <div className="relative">
        <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
        <Input placeholder="Search facts, memories, diary…" aria-label="Search the databank" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
      </div>
      {tags.length ? (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
          {tags.map((t) => (
            <button key={t} onClick={() => setTag(tag === t ? null : t)} className={cx('pressable h-8 flex-none rounded-full px-3 text-xs font-medium', tag === t ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-fg-2')}>
              {t}
            </button>
          ))}
        </div>
      ) : null}
      {list.length ? (
        <div className="mt-3 flex flex-col divide-y divide-line">
          {list.map((f) => (
            <button key={f.id} onClick={() => setEdit(f)} className="pressable py-3 text-left">
              {f.title ? <p className="text-sm font-medium">{f.title}</p> : null}
              <p className="text-sm text-fg">{f.text}</p>
              <p className="mt-1 text-xs text-fg-3">
                {formatDate(f.at, s.meta.calendar, '{mon} {day}')}
                {f.tags.length ? ` · ${f.tags.join(', ')}` : ''}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState icon={Database} title={facts.length ? 'Nothing matches' : 'No facts yet'} body={facts.length ? undefined : 'Facts are collected from the story as you play.'} />
      )}
      {others.length ? (
        <section className="mt-4">
          <h3 className="text-xs font-medium text-fg-3">Elsewhere</h3>
          <div className="flex flex-col divide-y divide-line">
            {others.map((h) => (
              <div key={`${h.kind}${h.refId}`} className="py-2.5">
                <p className="text-xs font-medium capitalize text-fg-2">{h.kind === 'runin' ? `Run-in · ${h.title}` : h.kind}</p>
                <p className="text-sm">{h.snippet.replace(/\[|\]/g, '')}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <Sheet
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={edit?.id ? 'Fact' : 'New fact'}
        size="md"
        footer={
          edit ? (
            <>
              {edit.id ? (
                <IconButton
                  icon={Trash2}
                  label="Delete fact"
                  onClick={async () => {
                    await apply({ type: 'databank.remove', id: edit.id } as Op, { quiet: true });
                    setEdit(null);
                  }}
                />
              ) : null}
              <Button
                variant="primary"
                size="lg"
                className="flex-1"
                disabled={!edit.text?.trim()}
                onClick={async () => {
                  const tagsList = edit.tags ?? [];
                  await apply(edit.id ? ({ type: 'databank.update', id: edit.id, text: edit.text, title: edit.title, tags: tagsList } as Op) : ({ type: 'databank.add', text: edit.text!.trim(), title: edit.title || undefined, tags: tagsList } as Op), { quiet: true });
                  setEdit(null);
                }}
              >
                Save
              </Button>
            </>
          ) : null
        }
      >
        {edit ? (
          <div className="flex flex-col gap-4">
            <Field label="Title" htmlFor="ft">
              <Input id="ft" value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </Field>
            <Field label="Fact" htmlFor="fx">
              <Textarea id="fx" rows={4} value={edit.text ?? ''} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
            </Field>
            <Field label="Tags" htmlFor="fg" hint="Comma separated.">
              <Input id="fg" value={(edit.tags ?? []).join(', ')} onChange={(e) => setEdit({ ...edit, tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
            </Field>
          </div>
        ) : null}
      </Sheet>
    </ToolSheet>
  );
}
