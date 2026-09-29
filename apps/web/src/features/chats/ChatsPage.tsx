import { MessageSquarePlus, MessagesSquare, Plug, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Page } from '@/app/Shell';
import { relativeTime } from '@/lib/format';
import { stagger } from '@/lib/motion';
import { useCharacters, useChats, useConnections, useGroups } from '@/lib/queries';
import { Avatar, Button, EmptyState, Icon, IconButton, Input } from '@/ui';
import { NewChatSheet } from './NewChatSheet';

export default function ChatsPage() {
  const chats = useChats();
  const chars = useCharacters();
  const groups = useGroups();
  const conns = useConnections();
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const navigate = useNavigate();
  const byId = useMemo(() => new Map((chars.data ?? []).map((c) => [c.id, c])), [chars.data]);
  const groupById = useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g])), [groups.data]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = chats.data ?? [];
    return n ? list.filter((c) => c.title.toLowerCase().includes(n) || (c.characterId && byId.get(c.characterId)?.name.toLowerCase().includes(n))) : list;
  }, [chats.data, q, byId]);
  const noConnection = conns.data && !conns.data.some((c) => ['openai', 'anthropic', 'gemini', 'textgen'].includes(c.provider));

  return (
    <Page
      title="Chats"
      actions={
        <>
          <IconButton icon={MessageSquarePlus} label="New chat" className="md:hidden" onClick={() => setNewOpen(true)} />
          <span className="hidden md:contents"><Button variant="primary" icon={MessageSquarePlus} onClick={() => setNewOpen(true)}>
            New chat
          </Button></span>
        </>
      }
    >
      {noConnection ? (
        <Link to="/settings/connections" className="pressable mb-4 flex items-center gap-3 rounded-md bg-accent-soft px-4 py-3 text-sm">
          <Icon icon={Plug} className="text-accent-text" />
          <span className="flex-1">
            <span className="font-medium text-fg">Connect a model</span>
            <span className="block text-fg-2">Add an API connection so characters can reply.</span>
          </span>
        </Link>
      ) : null}
      {(chats.data?.length ?? 0) > 6 ? (
        <div className="relative mb-2">
          <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <Input placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" aria-label="Search chats" />
        </div>
      ) : null}
      {chats.isLoading ? null : filtered.length ? (
        <ul className="flex flex-col">
          {filtered.map((c, i) => {
            const ch = c.characterId ? byId.get(c.characterId) : undefined;
            const g = c.groupId ? groupById.get(c.groupId) : undefined;
            const name = ch?.name ?? g?.name ?? 'Chat';
            return (
              <motion.li key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={stagger(i)}>
                <button onClick={() => navigate(`/chat/${c.id}`)} className="pressable -mx-2 flex w-[calc(100%+16px)] items-center gap-3 rounded-md px-2 py-3 text-left hover:bg-surface-2">
                  <Avatar src={ch?.avatar ?? g?.avatar} name={name} size="lg" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-base font-medium">{name}</span>
                      <span className="ml-auto flex-none text-xs text-fg-3">{relativeTime(c.updatedAt)}</span>
                    </span>
                    <span className="block truncate text-sm text-fg-2">{c.lastMessage ? c.lastMessage.replace(/[*_]/g, '') : c.title}</span>
                  </span>
                </button>
              </motion.li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={MessagesSquare}
          title={q ? 'No chats match' : 'No chats yet'}
          body={q ? undefined : 'Pick a character to start your first story.'}
          action={
            q ? undefined : (
              <Button variant="primary" onClick={() => (chars.data?.length ? setNewOpen(true) : navigate('/characters'))}>
                {chars.data?.length ? 'Start a chat' : 'Add a character'}
              </Button>
            )
          }
        />
      )}
      <NewChatSheet open={newOpen} onOpenChange={setNewOpen} />
    </Page>
  );
}
