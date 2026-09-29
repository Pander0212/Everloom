import type { CampaignDTO, CharacterDTO, ChatDTO, MessageDTO } from '@everloom/engine';
import { stripInlineTags } from '@everloom/engine';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, History, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { get } from '@/lib/api';
import { cx } from '@/lib/format';
import { renderStory } from '@/lib/render';
import { t } from '@/lib/motion';
import { qk, useGroups, usePersonas } from '@/lib/queries';
import { Avatar, IconButton, Sheet } from '@/ui';
import type { MessageActions } from '@/features/story/Message';
import { Atmosphere } from './Atmosphere';

export interface StageProps {
  chat: ChatDTO;
  messages: MessageDTO[];
  campaign: CampaignDTO | null;
  busy: boolean;
  actions: MessageActions;
  streamText: string | null;
  streamingId: string | null;
  composer: ReactNode;
}

function useTypewriter(text: string, key: string, instant: boolean) {
  const [shown, setShown] = useState(instant ? text.length : 0);
  const done = useRef(instant);
  useEffect(() => {
    done.current = instant;
    setShown(instant ? text.length : 0);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (done.current) {
      setShown(text.length);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const add = Math.max(1, Math.floor((now - last) / 14));
      last = now;
      setShown((s) => {
        const next = Math.min(text.length, s + add);
        if (next >= text.length) done.current = true;
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  return { shown: Math.min(shown, text.length), finish: () => ((done.current = true), setShown(text.length)), complete: shown >= text.length };
}

export default function Stage({ chat, messages, campaign, busy, actions, streamText, streamingId, composer }: StageProps) {
  const visible = useMemo(() => messages.filter((m) => !m.hidden), [messages]);
  const [idx, setIdx] = useState(visible.length - 1);
  const [log, setLog] = useState(false);
  const atEnd = useRef(true);
  const groups = useGroups();
  const personas = usePersonas();
  const qc = useQueryClient();
  const group = chat.groupId ? groups.data?.find((g) => g.id === chat.groupId) : null;
  const memberIds = group ? group.members.map((m) => m.characterId) : chat.characterId ? [chat.characterId] : [];
  const chars = useQueries({ queries: memberIds.map((id) => ({ queryKey: qk.character(id), queryFn: () => get<CharacterDTO>(`/api/characters/${id}`) })) }).map((q) => q.data).filter(Boolean) as CharacterDTO[];
  const persona = personas.data?.find((p) => p.id === chat.personaId) ?? personas.data?.find((p) => p.isDefault);

  useEffect(() => {
    if (atEnd.current) setIdx(visible.length - 1);
  }, [visible.length]);
  useEffect(() => {
    if (streamingId) {
      const i = visible.findIndex((m) => m.id === streamingId);
      if (i >= 0) setIdx(i);
    }
  }, [streamingId, visible]);
  const m = visible[Math.max(0, Math.min(idx, visible.length - 1))];
  atEnd.current = idx >= visible.length - 1;
  const live = m && streamingId === m.id ? streamText ?? '' : null;
  const text = stripInlineTags(live ?? m?.swipes[m.swipeId]?.text ?? '');
  const tw = useTypewriter(text, `${m?.id}:${m?.swipeId}`, !!live || !atEnd.current || Date.now() - (m?.updatedAt ?? 0) > 20000);
  const html = useMemo(() => renderStory(text.slice(0, tw.shown)), [text, tw.shown]);
  const speaker = m?.role === 'assistant' ? chars.find((c) => c.id === m.characterId) ?? chars[0] : null;
  const emotion = (m?.extra?.emotion as string) || 'neutral';
  const spriteFor = (c: CharacterDTO, emo: string) => {
    const ex = c.game?.expressions ?? {};
    const id = ex[emo] ?? ex.neutral;
    return id ? `/media/${id}` : c.avatar;
  };
  const bg = chat.metadata.background ? `/media/${chat.metadata.background}` : null;
  const lastAssistant = [...visible].reverse().find((x) => x.role === 'assistant');
  const isLast = m && m.id === visible[visible.length - 1]?.id;
  void qc;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-2">
      {/* Scene */}
      <div className="absolute inset-0">
        {bg ? <img src={bg} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full" style={{ background: 'radial-gradient(120% 90% at 50% 20%, var(--surface-3), var(--bg))' }} />}
        <Atmosphere state={campaign?.state ?? null} />
      </div>
      {/* Sprites */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 flex items-end justify-center gap-0 px-2 pb-[38%] sm:pb-[22%]">
        {chars.map((c) => {
          const active = speaker?.id === c.id || chars.length === 1;
          const src = spriteFor(c, active ? emotion : 'neutral');
          return (
            <motion.div key={c.id} className="relative h-[62%] max-h-[640px] min-w-0 flex-1" animate={{ opacity: active ? 1 : 0.55, scale: active ? 1 : 0.96, y: active ? 0 : 8 }} transition={t.slow} style={{ maxWidth: chars.length > 1 ? `${90 / chars.length}%` : '70%' }}>
              <AnimatePresence initial={false}>
                {src ? <motion.img key={src} src={src} alt={c.name} className="absolute inset-0 h-full w-full object-contain object-bottom" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} /> : null}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
      <div className="relative z-10 mt-auto">
        {/* Dialogue box */}
        {m ? (
          <div className="mx-auto w-full max-w-[760px] px-3 sm:px-4">
            <div className="flex items-center gap-1 pb-1.5">
              <span className="rounded-sm bg-surface px-2.5 py-1 text-sm font-semibold text-fg shadow-1">{m.role === 'user' ? persona?.name ?? m.name : m.name}</span>
              <span className="flex-1" />
              <IconButton size="sm" icon={History} label="History" className="!bg-surface shadow-1" onClick={() => setLog(true)} />
            </div>
            <button
              type="button"
              onClick={() => (tw.complete ? (idx < visible.length - 1 ? setIdx(idx + 1) : undefined) : tw.finish())}
              className="block max-h-[34dvh] w-full overflow-y-auto rounded-lg bg-surface px-4 py-3 text-left shadow-3 [&_.story]:text-[16px] sm:max-h-[30dvh]"
              aria-label="Dialogue — tap to reveal or advance"
            >
              {text ? <div className="story" dangerouslySetInnerHTML={{ __html: html }} /> : <span className="typing"><span /><span /><span /></span>}
            </button>
            <div className="flex items-center justify-between py-1 text-fg-2">
              <div className="flex items-center gap-0.5 rounded-md bg-surface/90 shadow-1">
                <IconButton size="sm" icon={ChevronLeft} label="Previous line" disabled={idx <= 0} onClick={() => setIdx(idx - 1)} />
                <span className="w-12 text-center text-xs tabular-nums">
                  {Math.min(idx, visible.length - 1) + 1}/{visible.length}
                </span>
                <IconButton size="sm" icon={ChevronRight} label="Next line" disabled={idx >= visible.length - 1} onClick={() => setIdx(idx + 1)} />
              </div>
              {isLast && m.role === 'assistant' && lastAssistant?.id === m.id ? (
                <div className="flex items-center gap-0.5 rounded-md bg-surface/90 shadow-1">
                  <IconButton size="sm" icon={ChevronLeft} label="Previous swipe" disabled={busy || m.swipeId === 0} onClick={() => actions.onSwipe(m, -1)} />
                  <span className="w-10 text-center text-xs tabular-nums">
                    {m.swipeId + 1}/{m.swipes.length}
                  </span>
                  <IconButton size="sm" icon={ChevronRight} label={m.swipeId === m.swipes.length - 1 ? 'New swipe' : 'Next swipe'} disabled={busy} onClick={() => actions.onSwipe(m, 1)} />
                  <IconButton size="sm" icon={RefreshCw} label="Regenerate" disabled={busy} onClick={actions.onRegenerate} />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="bg-gradient-to-t from-bg from-40% to-transparent">{composer}</div>
      </div>
      <Sheet open={log} onOpenChange={setLog} title="History" size="lg">
        <div className="flex flex-col divide-y divide-line">
          {visible.map((x, i) => (
            <button
              key={x.id}
              onClick={() => {
                setIdx(i);
                setLog(false);
              }}
              className={cx('pressable flex gap-3 py-3 text-left', i === idx && 'bg-accent-soft')}
            >
              <Avatar name={x.name} src={x.role === 'user' ? persona?.avatar : chars.find((c) => c.id === x.characterId)?.avatar} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-fg-2">{x.name}</span>
                <span className="line-clamp-3 text-sm">{stripInlineTags(x.swipes[x.swipeId]?.text ?? '')}</span>
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
