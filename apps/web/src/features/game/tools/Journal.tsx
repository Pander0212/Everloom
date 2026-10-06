import type { Op, Quest } from '@everloom/engine';
import { formatDate } from '@everloom/engine';
import { BookMarked, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button, Checkbox, confirm, Dialog, EmptyState, Field, IconButton, Input, Segmented, Sheet, Textarea } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

export default function Journal() {
  const { state: s, apply } = useGame();
  const [tab, setTab] = useState<'active' | 'done' | 'failed'>('active');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ title: '', desc: '', objectives: '' });
  const [newObj, setNewObj] = useState('');
  if (!s) return <ToolSheet title="Journal"><NoCampaign /></ToolSheet>;
  const quests = Object.values(s.quests).filter((q) => q.status === tab).sort((a, b) => b.updatedAt - a.updatedAt);
  const q: Quest | null = openId ? s.quests[openId] ?? null : null;
  return (
    <ToolSheet
      title="Journal"
      footer={
        <Button variant="secondary" icon={Plus} block onClick={() => setAdding(true)}>
          New quest
        </Button>
      }
    >
      <Segmented
        label="Quest status"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'active', label: `Active (${Object.values(s.quests).filter((x) => x.status === 'active').length})` },
          { value: 'done', label: 'Completed' },
          { value: 'failed', label: 'Failed' },
        ]}
      />
      {quests.length ? (
        <div className="mt-3 flex flex-col divide-y divide-line">
          {quests.map((x) => {
            const done = x.objectives.filter((o) => o.done).length;
            const next = x.objectives.find((o) => !o.done);
            return (
              <button key={x.id} onClick={() => setOpenId(x.id)} className="pressable py-3 text-left">
                <p className="text-sm font-medium">{x.title}</p>
                <p className="mt-0.5 truncate text-xs text-fg-2">
                  {next ? `Next: ${next.text}` : x.desc || 'No objectives'}
                  {x.objectives.length ? ` · ${done}/${x.objectives.length}` : ''}
                </p>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={BookMarked} art="quests" title={tab === 'active' ? 'No active quests' : 'Nothing here yet'} body={tab === 'active' ? 'Goals from the story are tracked here.' : undefined} />
      )}
      <Sheet
        open={!!q}
        onOpenChange={(o) => !o && setOpenId(null)}
        title={q?.title ?? ''}
        description={q ? `Started ${formatDate(q.createdAt, s.meta.calendar, '{mon} {day}')}${q.giver ? ` · from ${q.giver}` : ''}` : undefined}
        size="md"
        footer={
          q ? (
            <>
              <Button
                variant="quiet"
                icon={Trash2}
                aria-label="Delete quest"
                onClick={async () => {
                  if (!(await confirm({ title: 'Delete this quest?', confirmLabel: 'Delete', danger: true }))) return;
                  await apply({ type: 'quest.remove', title: q.id } as Op, { quiet: true });
                  setOpenId(null);
                }}
              />
              {q.status === 'active' ? (
                <>
                  <Button variant="secondary" className="flex-1" onClick={() => apply({ type: 'quest.update', title: q.title, status: 'failed' } as Op)}>
                    Mark failed
                  </Button>
                  <Button variant="primary" className="flex-1" onClick={() => apply({ type: 'quest.update', title: q.title, status: 'done' } as Op)}>
                    Complete
                  </Button>
                </>
              ) : (
                <Button variant="secondary" className="flex-1" onClick={() => apply({ type: 'quest.update', title: q.title, status: 'active' } as Op)}>
                  Reopen
                </Button>
              )}
            </>
          ) : null
        }
      >
        {q ? (
          <div className="flex flex-col gap-4">
            {q.desc ? <p className="text-sm text-fg-2">{q.desc}</p> : null}
            {q.reward ? <p className="text-sm">Reward: {q.reward}</p> : null}
            <div className="flex flex-col">
              {q.objectives.map((o) => (
                <label key={o.id} className="flex min-h-11 items-center gap-3 text-sm">
                  <Checkbox checked={o.done} onChange={(v) => apply({ type: 'quest.update', title: q.title, objective: o.text, done: v } as Op, { quiet: true })} label={o.text} />
                  <span className={o.done ? 'text-fg-3 line-through' : ''}>{o.text}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={newObj} onChange={(e) => setNewObj(e.target.value)} placeholder="Add an objective" aria-label="New objective" />
              <IconButton
                icon={Plus}
                label="Add objective"
                disabled={!newObj.trim()}
                onClick={async () => {
                  await apply({ type: 'quest.update', title: q.title, addObjective: newObj.trim() } as Op, { quiet: true });
                  setNewObj('');
                }}
              />
            </div>
          </div>
        ) : null}
      </Sheet>
      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="New quest"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!draft.title.trim()}
              onClick={async () => {
                await apply({ type: 'quest.add', title: draft.title.trim(), desc: draft.desc, objectives: draft.objectives.split('\n').map((x) => x.trim()).filter(Boolean) } as Op);
                setAdding(false);
                setDraft({ title: '', desc: '', objectives: '' });
              }}
            >
              Add quest
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Title" htmlFor="qt">
            <Input id="qt" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </Field>
          <Field label="Description" htmlFor="qd">
            <Textarea id="qd" rows={2} value={draft.desc} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} />
          </Field>
          <Field label="Objectives" htmlFor="qo" hint="One per line.">
            <Textarea id="qo" rows={3} value={draft.objectives} onChange={(e) => setDraft({ ...draft, objectives: e.target.value })} />
          </Field>
        </div>
      </Dialog>
    </ToolSheet>
  );
}
