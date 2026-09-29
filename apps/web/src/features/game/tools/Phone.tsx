import type { CampaignState } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MessageCirclePlus, Send, Smartphone } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { get, post } from '@/lib/api';
import { cx, relativeTime } from '@/lib/format';
import { t } from '@/lib/motion';
import { setCampaignState, useCharacters } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Avatar, Badge, Button, EmptyState, IconButton, Select, Textarea, Typing } from '@/ui';
import { useGame } from '../context';
import { NoCampaign, ToolSheet } from './ToolSheet';

interface PhoneMsg {
  id: string;
  npcId: string;
  fromPlayer: boolean;
  text: string;
  gameTime: number | null;
  createdAt: number;
}
interface Thread {
  npcId: string;
  name: string;
  portrait: string | null;
  characterId: string | null;
  unread: number;
  last: PhoneMsg | null;
}

export default function Phone({ arg }: { arg?: string }) {
  const { state: s, chat } = useGame();
  const [npcId, setNpcId] = useState<string | null>(arg ?? null);
  const [picking, setPicking] = useState(false);
  const threads = useQuery({ queryKey: ['phone', chat.campaignId, s?.phone.unread], queryFn: () => get<{ threads: Thread[] }>(`/api/campaigns/${chat.campaignId}/phone`), enabled: !!chat.campaignId });
  const chars = useCharacters();
  if (!s) return <ToolSheet title="Phone"><NoCampaign /></ToolSheet>;
  const avatar = (portrait: string | null, characterId: string | null) => (portrait ? `/media/${portrait}` : chars.data?.find((c) => c.id === characterId)?.avatar);
  const list = threads.data?.threads ?? [];
  const others = Object.values(s.npcs).filter((n) => n.status === 'alive' && !list.some((x) => x.npcId === n.id));

  if (npcId && s.npcs[npcId]) return <ThreadView npcId={npcId} state={s} onBack={() => setNpcId(null)} avatar={avatar(s.npcs[npcId].portrait ?? null, s.npcs[npcId].characterId ?? null)} />;

  return (
    <ToolSheet
      title="Phone"
      description="Texts with the people you know"
      footer={
        picking ? (
          <Select aria-label="Text someone" autoFocus value="" onChange={(e) => e.target.value && (setNpcId(e.target.value), setPicking(false))} className="flex-1">
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
      {list.length ? (
        <div className="flex flex-col">
          {list.map((th) => (
            <button key={th.npcId} onClick={() => setNpcId(th.npcId)} className="pressable -mx-2 flex min-h-16 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-2">
              <Avatar src={avatar(th.portrait, th.characterId)} name={th.name} />
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
    </ToolSheet>
  );
}

function ThreadView({ npcId, state: s, onBack, avatar }: { npcId: string; state: CampaignState; onBack: () => void; avatar?: string | null }) {
  const { chat } = useGame();
  const qc = useQueryClient();
  const npc = s.npcs[npcId];
  const [msgs, setMsgs] = useState<PhoneMsg[] | null>(null);
  const [text, setText] = useState('');
  const [waiting, setWaiting] = useState(false);
  const end = useRef<HTMLDivElement>(null);
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
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs?.length, waiting]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
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
      setText(body);
    } finally {
      setWaiting(false);
    }
  };

  return (
    <ToolSheet
      title={npc.name}
      description={npc.status !== 'alive' ? 'No longer reachable' : npc.role && npc.role !== 'NPC' ? npc.role : 'Messages'}
      headerActions={<IconButton icon={ArrowLeft} label="All messages" onClick={onBack} />}
      footer={
        <div className="flex w-full items-end gap-2">
          <Textarea
            aria-label={`Message ${npc.name}`}
            placeholder="Text message"
            value={text}
            maxRows={5}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            className="min-h-11 flex-1"
            maxLength={1000}
          />
          <IconButton icon={Send} label="Send text" tone="accent" disabled={!text.trim() || waiting || npc.status !== 'alive'} onClick={send} />
        </div>
      }
    >
      <div className="flex flex-col gap-1.5 py-2">
        <div className="mb-3 flex flex-col items-center gap-2">
          <Avatar src={avatar} name={npc.name} size="lg" />
        </div>
        {msgs === null ? null : msgs.length ? null : <p className="py-6 text-center text-sm text-fg-3">Say hi.</p>}
        <AnimatePresence initial={false}>
          {(msgs ?? []).map((m) => (
            <motion.div key={m.id} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={t.base} className={cx('flex', m.fromPlayer ? 'justify-end' : 'justify-start')}>
              <p className={cx('max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-[15px] leading-snug', m.fromPlayer ? 'rounded-br-sm bg-accent text-accent-fg' : 'rounded-bl-sm bg-surface-2 text-fg')}>{m.text}</p>
            </motion.div>
          ))}
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
    </ToolSheet>
  );
}
