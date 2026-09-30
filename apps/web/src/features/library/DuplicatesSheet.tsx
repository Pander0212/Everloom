import type { CharacterSummary } from '@everloom/engine';
import { useQuery } from '@tanstack/react-query';
import { CopyCheck } from 'lucide-react';
import { useState } from 'react';
import { get, post } from '@/lib/api';
import { cx, relativeTime } from '@/lib/format';
import { toast, toastError } from '@/lib/store';
import { Avatar, Badge, Button, confirm, EmptyState, Sheet, Spinner } from '@/ui';

interface Group {
  ids: string[];
  reason: 'identical' | 'same name and creator' | 'similar';
  score: number;
  characters: CharacterSummary[];
}

/** Likely duplicates, one group at a time: pick the one to keep; chats move to it. */
export function DuplicatesSheet({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const q = useQuery({ queryKey: ['duplicates', open], queryFn: () => get<Group[]>('/api/library/duplicates'), enabled: open });
  const [keep, setKeep] = useState<Record<number, string>>({});
  const merge = async (g: Group, i: number) => {
    const k = keep[i] ?? g.ids[0];
    const others = g.ids.filter((x) => x !== k);
    if (!(await confirm({ title: `Keep one, remove ${others.length}?`, description: 'Chats move to the one you keep. You can undo for a day.', confirmLabel: 'Merge' }))) return;
    try {
      const r = await post<{ moved: number; undoId?: string }>('/api/library/duplicates/merge', { keep: k, remove: others });
      toast({ title: 'Merged', lines: r.moved ? [`${r.moved} chats moved`] : undefined, tone: 'success', action: r.undoId ? { label: 'Undo', run: () => void post(`/api/library/undo/${r.undoId}`).then(onDone) } : undefined });
      onDone();
      await q.refetch();
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Duplicates" description="Same content, the same name and creator, or a very similar name and description." size="lg">
      {q.isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : !q.data?.length ? (
        <EmptyState icon={CopyCheck} title="No duplicates" />
      ) : (
        <div className="flex flex-col gap-4">
          {q.data.map((g, i) => (
            <section key={g.ids.join()} className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-2">
                <Badge tone={g.reason === 'identical' ? 'warning' : 'neutral'}>{g.reason}</Badge>
                <span className="flex-1" />
                <Button size="sm" variant="secondary" onClick={() => merge(g, i)}>Keep selected</Button>
              </div>
              <div role="radiogroup" aria-label="Which one to keep" className="mt-2 flex flex-col gap-1">
                {g.characters.map((c) => {
                  const on = (keep[i] ?? g.ids[0]) === c.id;
                  return (
                    <button key={c.id} type="button" role="radio" aria-checked={on} onClick={() => setKeep((k) => ({ ...k, [i]: c.id }))} className={cx('pressable flex items-center gap-3 rounded-md p-2 text-left', on ? 'bg-accent-soft' : 'hover:bg-surface-2')}>
                      <Avatar src={c.avatar} name={c.name} size="md" shape="rounded" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-fg-2">{[c.creator && `by ${c.creator}`, `${c.tokens} tokens`, `${c.chatCount} chats`, `edited ${relativeTime(c.updatedAt)}`].filter(Boolean).join(' · ')}</span>
                      </span>
                      {on ? <Badge tone="accent">keep</Badge> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}
