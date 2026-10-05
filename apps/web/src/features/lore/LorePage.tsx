import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, Search, Upload } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/app/Shell';
import { post, upload } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useCharacters, useLorebooks } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, EmptyState, FileButton, Icon, IconButton, Input, ListRow, Switch } from '@/ui';
import { put } from '@/lib/api';

export default function LorePage() {
  const books = useLorebooks();
  const chars = useCharacters();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const charName = (id: string | null) => chars.data?.find((c) => c.id === id)?.name;
  const create = async () => {
    const b = await post('/api/lorebooks', { name: 'New lorebook' });
    await qc.invalidateQueries({ queryKey: ['lorebooks'] });
    navigate(`/lore/${b.id}`);
  };
  const importFiles = async (files: File[]) => {
    for (const f of files) {
      try {
        await upload('/api/lorebooks/import', f, { name: f.name.replace(/\.json(\.evlt)?$/i, '') });
        toast({ title: `Imported ${f.name}`, tone: 'success' });
      } catch (e) {
        toastError(e);
      }
    }
    await qc.invalidateQueries({ queryKey: ['lorebooks'] });
  };
  const toggle = async (id: string, enabled: boolean) => {
    await put(`/api/lorebooks/${id}`, { enabled });
    await qc.invalidateQueries({ queryKey: ['lorebooks'] });
  };
  const needle = q.trim().toLowerCase();
  const all = (books.data ?? []).filter((b) => !needle || b.name.toLowerCase().includes(needle) || (charName(b.scopeId) ?? '').toLowerCase().includes(needle));
  const groups = [
    { title: 'Global', items: all.filter((b) => b.scope === 'global') },
    { title: 'Character', items: all.filter((b) => b.scope === 'character') },
    { title: 'Chat', items: all.filter((b) => b.scope === 'chat') },
  ].filter((g) => g.items.length);
  return (
    <Page
      narrow
      title="Lore"
      actions={
        <>
          <FileButton accept=".json,.evlt,application/json" multiple onFiles={importFiles} icon={Upload} variant="secondary">
            <span className="hidden sm:inline">Import</span>
          </FileButton>
          <IconButton icon={Plus} label="New lorebook" onClick={create} />
        </>
      }
    >
      <p className="mb-2 text-sm text-fg-2">World Info entries are added to the prompt when their keywords come up. SillyTavern world files import as-is. Open a lorebook to generate entries with AI.</p>
      {(books.data?.length ?? 0) > 5 ? (
        <div className="relative mt-3">
          <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lorebooks" aria-label="Search lorebooks" className="pl-10" />
        </div>
      ) : null}
      {groups.length ? (
        groups.map((g) => (
          <section key={g.title} className="mt-4">
            <h2 className="pb-1 text-sm font-semibold text-fg-2">{g.title}</h2>
            <div className="flex flex-col">
              {g.items.map((b) => (
                <ListRow
                  key={b.id}
                  title={b.name}
                  subtitle={`${b.entryCount} entries${b.scope === 'character' && charName(b.scopeId) ? ` · ${charName(b.scopeId)}` : ''} · ${relativeTime(b.updatedAt)}`}
                  onClick={() => navigate(`/lore/${b.id}`)}
                  trailing={
                    <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
                      {!b.enabled ? <Badge>Off</Badge> : null}
                      <Switch checked={b.enabled} onChange={(v) => toggle(b.id, v)} label={`Enable ${b.name}`} />
                    </span>
                  }
                />
              ))}
            </div>
          </section>
        ))
      ) : books.isLoading ? null : needle ? (
        <EmptyState title="No lorebooks match" />
      ) : (
        <EmptyState icon={BookOpen} title="No lorebooks yet" body="Create one or import a SillyTavern world JSON." action={<Button variant="primary" onClick={create}>Create lorebook</Button>} />
      )}
    </Page>
  );
}
