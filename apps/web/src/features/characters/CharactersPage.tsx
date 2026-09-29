import { useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Star, Upload, Users, UsersRound } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/app/Shell';
import { post, upload } from '@/lib/api';
import { cx } from '@/lib/format';
import { stagger } from '@/lib/motion';
import { useCharacters } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Avatar, Button, EmptyState, FileButton, Icon, IconButton, Input, Menu } from '@/ui';
import { GroupSheet } from './GroupSheet';

export default function CharactersPage() {
  const chars = useCharacters();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of chars.data ?? []) for (const t of c.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
  }, [chars.data]);
  const list = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (chars.data ?? []).filter((c) => (!n || c.name.toLowerCase().includes(n) || c.description.toLowerCase().includes(n)) && (!tag || c.tags.includes(tag)) && (!favOnly || c.fav));
  }, [chars.data, q, tag, favOnly]);

  const importFiles = async (files: File[]) => {
    setImporting(true);
    let ok = 0;
    for (const f of files) {
      try {
        await upload('/api/characters/import', f);
        ok++;
      } catch (e) {
        toastError(new Error(`${f.name}: ${(e as Error).message}`));
      }
    }
    setImporting(false);
    await qc.invalidateQueries({ queryKey: ['characters'] });
    if (ok) toast({ title: ok === 1 ? 'Character imported' : `${ok} characters imported`, tone: 'success' });
  };
  const create = async () => {
    try {
      const c = await post('/api/characters', { card: { name: 'New character' } });
      await qc.invalidateQueries({ queryKey: ['characters'] });
      navigate(`/characters/${c.id}`);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Page
      title="Characters"
      actions={
        <>
          <FileButton accept=".png,.webp,.json,image/png,image/webp,application/json" multiple onFiles={importFiles} loading={importing} icon={Upload} variant="secondary" size="md">
            <span className="hidden sm:inline">Import</span>
          </FileButton>
          <Menu
            trigger={<IconButton icon={Plus} label="Create" />}
            items={[
              { label: 'New character', icon: Plus, onSelect: create },
              { label: 'New group', icon: UsersRound, onSelect: () => setGroupOpen(true) },
            ]}
          />
        </>
      }
    >
      <div className="relative">
        <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
        <Input placeholder="Search characters" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" aria-label="Search characters" />
      </div>
      {tags.length || (chars.data ?? []).some((c) => c.fav) ? (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <button onClick={() => setFavOnly((v) => !v)} className={cx('pressable flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-sm', favOnly ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-fg-2')}>
            <Icon icon={Star} size={14} /> Favorites
          </button>
          {tags.map((t) => (
            <button key={t} onClick={() => setTag(tag === t ? null : t)} className={cx('pressable h-8 flex-none rounded-full px-3 text-sm', tag === t ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-fg-2')}>
              {t}
            </button>
          ))}
        </div>
      ) : null}
      {chars.isLoading ? null : list.length ? (
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
          {list.map((c, i) => (
            <motion.button
              key={c.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={stagger(i)}
              onClick={() => navigate(`/characters/${c.id}`)}
              className="pressable group flex flex-col text-left"
            >
              <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md bg-surface-2">
                {c.avatar ? <img src={c.avatar} alt="" loading="lazy" className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]" /> : <Avatar name={c.name} size="xl" shape="rounded" className="absolute inset-0 m-auto" />}
                {c.fav ? <Icon icon={Star} size={16} className="absolute right-2 top-2 fill-current text-accent" /> : null}
              </div>
              <span className="mt-2 truncate text-sm font-medium">{c.name}</span>
              <span className="truncate text-xs text-fg-2">{c.chatCount ? `${c.chatCount} chat${c.chatCount > 1 ? 's' : ''}` : c.tags.slice(0, 2).join(', ') || 'No chats yet'}</span>
            </motion.button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Users}
          title={chars.data?.length ? 'Nothing matches' : 'No characters yet'}
          body={chars.data?.length ? undefined : 'Import SillyTavern cards (PNG, WebP or JSON) or create one from scratch.'}
          action={
            chars.data?.length ? undefined : (
              <div className="flex gap-2">
                <FileButton accept=".png,.webp,.json" multiple onFiles={importFiles} variant="primary" icon={Upload}>
                  Import cards
                </FileButton>
                <Button variant="ghost" onClick={create}>
                  Create
                </Button>
              </div>
            )
          }
        />
      )}
      <GroupSheet open={groupOpen} onOpenChange={setGroupOpen} />
    </Page>
  );
}
