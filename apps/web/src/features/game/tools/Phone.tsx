import { hasEmail, inbox, type CampaignState, type Op } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Globe,
  Landmark,
  Mail,
  Map as MapIcon,
  MessageCircle,
  MessageCirclePlus,
  Newspaper,
  Phone as PhoneIcon,
  PhoneOff,
  Plus,
  Send,
  Smartphone,
  Sparkles,
  TrainFront,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { get, post } from '@/lib/api';
import { cx, relativeTime } from '@/lib/format';
import { t } from '@/lib/motion';
import { setCampaignState, useCharacters } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Avatar, Badge, Button, EmptyState, Field, Icon, IconButton, Input, Select, Sheet, Textarea, Typing } from '@/ui';
import { useGame } from '../context';
import { AppView, BrowserView, ContactsView, FeedView, MailView, NewAppSheet, APP_ICONS } from './PhoneApps';
import { NoCampaign, ToolSheet } from './ToolSheet';

export interface PhoneMsg {
  id: string;
  npcId: string;
  fromPlayer: boolean;
  text: string;
  gameTime: number | null;
  createdAt: number;
  kind?: string;
  speakerId?: string | null;
}
interface Thread {
  npcId: string;
  name: string;
  portrait: string | null;
  characterId: string | null;
  unread: number;
  last: PhoneMsg | null;
}
interface GroupThread {
  id: string;
  name: string;
  members: string[];
  last: PhoneMsg | null;
}

export type Screen =
  | { kind: 'home' }
  | { kind: 'messages' }
  | { kind: 'thread'; npcId: string }
  | { kind: 'group'; gid: string }
  | { kind: 'call'; npcId: string }
  | { kind: 'mail'; compose?: string }
  | { kind: 'feed' }
  | { kind: 'browser' }
  | { kind: 'contacts' }
  | { kind: 'app'; id: string };

const seenKey = (campaignId: string) => `everloom:phone-seen:${campaignId}`;
function readSeen(campaignId: string): number {
  try {
    return Number(localStorage.getItem(seenKey(campaignId))) || 0;
  } catch {
    return 0;
  }
}
function writeSeen(campaignId: string, minutes: number) {
  try {
    localStorage.setItem(seenKey(campaignId), String(minutes));
  } catch {
    /* private mode: the digest just shows everything unread */
  }
}

export default function Phone({ arg }: { arg?: string }) {
  const { state: s, chat } = useGame();
  const [screen, setScreen] = useState<Screen>(arg ? { kind: 'thread', npcId: arg } : { kind: 'home' });
  const chars = useCharacters();
  if (!s) return <ToolSheet title="Phone"><NoCampaign /></ToolSheet>;
  const avatar = (npcId: string) => {
    const n = s.npcs[npcId];
    return (n?.portrait ? `/media/${n.portrait}` : chars.data?.find((c) => c.id === n?.characterId)?.avatar) ?? undefined;
  };
  const home = () => setScreen({ kind: 'home' });
  switch (screen.kind) {
    case 'thread':
      return s.npcs[screen.npcId] ? <ThreadView npcId={screen.npcId} state={s} onBack={() => setScreen({ kind: 'messages' })} onCall={() => setScreen({ kind: 'call', npcId: screen.npcId })} avatar={avatar(screen.npcId)} /> : null;
    case 'group':
      return <GroupView gid={screen.gid} state={s} onBack={() => setScreen({ kind: 'messages' })} />;
    case 'call':
      return <CallView npcId={screen.npcId} state={s} avatar={avatar(screen.npcId)} onEnd={() => setScreen({ kind: 'thread', npcId: screen.npcId })} />;
    case 'messages':
      return <Messages state={s} avatar={avatar} go={setScreen} onBack={home} />;
    case 'mail':
      return <MailView state={s} compose={screen.compose} onBack={home} />;
    case 'feed':
      return <FeedView state={s} onBack={home} />;
    case 'browser':
      return <BrowserView state={s} onBack={home} />;
    case 'contacts':
      return <ContactsView state={s} avatar={avatar} go={setScreen} onBack={home} />;
    case 'app':
      return <AppView state={s} id={screen.id} onBack={home} />;
    default:
      return <Home state={s} go={setScreen} campaignId={chat.campaignId!} />;
  }
}

// ------------------------------------------------------------------ home

function Home({ state: s, go, campaignId }: { state: CampaignState; go: (sc: Screen) => void; campaignId: string }) {
  const { open } = useGame();
  const [adding, setAdding] = useState(false);
  const codex = !hasEmail(s);
  const [seen] = useState(() => readSeen(campaignId));
  useEffect(() => () => writeSeen(campaignId, s.time.minutes), []); // eslint-disable-line react-hooks/exhaustive-deps
  const texts = Object.entries(s.phone.unread).filter(([id, n]) => n > 0 && s.npcs[id]);
  const letters = inbox(s).filter((m) => !m.read);
  const posts = s.feed.filter((p) => p.at > seen && p.npcId);
  const unreadTexts = texts.reduce((n, [, c]) => n + c, 0);
  const apps: Array<{ id: string; label: string; icon: LucideIcon; badge?: number; run: () => void }> = [
    { id: 'messages', label: 'Messages', icon: MessageCircle, badge: unreadTexts, run: () => go({ kind: 'messages' }) },
    { id: 'mail', label: codex ? 'Letters' : 'Mail', icon: Mail, badge: letters.length, run: () => go({ kind: 'mail' }) },
    { id: 'feed', label: codex ? 'Notice board' : 'Social', icon: Newspaper, badge: posts.length, run: () => go({ kind: 'feed' }) },
    { id: 'browser', label: codex ? 'Archive' : 'Browser', icon: codex ? BookOpen : Globe, run: () => go({ kind: 'browser' }) },
    { id: 'contacts', label: codex ? 'Acquaintances' : 'Contacts', icon: Users, run: () => go({ kind: 'contacts' }) },
    { id: 'transit', label: codex ? 'Routes' : 'Transit', icon: TrainFront, run: () => open('map') },
    { id: 'bank', label: codex ? 'Ledger' : 'Bank', icon: Landmark, run: () => open('money') },
    { id: 'calendar', label: codex ? 'Almanac' : 'Calendar', icon: CalendarDays, run: () => open('calendar') },
    { id: 'map', label: 'Map', icon: MapIcon, run: () => open('map') },
    ...Object.values(s.phone.apps ?? {}).map((a) => ({ id: a.id, label: a.name, icon: APP_ICONS[a.icon] ?? Sparkles, run: () => go({ kind: 'app', id: a.id }) })),
  ];
  const digest = texts.length + letters.length + posts.length > 0;
  return (
    <ToolSheet title={codex ? 'Codex' : 'Phone'} description={codex ? 'Letters, notices and records' : 'Messages, mail and apps'}>
      <div className="flex flex-col gap-5">
        {digest ? (
          <section aria-label="While you were away" className="rounded-md bg-surface-2 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">While you were away</h3>
            <ul className="flex flex-col">
              {texts.map(([id, n]) => (
                <li key={id}>
                  <button className="pressable -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3" onClick={() => go({ kind: 'thread', npcId: id })}>
                    <Icon icon={MessageCircle} size={15} className="text-fg-3" />
                    <span className="flex-1 truncate">
                      {s.npcs[id]!.name} <span className="text-fg-2">· {n === 1 ? 'a new message' : `${n} new messages`}</span>
                    </span>
                  </button>
                </li>
              ))}
              {letters.slice(0, 3).map((m) => (
                <li key={m.id}>
                  <button className="pressable -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3" onClick={() => go({ kind: 'mail' })}>
                    <Icon icon={Mail} size={15} className="text-fg-3" />
                    <span className="flex-1 truncate">
                      {m.from} <span className="text-fg-2">· {m.kind === 'email' ? 'email' : 'letter'}: {m.subject}</span>
                    </span>
                  </button>
                </li>
              ))}
              {posts.length ? (
                <li>
                  <button className="pressable -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-3" onClick={() => go({ kind: 'feed' })}>
                    <Icon icon={Newspaper} size={15} className="text-fg-3" />
                    <span className="flex-1 truncate">
                      {posts.length === 1 ? `${posts[0]!.author} posted` : `${posts.length} new posts`}
                    </span>
                  </button>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}
        <nav aria-label="Apps" className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-5">
          {apps.map((a) => (
            <button key={a.id} onClick={a.run} className="pressable group flex flex-col items-center gap-1.5 rounded-md py-1 text-center" aria-label={a.badge ? `${a.label}, ${a.badge} new` : a.label}>
              <span className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-surface-2 text-fg transition-colors group-hover:bg-surface-3">
                <Icon icon={a.icon} size={22} />
                {a.badge ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-accent-fg">{a.badge}</span> : null}
              </span>
              <span className="w-full truncate text-xs text-fg-2">{a.label}</span>
            </button>
          ))}
          <button onClick={() => setAdding(true)} className="pressable group flex flex-col items-center gap-1.5 rounded-md py-1 text-center" aria-label="Add an app">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-line-strong text-fg-3 group-hover:text-fg">
              <Icon icon={Plus} size={20} />
            </span>
            <span className="w-full truncate text-xs text-fg-3">Add app</span>
          </button>
        </nav>
      </div>
      <NewAppSheet open={adding} onOpenChange={setAdding} />
    </ToolSheet>
  );
}

// ------------------------------------------------------------------ messages

function Messages({ state: s, avatar, go, onBack }: { state: CampaignState; avatar: (id: string) => string | undefined; go: (sc: Screen) => void; onBack: () => void }) {
  const { chat, apply } = useGame();
  const [picking, setPicking] = useState(false);
  const [grouping, setGrouping] = useState(false);
  const [gName, setGName] = useState('');
  const [gMembers, setGMembers] = useState<string[]>([]);
  const threads = useQuery({ queryKey: ['phone', chat.campaignId, s.phone.unread, s.phone.groups], queryFn: () => get<{ threads: Thread[]; groups: GroupThread[] }>(`/api/campaigns/${chat.campaignId}/phone`), enabled: !!chat.campaignId });
  const list = threads.data?.threads ?? [];
  const groups = threads.data?.groups ?? [];
  const alive = Object.values(s.npcs).filter((n) => n.status === 'alive');
  const others = alive.filter((n) => !list.some((x) => x.npcId === n.id));
  return (
    <ToolSheet
      title="Messages"
      headerActions={
        <>
          <IconButton icon={UsersRound} label="New group" disabled={alive.length < 2} onClick={() => setGrouping(true)} />
          <IconButton icon={ArrowLeft} label="Back to home" onClick={onBack} />
        </>
      }
      footer={
        picking ? (
          <Select aria-label="Text someone" autoFocus value="" onChange={(e) => e.target.value && (go({ kind: 'thread', npcId: e.target.value }), setPicking(false))} className="flex-1">
            <option value="">Text someone…</option>
            {others.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
        ) : (
          <Button variant="secondary" icon={MessageCirclePlus} block disabled={!others.length} onClick={() => setPicking(true)}>
            New message
          </Button>
        )
      }
    >
      {list.length || groups.length ? (
        <div className="flex flex-col">
          {groups.map((g) => (
            <button key={g.id} onClick={() => go({ kind: 'group', gid: g.id })} className="pressable -mx-2 flex min-h-16 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-2">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-surface-2">
                <Icon icon={UsersRound} size={18} className="text-fg-2" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{g.name}</span>
                <span className="block truncate text-sm text-fg-2">{g.last ? `${g.last.fromPlayer ? 'You' : (s.npcs[g.last.speakerId ?? '']?.name ?? '')}: ${g.last.text}` : g.members.join(', ')}</span>
              </span>
            </button>
          ))}
          {list.map((th) => (
            <button key={th.npcId} onClick={() => go({ kind: 'thread', npcId: th.npcId })} className="pressable -mx-2 flex min-h-16 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-2">
              <Avatar src={avatar(th.npcId)} name={th.name} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cx('truncate text-sm', th.unread ? 'font-semibold' : 'font-medium')}>{th.name}</span>
                  <span className="flex-1" />
                  {th.last ? <span className="flex-none text-xs text-fg-3">{relativeTime(th.last.createdAt)}</span> : null}
                </span>
                <span className={cx('block truncate text-sm', th.unread ? 'text-fg' : 'text-fg-2')}>{th.last ? `${th.last.fromPlayer ? 'You: ' : ''}${th.last.text}` : th.unread ? 'New message' : 'No messages yet'}</span>
              </span>
              {th.unread ? <Badge tone="accent">{th.unread}</Badge> : null}
            </button>
          ))}
        </div>
      ) : (
        <EmptyState icon={Smartphone} title="No texts yet" body="People who have your number text you as time passes. You can text anyone you've met." />
      )}
      <Sheet
        open={grouping}
        onOpenChange={setGrouping}
        title="New group"
        size="md"
        footer={
          <Button
            variant="primary"
            block
            disabled={!gName.trim() || gMembers.length < 2}
            onClick={async () => {
              if (await apply({ type: 'phone.group', name: gName.trim(), members: gMembers } as Op, { quiet: true })) {
                setGrouping(false);
                setGName('');
                setGMembers([]);
              }
            }}
          >
            Create group
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Group name" htmlFor="grp-name">
            <Input id="grp-name" value={gName} onChange={(e) => setGName(e.target.value)} maxLength={60} placeholder="The band" />
          </Field>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Members</legend>
            {alive.map((n) => (
              <label key={n.id} className="flex min-h-10 items-center gap-3 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={gMembers.includes(n.name)} onChange={(e) => setGMembers(e.target.checked ? [...gMembers, n.name] : gMembers.filter((x) => x !== n.name))} />
                {n.name}
              </label>
            ))}
          </fieldset>
        </div>
      </Sheet>
    </ToolSheet>
  );
}

function Bubbles({ msgs, waiting, name }: { msgs: PhoneMsg[] | null; waiting: boolean; name: (m: PhoneMsg) => string | null }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs?.length, waiting]);
  const list = (msgs ?? []).filter((m) => m.kind !== 'call');
  const lastMine = [...list].reverse().find((m) => m.fromPlayer && m.kind !== 'call-end');
  const answered = lastMine ? list.some((m) => !m.fromPlayer && m.createdAt > lastMine.createdAt) : false;
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <AnimatePresence initial={false}>
        {list.map((m) =>
          m.kind === 'call-end' ? (
            <p key={m.id} className="my-1 flex items-center justify-center gap-1.5 text-xs text-fg-3">
              <Icon icon={PhoneIcon} size={12} /> {m.text}
            </p>
          ) : (
            <motion.div key={m.id} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={t.base} className={cx('flex flex-col', m.fromPlayer ? 'items-end' : 'items-start')}>
              {!m.fromPlayer && name(m) ? <span className="mb-0.5 px-1 text-xs text-fg-3">{name(m)}</span> : null}
              <p className={cx('max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-[15px] leading-snug', m.fromPlayer ? 'rounded-br-sm bg-accent text-accent-fg' : 'rounded-bl-sm bg-surface-2 text-fg')}>{m.text}</p>
              {m === lastMine && !waiting ? <span className="mt-0.5 px-1 text-[11px] text-fg-3">{answered ? 'Read' : 'Delivered'}</span> : null}
            </motion.div>
          ),
        )}
      </AnimatePresence>
      {waiting ? (
        <div className="flex justify-start">
          <span className="rounded-lg rounded-bl-sm bg-surface-2 px-3 py-2.5">
            <Typing />
          </span>
        </div>
      ) : null}
      <div ref={end} />
    </div>
  );
}

function Composer({ label, onSend, disabled }: { label: string; onSend: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState('');
  const send = () => {
    const body = text.trim();
    if (!body || disabled) return;
    setText('');
    onSend(body);
  };
  return (
    <div className="flex w-full items-end gap-2">
      <Textarea
        aria-label={label}
        placeholder="Text message"
        value={text}
        maxRows={5}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) {
            e.preventDefault();
            send();
          }
        }}
        className="min-h-11 flex-1"
        maxLength={1000}
      />
      <IconButton icon={Send} label="Send text" tone="accent" disabled={!text.trim() || disabled} onClick={send} />
    </div>
  );
}

function ThreadView({ npcId, state: s, onBack, onCall, avatar }: { npcId: string; state: CampaignState; onBack: () => void; onCall: () => void; avatar?: string | null }) {
  const { chat } = useGame();
  const qc = useQueryClient();
  const npc = s.npcs[npcId]!;
  const [msgs, setMsgs] = useState<PhoneMsg[] | null>(null);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    let live = true;
    setWaiting(!!s.phone.unread[npcId]);
    post<{ messages: PhoneMsg[]; state: CampaignState; error: string | null }>(`/api/campaigns/${chat.campaignId}/phone/${npcId}/open`, { chatId: chat.id })
      .then((r) => {
        if (!live) return;
        setMsgs(r.messages);
        setCampaignState(chat.campaignId!, r.state);
        if (r.error) toast({ title: 'Could not load new texts', lines: [r.error], tone: 'danger' });
      })
      .catch((e) => live && (toastError(e), setMsgs([])))
      .finally(() => live && setWaiting(false));
    return () => {
      live = false;
    };
  }, [npcId]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (body: string) => {
    const temp: PhoneMsg = { id: `tmp-${Date.now()}`, npcId, fromPlayer: true, text: body, gameTime: null, createdAt: Date.now() };
    setMsgs((m) => [...(m ?? []), temp]);
    setWaiting(true);
    try {
      const r = await post<{ sent: PhoneMsg; reply: PhoneMsg | null; error: string | null }>(`/api/campaigns/${chat.campaignId}/phone/${npcId}`, { chatId: chat.id, text: body });
      setMsgs((m) => [...(m ?? []).filter((x) => x.id !== temp.id), r.sent, ...(r.reply ? [r.reply] : [])]);
      if (r.error) toast({ title: `${npc.name} didn't answer`, lines: [r.error], tone: 'danger' });
      void qc.invalidateQueries({ queryKey: ['phone', chat.campaignId] });
    } catch (e) {
      toastError(e);
      setMsgs((m) => (m ?? []).filter((x) => x.id !== temp.id));
    } finally {
      setWaiting(false);
    }
  };

  return (
    <ToolSheet
      title={npc.name}
      description={npc.status !== 'alive' ? 'No longer reachable' : npc.role && npc.role !== 'NPC' ? npc.role : 'Messages'}
      headerActions={
        <>
          {hasEmail(s) ? <IconButton icon={PhoneIcon} label={`Call ${npc.name}`} disabled={npc.status !== 'alive'} onClick={onCall} /> : null}
          <IconButton icon={ArrowLeft} label="All messages" onClick={onBack} />
        </>
      }
      footer={<Composer label={`Message ${npc.name}`} onSend={send} disabled={waiting || npc.status !== 'alive'} />}
    >
      <div className="mb-1 mt-2 flex flex-col items-center gap-2">
        <Avatar src={avatar} name={npc.name} size="lg" />
      </div>
      {msgs !== null && !msgs.length ? <p className="py-6 text-center text-sm text-fg-3">Say hi.</p> : null}
      <Bubbles msgs={msgs} waiting={waiting} name={() => null} />
    </ToolSheet>
  );
}

function GroupView({ gid, state: s, onBack }: { gid: string; state: CampaignState; onBack: () => void }) {
  const { chat, apply } = useGame();
  const g = s.phone.groups?.[gid];
  const [msgs, setMsgs] = useState<PhoneMsg[] | null>(null);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    get<{ messages: PhoneMsg[] }>(`/api/campaigns/${chat.campaignId}/phone-groups/${gid}`)
      .then((r) => setMsgs(r.messages))
      .catch((e) => (toastError(e), setMsgs([])));
  }, [gid]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g) return null;
  const send = async (body: string) => {
    const temp: PhoneMsg = { id: `tmp-${Date.now()}`, npcId: `group:${gid}`, fromPlayer: true, text: body, gameTime: null, createdAt: Date.now() };
    setMsgs((m) => [...(m ?? []), temp]);
    setWaiting(true);
    try {
      const r = await post<{ sent: PhoneMsg; reply: PhoneMsg | null; error: string | null }>(`/api/campaigns/${chat.campaignId}/phone-groups/${gid}`, { chatId: chat.id, text: body });
      setMsgs((m) => [...(m ?? []).filter((x) => x.id !== temp.id), r.sent, ...(r.reply ? [r.reply] : [])]);
      if (r.error) toast({ title: 'Nobody answered', lines: [r.error], tone: 'danger' });
    } catch (e) {
      toastError(e);
      setMsgs((m) => (m ?? []).filter((x) => x.id !== temp.id));
    } finally {
      setWaiting(false);
    }
  };
  return (
    <ToolSheet
      title={g.name}
      description={g.members.map((id) => s.npcs[id]?.name ?? '?').join(', ')}
      headerActions={<IconButton icon={ArrowLeft} label="All messages" onClick={onBack} />}
      footer={<Composer label={`Message ${g.name}`} onSend={send} disabled={waiting} />}
    >
      {msgs !== null && !msgs.length ? <p className="py-6 text-center text-sm text-fg-3">Start the conversation. Name someone to ask them directly.</p> : null}
      <Bubbles msgs={msgs} waiting={waiting} name={(m) => s.npcs[m.speakerId ?? '']?.name ?? null} />
      <div className="mt-4 flex justify-center">
        <Button size="sm" variant="quiet" onClick={async () => (await apply({ type: 'phone.group', name: g.name, remove: true } as Op, { quiet: true })) && onBack()}>
          Leave group
        </Button>
      </div>
    </ToolSheet>
  );
}

// ------------------------------------------------------------------ calls

function CallView({ npcId, state: s, avatar, onEnd }: { npcId: string; state: CampaignState; avatar?: string | null; onEnd: () => void }) {
  const { chat } = useGame();
  const npc = s.npcs[npcId]!;
  const [lines, setLines] = useState<PhoneMsg[]>([]);
  const [waiting, setWaiting] = useState(true);
  const [ending, setEnding] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const exchanges = lines.filter((l) => !l.fromPlayer).length;
  const say = async (text: string) => {
    setWaiting(true);
    try {
      const r = await post<{ answered: boolean; reason?: string; said: PhoneMsg | null; reply?: PhoneMsg }>(`/api/campaigns/${chat.campaignId}/phone/${npcId}/call`, { chatId: chat.id, text });
      if (!r.answered) {
        toast({ title: r.reason ?? 'No answer' });
        onEnd();
        return;
      }
      setLines((l) => [...l, ...(r.said ? [r.said] : []), ...(r.reply ? [r.reply] : [])]);
    } catch (e) {
      toastError(e);
    } finally {
      setWaiting(false);
    }
  };
  useEffect(() => {
    void say('');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [lines.length, waiting]);
  const hangUp = async () => {
    setEnding(true);
    try {
      const r = await post<{ state: CampaignState; minutes: number }>(`/api/campaigns/${chat.campaignId}/phone/${npcId}/call/end`, { chatId: chat.id, exchanges });
      setCampaignState(chat.campaignId!, r.state);
    } catch (e) {
      toastError(e);
    } finally {
      onEnd();
    }
  };
  return (
    <ToolSheet
      title={`Call with ${npc.name}`}
      description={waiting && !lines.length ? 'Ringing…' : `${Math.max(1, exchanges * 2)} min`}
      footer={
        <div className="flex w-full flex-col gap-2">
          <Composer label={`Say to ${npc.name}`} onSend={say} disabled={waiting || ending} />
          <Button variant="danger" icon={PhoneOff} block loading={ending} onClick={hangUp}>
            Hang up
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-2 py-3">
        <Avatar src={avatar} name={npc.name} size="lg" />
      </div>
      <ol className="flex flex-col gap-2" aria-label="Call transcript" aria-live="polite">
        {lines.map((l) => (
          <li key={l.id} className={cx('text-[15px] leading-snug', l.fromPlayer ? 'text-fg-2' : 'text-fg')}>
            <span className="mr-1.5 text-xs font-medium uppercase tracking-wide text-fg-3">{l.fromPlayer ? 'You' : npc.name}</span>
            {l.text}
          </li>
        ))}
        {waiting ? (
          <li>
            <Typing />
          </li>
        ) : null}
      </ol>
      <div ref={end} />
    </ToolSheet>
  );
}
