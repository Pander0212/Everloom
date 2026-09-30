/** Save slots for this story, and what the story view shows on this device. */
import type { ChatDTO } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clapperboard, FolderOpen, MapPin, Pencil, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { del, get, patch, post } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { toast, toastError } from '@/lib/store';
import { useViewPrefs } from '@/lib/viewPrefs';
import { Button, confirm, EmptyState, IconButton, Input, Sheet, ToggleRow } from '@/ui';

interface Slot {
  id: string;
  name: string;
  sourceChatId: string;
  createdAt: number;
  summary: { location: string | null; when: string | null; level: number | null; messages: number; last: string };
}

export function SavesSheet({ chat, open, onOpenChange }: { chat: ChatDTO; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const slots = useQuery({ queryKey: ['slots', chat.id], queryFn: () => get<Slot[]>(`/api/chats/${chat.id}/slots`), enabled: open });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['slots', chat.id] });
  const save = async () => {
    setBusy(true);
    try {
      const s = await post<Slot>(`/api/chats/${chat.id}/slots`, { name: name.trim() || undefined });
      toast({ title: `Saved “${s.name}”`, tone: 'success' });
      setName('');
      await refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const load = async (s: Slot) => {
    if (!(await confirm({ title: `Load “${s.name}”?`, description: 'It opens as a new chat. This story and the save stay as they are.', confirmLabel: 'Load' }))) return;
    try {
      const c = await post<ChatDTO>(`/api/slots/${s.id}/load`);
      await qc.invalidateQueries({ queryKey: ['chats'] });
      onOpenChange(false);
      navigate(`/chat/${c.id}`);
      toast({ title: `Loaded “${s.name}”`, tone: 'success', action: { label: 'Go back', run: () => navigate(`/chat/${chat.id}`) } });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Saves"
      description="A save keeps the story exactly as it is now: messages, game state and memory. Loading one starts a new chat from it, so saves never change."
      size="md"
      footer={
        <div className="flex w-full gap-2">
          <Input aria-label="Save name" placeholder="Name (optional)" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
          <Button variant="primary" icon={Save} loading={busy} onClick={save}>
            Save now
          </Button>
        </div>
      }
    >
      {slots.data?.length ? (
        <ul className="flex flex-col divide-y divide-line" aria-label="Save slots">
          {slots.data.map((s) => (
            <li key={s.id} className="flex flex-col gap-1.5 py-3">
              <div className="flex items-center gap-2">
                {renaming === s.id ? (
                  <Input
                    autoFocus
                    aria-label="New name"
                    value={draft}
                    maxLength={80}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={async () => {
                      setRenaming(null);
                      if (draft.trim() && draft.trim() !== s.name) await patch(`/api/slots/${s.id}`, { name: draft.trim() }).then(refresh, toastError);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                )}
                <span className="flex-none text-xs text-fg-3">{relativeTime(s.createdAt)}</span>
              </div>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-2">
                {s.summary.location ? (
                  <span className="flex items-center gap-1">
                    <MapPin size={12} /> {s.summary.location}
                  </span>
                ) : null}
                {s.summary.when ? <span>{s.summary.when}</span> : null}
                {s.summary.level ? <span>Level {s.summary.level}</span> : null}
                <span>{s.summary.messages} message{s.summary.messages === 1 ? "" : "s"}</span>
              </p>
              {s.summary.last ? <p className="line-clamp-2 text-sm text-fg-2">{s.summary.last}</p> : null}
              <div className="flex items-center gap-1">
                <Button size="sm" icon={FolderOpen} onClick={() => load(s)} aria-label={`Load ${s.name}`}>
                  Load
                </Button>
                <span className="flex-1" />
                <IconButton size="sm" icon={Pencil} label={`Rename ${s.name}`} onClick={() => (setRenaming(s.id), setDraft(s.name))} />
                <IconButton
                  size="sm"
                  icon={Trash2}
                  label={`Delete ${s.name}`}
                  onClick={async () => {
                    if (!(await confirm({ title: `Delete “${s.name}”?`, confirmLabel: 'Delete', danger: true }))) return;
                    await del(`/api/slots/${s.id}`).then(refresh, toastError);
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : slots.data ? (
        <EmptyState icon={Save} title="No saves yet" body="Save before a big choice, then load it to try the other way." />
      ) : null}
    </Sheet>
  );
}

export function ViewSheet({ open, onOpenChange, onCinematic }: { open: boolean; onOpenChange: (o: boolean) => void; onCinematic: () => void }) {
  const v = useViewPrefs();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="View" description="What the story view shows on this device." size="md">
      <div className="flex flex-col divide-y divide-line">
        <ToggleRow label="Status bar" description="Time, weather, place and trackers above the story." checked={v.hud} onChange={(x) => v.set({ hud: x })} />
        <ToggleRow label="Reply chips" description="Who you're talking to, emotes and suggestions above the composer." checked={v.chips} onChange={(x) => v.set({ chips: x })} />
        <ToggleRow label="Avatars" description="Pictures beside each message." checked={v.avatars} onChange={(x) => v.set({ avatars: x })} />
      </div>
      <Button
        variant="secondary"
        icon={Clapperboard}
        block
        className="mt-4"
        onClick={() => {
          onOpenChange(false);
          onCinematic();
        }}
      >
        Cinematic mode
      </Button>
      <p className="mt-2 text-xs text-fg-2">Only the story, larger. Press Esc or tap Exit to come back.</p>
    </Sheet>
  );
}
