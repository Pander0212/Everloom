/** Character editor › Scripts: the card's own scripts (kept in the card, so they travel with exports). */
import { readBundle, type ScriptInput } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Pencil, Plus, ShieldQuestion, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { get, put } from '@/lib/api';
import { qk } from '@/lib/queries';
import { toastError } from '@/lib/store';
import { Badge, Button, EmptyState, IconButton } from '@/ui';
import { ReviewSheet } from './ReviewSheet';
import { saveJson, ScriptEditor } from './ScriptEditor';
import type { Review } from './types';

export default function CharacterScripts({ characterId, extensions }: { characterId: string; extensions: Record<string, any> }) {
  const qc = useQueryClient();
  const bundle = readBundle(extensions);
  const review = useQuery({ queryKey: ['script-review', 'character', characterId], queryFn: () => get<Review>('/api/scripts/review', { kind: 'character', id: characterId }) });
  const [editing, setEditing] = useState<{ index: number; data: ScriptInput } | 'new' | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const saveAll = async (scripts: ScriptInput[]) => {
    try {
      await put(`/api/scripts/character/${characterId}`, { scripts });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.character(characterId) }), qc.invalidateQueries({ queryKey: ['script-review'] }), qc.invalidateQueries({ queryKey: ['scripts-active'] })]);
    } catch (e) {
      toastError(e);
      throw e;
    }
  };
  const list = bundle.scripts as ScriptInput[];
  const items = review.data?.items ?? [];
  const pending = items.some((i) => !i.granted);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-2">Scripts saved here are part of the card and go with it when you export it. Scripts you write or edit here are approved as you save them.</p>
      {pending ? (
        <div className="flex items-center gap-3 rounded-md bg-warning-soft p-3 text-sm">
          <span className="flex-1">Some of this card’s scripts, rules or message scripts are off.</span>
          <Button size="sm" icon={ShieldQuestion} onClick={() => setReviewOpen(true)}>
            Review
          </Button>
        </div>
      ) : null}
      {!list.length ? <EmptyState title="No scripts" body="Add one to give this character its own buttons, status panels or rules." /> : null}
      <ul className="flex flex-col gap-2" aria-label="Character scripts">
        {list.map((s, i) => {
          const it = items.find((x) => x.type === 'script' && x.name === s.name);
          return (
            <li key={`${s.id}:${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block truncate text-xs text-fg-2">{(s.permissions ?? []).join(', ') || 'No permissions'}</span>
              </span>
              {s.compat ? <Badge>Tavern Helper style</Badge> : null}
              {it ? <Badge tone={it.granted ? 'success' : 'warning'}>{it.granted ? 'On' : 'Off'}</Badge> : null}
              <IconButton size="sm" icon={Pencil} label={`Edit ${s.name}`} onClick={() => setEditing({ index: i, data: s })} />
              <IconButton size="sm" icon={Download} label={`Export ${s.name}`} onClick={() => saveJson(`${s.name}.json`, s)} />
              <IconButton size="sm" icon={Trash2} label={`Delete ${s.name}`} onClick={() => void saveAll(list.filter((_, j) => j !== i))} />
            </li>
          );
        })}
      </ul>
      {bundle.regex.length ? <p className="text-sm text-fg-2">Also in this card: {bundle.regex.length} regex rule{bundle.regex.length === 1 ? '' : 's'} (SillyTavern format).</p> : null}
      <div>
        <Button icon={Plus} onClick={() => setEditing('new')}>
          Add a script
        </Button>
      </div>
      <ScriptEditor
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        initial={editing && editing !== 'new' ? editing.data : null}
        onSave={async (s) => {
          const next = editing && editing !== 'new' ? list.map((x, j) => (j === editing.index ? s : x)) : [...list, s];
          await saveAll(next);
        }}
      />
      <ReviewSheet target={{ kind: 'character', id: characterId }} open={reviewOpen} onOpenChange={setReviewOpen} />
    </div>
  );
}
