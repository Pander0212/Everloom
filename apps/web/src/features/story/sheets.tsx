import { FEATURE_PRESETS, PRESET_INFO } from '@everloom/engine';
import { entry } from '@/lib/registry';
import { LOOKS } from '@/themes/looks';
import type { ChatDTO, MessageDTO } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkCheck, ChevronDown, Copy, Download, GitBranch, Pin, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { del, download, get, patch, post, upload } from '@/lib/api';
import { cx, relativeTime } from '@/lib/format';
import { qk, useChats, useConnections, usePersonas, useSettings } from '@/lib/queries';
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
  /** As the provider receives it (name shield stand-ins); null when it's the same. */
  sentParts?: PromptPart[] | null;
  totalTokens: number;
  budget: number;
  trimmedHistory: number;
  worldInfo: Array<{ world: string; uid: number; comment: string }>;
}

export function InspectorSheet({ chatId, open, onOpenChange }: { chatId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [mode, setMode] = useState<'next' | 'last'>('next');
  const [view, setView] = useState<'stored' | 'sent'>('stored');
  const q = useQuery({
    queryKey: ['prompt', chatId, mode, open],
    queryFn: () => (mode === 'last' ? get<PromptInfo | null>(`/api/chats/${chatId}/prompt`) : post<PromptInfo>(`/api/chats/${chatId}/prompt/preview`, {})),
    enabled: open,
    staleTime: 0,
  });
  const groups = useMemo(() => {
    const out: Array<{ name: string; blockId: string; parts: PromptPart[]; tokens: number }> = [];
    for (const p of (view === 'sent' && q.data?.sentParts ? q.data.sentParts : q.data?.parts) ?? []) {
      const key = p.blockId === 'chatHistory' || p.blockId === 'depth' || p.blockId === 'chatStart' ? 'history' : p.blockId;
      const last = out[out.length - 1];
      if (last && last.blockId === key) {
        last.parts.push(p);
        last.tokens += p.tokens;
      } else out.push({ name: key === 'history' ? 'Chat history' : p.name, blockId: key, parts: [p], tokens: p.tokens });
    }
    return out;
  }, [q.data, view]);
  const d = q.data;
  const pct = d ? Math.min(1, d.totalTokens / d.budget) : 0;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Everything sent to the AI" description="Exactly what the AI read for the last reply, piece by piece." help={entry('sent-to-ai')?.help} size="lg" headerActions={<IconButton icon={RefreshCw} label="Refresh" onClick={() => q.refetch()} />}>
      <Segmented
        label="Which prompt"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'next', label: 'Next reply' },
          { value: 'last', label: 'Last sent' },
        ]}
      />
      {d?.sentParts ? (
        <div className="mt-2">
          <Segmented
            label="Names"
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'stored', label: 'As stored' },
              { value: 'sent', label: 'As sent (name shield)' },
            ]}
          />
        </div>
      ) : null}
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
    <Sheet open={open} onOpenChange={onOpenChange} title="Find in chat" help={entry('find')?.help} size="md">
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
    <Sheet open={open} onOpenChange={onOpenChange} title="Note to the AI" description="A standing instruction the AI reads every reply (the Author's note)." help={entry('note')?.help} footer={<Button variant="primary" size="lg" block onClick={save}>Save note</Button>}>
      <div className="flex flex-col gap-4">
        <Textarea rows={5} aria-label="Note to the AI" value={content} onChange={(e) => setContent(e.target.value)} placeholder="[Style: slow-burn, keep replies under 200 words.]" />
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

export function ChatInfoSheet({ chat, open, onOpenChange }: { chat: ChatDTO; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const personas = usePersonas();
  const all = useChats(chat.characterId ? { characterId: chat.characterId } : chat.groupId ? { groupId: chat.groupId } : undefined);
  const [title, setTitle] = useState(chat.title);
  useEffect(() => setTitle(chat.title), [chat.title, open]);
  const conns = useConnections();
  const settings = useSettings();
  const llms = (conns.data ?? []).filter((c) => ['openai', 'anthropic', 'gemini', 'textgen'].includes(c.provider));
  const mainConn = llms.find((c) => c.id === settings.data?.roles.main);
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
    <Sheet open={open} onOpenChange={onOpenChange} title="This chat" help={entry('chat-details')?.help} size="md">
      <div className="flex flex-col gap-4">
        <Field label="Title" htmlFor="ctitle">
          <Input id="ctitle" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== chat.title && update({ title: title.trim() })} />
        </Field>
        <Field label="Model" htmlFor="cmodel" hint={<>Which AI writes this chat. <Link to="/settings/connections" className="font-medium text-accent-text">Add or change models</Link></>}>
          <Select id="cmodel" value={(chat.metadata.connectionId as string | null | undefined) ?? ''} onChange={(e) => update({ metadata: { connectionId: e.target.value || null } })}>
            <option value="">{mainConn ? `Main model (${mainConn.name})` : 'Main model (from Settings)'}</option>
            {llms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.model ? ` — ${c.model}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mode" htmlFor="cmode" hint={chat.metadata.features && chat.metadata.features !== 'classic' && !chat.campaignId ? 'This chat was started without a game, so game screens stay empty here; start a new chat to play with them.' : 'Classic is a plain roleplay chat with one model call per reply. Nothing is deleted when you switch.'}>
          <Select id="cmode" value={chat.metadata.features ?? ''} onChange={(e) => update({ metadata: { features: e.target.value || null } })}>
            <option value="">Follow Settings › Features</option>
            {FEATURE_PRESETS.map((p) => (
              <option key={p} value={p}>
                {PRESET_INFO[p].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Theme for this world" htmlFor="clook" hint="This chat always wears this theme, on every device that allows world themes (Settings › Appearance & themes).">
          <Select id="clook" value={(chat.metadata.look as string | null | undefined) ?? ''} onChange={(e) => update({ metadata: { look: e.target.value || null } })}>
            <option value="">My theme</option>
            {LOOKS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
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
            <FileButton variant="ghost" icon={Upload} className="justify-start" accept=".jsonl,.evlt,application/jsonl,text/plain" onFiles={(f) => importJsonl(f[0])}>
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
