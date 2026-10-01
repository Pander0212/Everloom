import type { CampaignState, Op } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cat, Check, Eraser, Send, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { del, get, post } from '@/lib/api';
import { cx } from '@/lib/format';
import { t } from '@/lib/motion';
import { setCampaignState } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Button, Icon, IconButton, Input, Textarea, Typing } from '@/ui';
import { useGame } from '../context';
import { ToolSheet } from './ToolSheet';

interface HelperMsg {
  id: string;
  role: 'user' | 'helper';
  text: string;
  proposal: Op[] | null;
  status: 'none' | 'pending' | 'accepted' | 'rejected';
  createdAt: number;
}

const NAME_KEY = 'everloom.helperName';
const SUGGESTIONS = ['What should I do next?', 'How am I doing?', 'How does travel work?', 'Remind me what happened.'];

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || 'Pip';
  } catch {
    return 'Pip';
  }
}

function describeOp(op: any): string {
  switch (op.type) {
    case 'item.add':
      return `Add ${op.qty && op.qty > 1 ? `${op.qty}× ` : ''}${op.name}`;
    case 'item.remove':
      return `Remove ${op.name}`;
    case 'currency.delta':
      return `${op.amount >= 0 ? 'Gain' : 'Spend'} ${Math.abs(op.amount)} money`;
    case 'tracker.set':
      return `Set ${op.id} to ${op.value}`;
    case 'tracker.delta':
      return `${op.id} ${op.delta >= 0 ? '+' : ''}${op.delta}`;
    case 'time.advance':
      return `Let ${op.minutes} minutes pass`;
    case 'quest.add':
      return `New quest: ${op.title}`;
    case 'databank.add':
      return `Remember: ${op.text}`;
    case 'event.add':
      return `Calendar: ${op.title}`;
    case 'skillnode.add':
      return `New skill to learn: ${op.name}${op.class ? ` (${op.class})` : ''}${op.level > 1 ? `, from level ${op.level}` : ''}`;
    case 'class.define':
      return `New class: ${op.name}`;
    default:
      return op.type.replace('.', ' ');
  }
}

export default function Helper() {
  const { chat } = useGame();
  const qc = useQueryClient();
  const [name, setName] = useState(readName);
  const [renaming, setRenaming] = useState(false);
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const key = ['helper', chat.campaignId ?? null];
  const msgs = useQuery({ queryKey: key, queryFn: () => get<HelperMsg[]>('/api/helper', chat.campaignId ? { campaignId: chat.campaignId } : undefined) });
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs.data?.length, thinking]);

  const ask = async (q: string) => {
    const body = q.trim();
    if (!body || thinking) return;
    setText('');
    qc.setQueryData<HelperMsg[]>(key, (x) => [...(x ?? []), { id: `tmp-${Date.now()}`, role: 'user', text: body, proposal: null, status: 'none', createdAt: Date.now() }]);
    setThinking(true);
    try {
      await post('/api/helper/ask', { text: body, chatId: chat.id, name });
    } catch (e) {
      toastError(e);
    } finally {
      setThinking(false);
      await qc.invalidateQueries({ queryKey: key });
    }
  };
  const decide = async (m: HelperMsg, decision: 'accept' | 'reject') => {
    try {
      const r = await post<{ status: string; state?: CampaignState; summary?: string[] }>(`/api/helper/${m.id}/${decision}`, { chatId: chat.id });
      if (r.state && chat.campaignId) setCampaignState(chat.campaignId, r.state);
      if (r.summary?.length) toast({ title: 'Updated', lines: r.summary });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toastError(e);
    }
  };

  const list = msgs.data ?? [];
  return (
    <ToolSheet
      title={
        renaming ? (
          <Input
            autoFocus
            aria-label="Helper name"
            defaultValue={name}
            maxLength={24}
            className="h-9 w-40"
            onBlur={(e) => {
              const v = e.target.value.trim() || 'Pip';
              setName(v);
              try {
                localStorage.setItem(NAME_KEY, v);
              } catch {
                /* private mode */
              }
              setRenaming(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button onClick={() => setRenaming(true)} className="pressable rounded-sm" aria-label={`Rename ${name}`}>
            {name}
          </button>
        )
      }
      description="Your little helper. Asks before changing anything."
      headerActions={
        list.length ? (
          <IconButton
            icon={Eraser}
            label="Clear conversation"
            onClick={async () => {
              await del(`/api/helper${chat.campaignId ? `?campaignId=${encodeURIComponent(chat.campaignId)}` : ''}`).catch(toastError);
              await qc.invalidateQueries({ queryKey: key });
            }}
          />
        ) : null
      }
      footer={
        <div className="flex w-full items-end gap-2">
          <Textarea
            aria-label={`Ask ${name}`}
            placeholder={`Ask ${name}…`}
            value={text}
            maxRows={4}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) {
                e.preventDefault();
                void ask(text);
              }
            }}
            className="min-h-11 flex-1"
            maxLength={2000}
          />
          <IconButton icon={Send} label="Ask" tone="accent" disabled={!text.trim() || thinking} onClick={() => ask(text)} />
        </div>
      }
    >
      <div className="flex flex-col gap-3 py-1">
        {!list.length ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <motion.span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-accent-text" animate={{ y: [0, -4, 0] }} transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}>
              <Icon icon={Cat} size={32} />
            </motion.span>
            <p className="max-w-[280px] text-sm text-fg-2">Hi, I’m {name}. Ask me about your game, or how something in Everloom works.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((q) => (
                <Button key={q} size="sm" variant="secondary" onClick={() => ask(q)}>
                  {q}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <AnimatePresence initial={false}>
          {list.map((m) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={t.base} className={cx('flex gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              {m.role === 'helper' ? (
                <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent-soft text-accent-text">
                  <Icon icon={Cat} size={18} />
                </span>
              ) : null}
              <div className={cx('max-w-[85%] rounded-lg px-3 py-2 text-sm', m.role === 'user' ? 'rounded-br-sm bg-accent text-accent-fg' : 'rounded-bl-sm bg-surface-2')}>
                <p className="whitespace-pre-wrap">{m.text}</p>
                {m.proposal?.length ? (
                  <div className="mt-2 rounded-md bg-surface p-2">
                    <ul className="flex flex-col gap-1 text-xs text-fg-2">
                      {m.proposal.map((op, i) => (
                        <li key={i}>{describeOp(op)}</li>
                      ))}
                    </ul>
                    {m.status === 'pending' ? (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="primary" icon={Check} onClick={() => decide(m, 'accept')}>
                          Do it
                        </Button>
                        <Button size="sm" variant="ghost" icon={X} onClick={() => decide(m, 'reject')}>
                          No thanks
                        </Button>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-xs text-fg-3">{m.status === 'accepted' ? 'Done' : 'Declined'}</p>
                    )}
                  </div>
                ) : null}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {thinking ? (
          <div className="flex gap-2">
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent-soft text-accent-text">
              <Icon icon={Cat} size={18} />
            </span>
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
