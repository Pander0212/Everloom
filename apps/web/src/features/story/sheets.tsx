import type { ChatDTO, MessageDTO } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkCheck, ChevronDown, Copy, Download, GitBranch, Pin, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { del, download, get, patch, post, upload } from '@/lib/api';
import { cx, relativeTime } from '@/lib/format';
import { qk, useChats, usePersonas } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, confirm, EmptyState, Field, FileButton, Icon, IconButton, Input, ListRow, Segmented, Select, Sheet, Spinner, Textarea } from '@/ui';

interface PromptPart {
  blockId: string;
  name: string;
  role: string;
  content: string;
  tokens: number;
}
interface PromptInfo {
  at: number;
  connection: { name: string; provider: string; model: string } | null;
  parts: PromptPart[];
  totalTokens: number;
  budget: number;
  trimmedHistory: number;
  worldInfo: Array<{ world: string; uid: number; comment: string }>;
}

export function InspectorSheet({ chatId, open, onOpenChange }: { chatId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [mode, setMode] = useState<'next' | 'last'>('next');
  const q = useQuery({
    queryKey: ['prompt', chatId, mode, open],
    queryFn: () => (mode === 'last' ? get<PromptInfo | null>(`/api/chats/${chatId}/prompt`) : post<PromptInfo>(`/api/chats/${chatId}/prompt/preview`, {})),
    enabled: open,
    staleTime: 0,
  });
  const groups = useMemo(() => {
    const out: Array<{ name: string; blockId: string; parts: PromptPart[]; tokens: number }> = [];
    for (const p of q.data?.parts ?? []) {
      const key = p.blockId === 'chatHistory' || p.blockId === 'depth' || p.blockId === 'chatStart' ? 'history' : p.blockId;
      const last = out[out.length - 1];
      if (last && last.blockId === key) {
        last.parts.push(p);
        last.tokens += p.tokens;
      } else out.push({ name: key === 'history' ? 'Chat history' : p.name, blockId: key, parts: [p], tokens: p.tokens });
    }
    return out;
  }, [q.data]);
  const d = q.data;
  const pct = d ? Math.min(1, d.totalTokens / d.budget) : 0;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Prompt inspector" description="Exactly what the model receives, block by block." size="lg" headerActions={<IconButton icon={RefreshCw} label="Refresh" onClick={() => q.refetch()} />}>
      <Segmented
        label="Which prompt"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'next', label: 'Next reply' },
          { value: 'last', label: 'Last sent' },
        ]}
      />
      {q.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !d ? (
        <EmptyState title="Nothing sent yet" body="Generate a reply first, or look at the next reply." />
      ) : (
        <div className="mt-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">
              {d.totalTokens.toLocaleString()} <span className="font-normal text-fg-2">of {d.budget.toLocaleString()} tokens</span>
            </span>
            <span className="text-xs text-fg-2">{d.connection ? `${d.connection.name} · ${d.connection.model}` : 'No connection'}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${pct})` }} />
          </div>
          {d.trimmedHistory ? <p className="mt-2 text-xs text-fg-2">{d.trimmedHistory} older messages didn't fit and were left out.</p> : null}
          {d.worldInfo.length ? (
            <p className="mt-2 text-xs text-fg-2">
              World info active: {d.worldInfo.map((w) => w.comment).slice(0, 12).join(', ')}
              {d.worldInfo.length > 12 ? '…' : ''}
            </p>
          ) : null}
          <div className="mt-4 flex flex-col divide-y divide-line">
            {groups.map((g, i) => (
              <InspectorBlock key={i} name={g.name} tokens={g.tokens} parts={g.parts} />
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function InspectorBlock({ name, tokens, parts }: { name: string; tokens: number; parts: PromptPart[] }) {
  const [open, setOpen] = useState(false);
  const text = parts.map((p) => (parts.length > 1 ? `[${p.role}${p.name && p.blockId !== 'chatHistory' ? ` · ${p.name}` : p.name ? ` · ${p.name}` : ''}]\n${p.content}` : p.content)).join('\n\n');
  return (
    <div className="py-1">
      <button onClick={() => setOpen((o) => !o)} className="pressable flex min-h-11 w-full items-center gap-3 text-left" aria-expanded={open}>
        <span className="flex-1 truncate text-sm font-medium">{name}</span>
        {parts.length > 1 ? <span className="text-xs text-fg-3">{parts.length} parts</span> : <Badge>{parts[0].role}</Badge>}
        <span className="w-16 text-right text-xs tabular-nums text-fg-2">{tokens.toLocaleString()}</span>
        <Icon icon={ChevronDown} size={16} className={cx('text-fg-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? <pre className="mb-2 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 font-sans text-xs leading-5 text-fg-2">{text}</pre> : null}
    </div>
  );
}

export function SearchSheet({ chatId, messages, open, onOpenChange, onJump }: { chatId: string; messages: MessageDTO[]; open: boolean; onOpenChange: (o: boolean) => void; onJump: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'search' | 'bookmarks'>('search');
  const res = useQuery({ queryKey: ['search', chatId, q], queryFn: () => get<Array<{ id: string; seq: number; snippet: string }>>(`/api/chats/${chatId}/search`, { q }), enabled: open && q.trim().length > 1 });
  const bookmarks = messages.filter((m) => m.bookmarked);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Find in chat" size="md">
      <Segmented
        label="Mode"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'search', label: 'Search' },
          { value: 'bookmarks', label: `Bookmarks${bookmarks.length ? ` (${bookmarks.length})` : ''}` },
        ]}
      />
      {tab === 'search' ? (
        <>
          <div className="relative mt-3">
            <Icon icon={Search} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
            <Input autoFocus placeholder="Words in this chat" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" aria-label="Search this chat" />
          </div>
          <div className="mt-2 flex flex-col">
            {(res.data ?? []).map((r) => (
              <ListRow key={r.id} title={`Message ${r.seq}`} subtitle={r.snippet} onClick={() => onJump(r.id)} />
            ))}
            {q.trim().length > 1 && res.data && !res.data.length ? <p className="py-6 text-center text-sm text-fg-2">No matches</p> : null}
          </div>
        </>
      ) : bookmarks.length ? (
        <div className="mt-2 flex flex-col">
          {bookmarks.map((m) => (
            <ListRow key={m.id} leading={<Icon icon={BookmarkCheck} className="text-accent-text" />} title={m.name} subtitle={(m.swipes[m.swipeId]?.text ?? '').slice(0, 120)} onClick={() => onJump(m.id)} />
          ))}
        </div>
      ) : (
        <EmptyState title="No bookmarks" body="Use a message's menu to bookmark it." />
      )}
    </Sheet>
  );
}

export function NoteSheet({ chat, open, onOpenChange }: { chat: ChatDTO; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [content, setContent] = useState('');
  const [depth, setDepth] = useState(4);
  const [role, setRole] = useState<'system' | 'user' | 'assistant'>('system');
  useEffect(() => {
    if (!open) return;
    setContent(chat.metadata.authorsNote?.content ?? '');
    setDepth(chat.metadata.authorsNote?.depth ?? 4);
    setRole(chat.metadata.authorsNote?.role ?? 'system');
  }, [open, chat]);
  const save = async () => {
    try {
      const c = await patch(`/api/chats/${chat.id}`, { metadata: { authorsNote: { content, depth, role } } });
      qc.setQueryData(qk.chat(chat.id), (x: any) => ({ ...x, ...c }));
      onOpenChange(false);
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Author's note" description="A standing instruction inserted near the end of the chat." footer={<Button variant="primary" size="lg" block onClick={save}>Save note</Button>}>
      <div className="flex flex-col gap-4">
        <Textarea rows={5} aria-label="Author's note" value={content} onChange={(e) => setContent(e.target.value)} placeholder="[Style: slow-burn, keep replies under 200 words.]" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Depth" htmlFor="and" hint="Messages from the end.">
            <Input id="and" type="number" min={0} max={100} value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
          </Field>
          <Field label="Role" htmlFor="anr">
            <Select id="anr" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="system">System</option>
              <option value="user">User</option>
              <option value="assistant">Assistant</option>
            </Select>
          </Field>
        </div>
      </div>
    </Sheet>
  );
}

export function MemorySheet({ chat, open, onOpenChange }: { chat: ChatDTO; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newFact, setNewFact] = useState('');
  const facts = useQuery({ queryKey: ['memories', chat.id], queryFn: () => get<Array<{ id: string; text: string; pinned: number; createdAt: number }>>(`/api/chats/${chat.id}/memories`), enabled: open });
  useEffect(() => {
    if (!open) return;
    setText(chat.metadata.memory?.text ?? '');
    setPinned(!!chat.metadata.memory?.pinned);
  }, [open, chat]);
  const save = async (p = pinned) => {
    const c = await patch(`/api/chats/${chat.id}`, { metadata: { memory: { text, pinned: p, uptoSeq: chat.metadata.memory?.uptoSeq ?? 0 } } });
    qc.setQueryData(qk.chat(chat.id), (x: any) => ({ ...x, ...c }));
  };
  const summarize = async () => {
    setBusy(true);
    try {
      const r = await post<{ ok: boolean; summary?: string; error?: string }>(`/api/chats/${chat.id}/summarize`, { force: true });
      if (!r.ok) throw new Error(r.error ?? 'Summary failed');
      setText(r.summary ?? '');
      await qc.invalidateQueries({ queryKey: qk.chat(chat.id) });
      await facts.refetch();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Memory"
      description="The story so far, kept in the prompt so long chats stay coherent."
      size="lg"
      footer={
        <>
          <Button variant="secondary" loading={busy} icon={RefreshCw} onClick={summarize}>
            Summarize now
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={async () => {
              await save();
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Textarea rows={8} maxRows={20} aria-label="Summary" value={text} onChange={(e) => setText(e.target.value)} placeholder="No summary yet. It's written automatically as the chat grows." />
        <label className="flex items-center gap-3 text-sm">
          <IconButton icon={Pin} label={pinned ? 'Unpin summary' : 'Pin summary'} active={pinned} onClick={() => setPinned((p) => !p)} />
          <span className="text-fg-2">{pinned ? 'Pinned — automatic summaries won’t overwrite it.' : 'Automatic summaries update this text.'}</span>
        </label>
        <div>
          <p className="text-sm font-semibold text-fg-2">Long-term memories</p>
          <div className="mt-1 flex flex-col divide-y divide-line">
            {(facts.data ?? []).map((f) => (
              <div key={f.id} className="flex items-start gap-2 py-2">
                <p className="flex-1 text-sm">{f.text}</p>
                <IconButton
                  size="sm"
                  icon={Pin}
                  active={!!f.pinned}
                  label={f.pinned ? 'Unpin' : 'Pin for every chat with this character'}
                  onClick={async () => {
                    await patch(`/api/memories/${f.id}`, { pinned: !f.pinned });
                    await facts.refetch();
                  }}
                />
                <IconButton
                  size="sm"
                  icon={Trash2}
                  label="Forget"
                  onClick={async () => {
                    await del(`/api/memories/${f.id}`);
                    await facts.refetch();
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <Input value={newFact} onChange={(e) => setNewFact(e.target.value)} placeholder="Add a memory" aria-label="New memory" />
            <Button
              variant="secondary"
              disabled={!newFact.trim()}
              onClick={async () => {
                await post(`/api/chats/${chat.id}/memories`, { text: newFact.trim() });
                setNewFact('');
                await facts.refetch();
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

export function ChatInfoSheet({ chat, open, onOpenChange }: { chat: ChatDTO; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const personas = usePersonas();
  const all = useChats(chat.characterId ? { characterId: chat.characterId } : chat.groupId ? { groupId: chat.groupId } : undefined);
  const [title, setTitle] = useState(chat.title);
  useEffect(() => setTitle(chat.title), [chat.title, open]);
  const branches = (all.data ?? []).filter((c) => c.id !== chat.id && (c.parentChatId === chat.id || c.id === chat.parentChatId || (chat.parentChatId && c.parentChatId === chat.parentChatId)));
  const update = async (p: object) => {
    try {
      const c = await patch(`/api/chats/${chat.id}`, p);
      qc.setQueryData(qk.chat(chat.id), (x: any) => ({ ...x, ...c }));
      await qc.invalidateQueries({ queryKey: ['chats'] });
    } catch (e) {
      toastError(e);
    }
  };
  const importJsonl = async (f: File) => {
    if (!chat.characterId) return;
    try {
      const c = await upload('/api/chats/import', f, { characterId: chat.characterId });
      await qc.invalidateQueries({ queryKey: ['chats'] });
      onOpenChange(false);
      navigate(`/chat/${c.id}`);
      toast({ title: 'Chat imported', tone: 'success' });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Chat" size="md">
      <div className="flex flex-col gap-4">
        <Field label="Title" htmlFor="ctitle">
          <Input id="ctitle" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== chat.title && update({ title: title.trim() })} />
        </Field>
        <Field label="Your persona" htmlFor="cpersona" hint="Locks this chat to a persona.">
          <Select id="cpersona" value={chat.personaId ?? ''} onChange={(e) => update({ personaId: e.target.value || null })}>
            <option value="">Default persona</option>
            {(personas.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        {branches.length ? (
          <div>
            <p className="text-sm font-semibold text-fg-2">Branches</p>
            <div className="mt-1 flex flex-col">
              {branches.map((b) => (
                <ListRow
                  key={b.id}
                  leading={<Icon icon={GitBranch} className="text-fg-3" />}
                  title={b.title}
                  subtitle={`${b.id === chat.parentChatId ? 'Parent · ' : ''}${b.messageCount} messages · ${relativeTime(b.updatedAt)}`}
                  chevron
                  onClick={() => {
                    onOpenChange(false);
                    navigate(`/chat/${b.id}`);
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex flex-col">
          <Button variant="ghost" icon={Download} className="justify-start" onClick={() => download(`/api/chats/${chat.id}/export`, `${chat.title}.jsonl`)}>
            Export (SillyTavern JSONL)
          </Button>
          {chat.characterId ? (
            <FileButton variant="ghost" icon={Upload} className="justify-start" accept=".jsonl,application/jsonl,text/plain" onFiles={(f) => importJsonl(f[0])}>
              Import a JSONL chat
            </FileButton>
          ) : null}
          <Button
            variant="ghost"
            icon={Copy}
            className="justify-start"
            onClick={async () => {
              const c = await post(`/api/chats/${chat.id}/duplicate`);
              await qc.invalidateQueries({ queryKey: ['chats'] });
              onOpenChange(false);
              navigate(`/chat/${c.id}`);
            }}
          >
            Duplicate chat
          </Button>
          <Button
            variant="ghost"
            icon={Trash2}
            className="justify-start !text-danger"
            onClick={async () => {
              if (!(await confirm({ title: 'Delete this chat?', description: 'Messages and this chat’s game progress are deleted. This can’t be undone.', confirmLabel: 'Delete chat', danger: true }))) return;
              await del(`/api/chats/${chat.id}`);
              await qc.invalidateQueries({ queryKey: ['chats'] });
              navigate('/');
            }}
          >
            Delete chat
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
