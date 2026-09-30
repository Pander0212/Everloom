import type { CharacterSummary } from '@everloom/engine';
import { Dices } from 'lucide-react';
import { useEffect, useState } from 'react';
import { post } from '@/lib/api';
import { toastError } from '@/lib/store';
import { Avatar, Button, Input, Sheet } from '@/ui';

type Pick = CharacterSummary & { why: string };
const MOODS = ['Cozy', 'Adventure', 'Romance', 'Something dark', 'Funny', 'Something I haven’t played'];

/** "What should I play tonight?": three picks from the library, each with a reason. */
export function RecommendSheet({ open, onOpenChange, collectionId, collectionName, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; collectionId?: string | null; collectionName?: string; onPick: (id: string) => void }) {
  const [mood, setMood] = useState('');
  const [picks, setPicks] = useState<Pick[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setPicks([]);
      setSeen([]);
    }
  }, [open]);
  const ask = async (more = false, m = mood) => {
    setBusy(true);
    try {
      const exclude = more ? [...seen, ...picks.map((p) => p.id)] : [];
      const r = await post<{ picks: Pick[] }>('/api/library/recommend', { mood: m, collectionId: collectionId ?? null, exclude });
      setSeen(exclude);
      setPicks(r.picks);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="What should I play?" description={collectionName ? `Picks from ${collectionName}.` : 'Three picks from your library, with the reason for each.'} size="md">
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <Input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="In the mood for… (optional)" aria-label="Mood" onKeyDown={(e) => e.key === 'Enter' && void ask()} />
          <Button variant="primary" icon={Dices} loading={busy} onClick={() => ask()}>
            Pick
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MOODS.map((m) => (
            <button
              key={m}
              className="pressable rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-fg-2 hover:text-fg disabled:opacity-60"
              disabled={busy}
              onClick={() => {
                setMood(m);
                void ask(false, m);
              }}
            >
              {m}
            </button>
          ))}
        </div>
        {picks.length ? (
          <>
            <ul className="mt-2 flex flex-col gap-2" aria-label="Picks">
              {picks.map((p) => (
                <li key={p.id}>
                  <button className="pressable flex w-full items-start gap-3 rounded-md bg-surface-2 p-3 text-left hover:bg-surface-3" onClick={() => onPick(p.id)}>
                    <Avatar src={p.avatar} name={p.name} size="md" shape="rounded" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{p.displayName || p.name}</span>
                      <span className="mt-0.5 block text-sm text-fg-2">{p.why}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <Button variant="quiet" className="self-center" disabled={busy} onClick={() => ask(true)}>
              Show me others
            </Button>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
