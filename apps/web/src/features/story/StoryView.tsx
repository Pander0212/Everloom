import type { MessageDTO } from '@everloom/engine';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, BookText, Brain, Clapperboard, Code2, Eye, FastForward, History, Minimize2, MoreHorizontal, NotebookPen, PanelRight, Save, Search, ScrollText, ShieldQuestion, Sparkles, Telescope, UserRoundPen, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { del, get, patch, post } from '@/lib/api';
import { useLive } from '@/lib/events';
import { cx } from '@/lib/format';
import { t } from '@/lib/motion';
import { FeaturesContext, useFeatures } from '@/lib/features';
import { qk, upsertMessage, useCampaign, useCharacter, useChat, useGroups, useMessages, useSettings } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Avatar, Button, confirm, IconButton, Menu, Spinner } from '@/ui';
import { Composer } from './Composer';
import { generate, stop, useGen } from './gen';
import { Message, type MessageActions } from './Message';
import { WorldInspector } from '../inspector/WorldInspector';
import { MemorySheet } from '../memory/MemorySheet';
import { ChatInfoSheet, InspectorSheet, NoteSheet, SearchSheet } from './sheets';
import { speak } from './tts';
import { GameLayer } from '@/features/game/GameLayer';
import type { Command } from '@/features/game/CommandMenu';
import { SavesSheet, ViewSheet } from './SavesSheet';
import { scriptBus } from '@/scripting/bus';
import { isCommand, runSlashLine, setChatActions } from '@/scripting/commands';
import { whenStarted } from '@/scripting/registry';
import { ScriptViewContext, type ScriptView } from '@/scripting/context';
import { QuickBar } from '@/scripting/QuickBar';
import { ReviewSheet } from '@/scripting/ReviewSheet';
import { ScriptsSheet } from '@/scripting/ScriptsSheet';
import { SlashSuggest } from '@/scripting/SlashSuggest';
import { openExtensionPanel } from '@/scripting/ui-store';
import type { ReviewTarget } from '@/scripting/types';
import { useScripts } from '@/scripting/useScripts';

const Stage = lazy(() => import('@/features/game/Stage'));
// The script sandbox only loads when this chat has something to run.
const ScriptLayer = lazy(() => import('@/scripting/ScriptLayer'));
// Game-only pieces: not downloaded unless the game layer is on.
const CastStrip = lazy(() => import('../game/CastStrip').then((m) => ({ default: m.CastStrip })));
const ComposerChips = lazy(() => import('@/features/game/ComposerChips').then((m) => ({ default: m.ComposerChips })));

const PAGE = 80;

export default function StoryView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const chat = useChat(id);
  const messages = useMessages(id);
  const settings = useSettings();
  const groups = useGroups();
  const character = useCharacter(chat.data?.characterId);
  // Game layer off for this chat: the game's data stays on the server but isn't loaded or shown.
  const features = useFeatures(chat.data?.metadata);
  const gameOn = !!chat.data?.campaignId && features.on.game;
  const campaign = useCampaign(gameOn ? chat.data?.campaignId : null);
  const gen = useGen();
  const streams = useLive((s) => s.streams);
  const [composer, setComposer] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [sheet, setSheet] = useState<null | 'inspector' | 'search' | 'note' | 'memory' | 'info' | 'world' | 'saves' | 'view' | 'scripts'>(null);
  const scripts = useScripts(id);
  const [review, setReview] = useState<ReviewTarget | null>(null);
  const [pendingSeen, setPendingSeen] = useState(false);
  const [cinematic, setCinematic] = useState(false);
  useEffect(() => {
    if (!cinematic) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setCinematic(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cinematic]);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);

  const busy = gen.chatId === id || Object.keys(streams).some((mid) => messages.data?.some((m) => m.id === mid));
  const group = chat.data?.groupId ? groups.data?.find((g) => g.id === chat.data!.groupId) : null;
  const mode = features.on.stage ? (chat.data?.metadata.mode ?? 'chat') : 'chat';
  const list = messages.data ?? [];
  const visible = list.slice(Math.max(0, list.length - limit));
  const lastAssistant = [...list].reverse().find((m) => m.role === 'assistant');

  // Avatars for group members come from the characters list cache.
  const avatarFor = useCallback(
    (m: MessageDTO) => {
      if (m.role === 'user') return null;
      if (character.data && m.characterId === character.data.id) return character.data.avatar;
      const all = qc.getQueryData<any[]>(qk.characters);
      return all?.find((c) => c.id === m.characterId)?.avatar ?? null;
    },
    [character.data, qc],
  );

  // Keep the view pinned to the bottom while new text arrives, unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  }, [list.length, gen.text, streams, stuck, mode]);
  useEffect(() => {
    setLimit(PAGE);
    setStuck(true);
  }, [id]);
  useEffect(() => {
    if (gameOn && features.on.time && chat.data?.campaignId) void post(`/api/campaigns/${chat.data.campaignId}/tick`, { chatId: id }).catch(() => {});
  }, [chat.data?.campaignId, id, gameOn, features.on.time]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };
  // Opened from a search hit (?m=<message id>): jump there once the messages are in.
  const [params, setParams] = useSearchParams();
  const wantMsg = params.get('m');
  useEffect(() => {
    if (!wantMsg || !list.some((m) => m.id === wantMsg)) return;
    jumpTo(wantMsg);
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantMsg, list.length]);
  const jumpTo = (mid: string) => {
    const idx = list.findIndex((m) => m.id === mid);
    if (idx >= 0 && list.length - idx > limit) setLimit(list.length - idx + 10);
    setSheet(null);
    setStuck(false);
    setTimeout(() => {
      document.getElementById(`msg-${mid}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setHighlight(mid);
      setTimeout(() => setHighlight(null), 1800);
    }, 60);
  };

  const run = async (type: Parameters<typeof generate>[1], text?: string) => {
    setStuck(true);
    // Scripts see the turn: a hook before it (they may set variables), then what happened.
    if (scripts.runnable.length || scripts.extensions.length) {
      if (type !== 'impersonate') await scriptBus.beforeGeneration({ chatId: id, type });
      scriptBus.emit('generationStart', { chatId: id, type });
    }
    const r = await generate(id, type, { text, characterId: speaker, target: type === 'normal' && text ? target : null });
    if (scripts.runnable.length || scripts.extensions.length) {
      const after = qc.getQueryData<MessageDTO[]>(qk.messages(id)) ?? [];
      const lastA = [...after].reverse().find((x) => x.role === 'assistant');
      const lastU = [...after].reverse().find((x) => x.role === 'user');
      if (text && lastU) scriptBus.emit('messageSent', { chatId: id, messageId: lastU.id, messageIndex: after.indexOf(lastU) });
      scriptBus.emit('generationEnd', { chatId: id, type });
      if (lastA && type !== 'impersonate') scriptBus.emit(type === 'swipe' ? 'swipe' : 'message', { chatId: id, messageId: lastA.id, messageIndex: after.indexOf(lastA) });
      // Lorebook scripts that run when their entry activates: the reply's activated entries.
      if (type !== 'impersonate' && scripts.runnable.some((s) => s.script.triggers.includes('entryActivated'))) {
        const last = await get<{ worldInfo?: Array<{ world: string; uid: number }> } | null>(`/api/chats/${id}/prompt`).catch(() => null);
        if (last?.worldInfo?.length) scriptBus.emit('entryActivated', { chatId: id, entries: last.worldInfo.map((w) => ({ book: w.world, uid: w.uid })) });
      }
    }
    if (settings.data?.chat.autoTts && features.on.voice && type !== 'impersonate') {
      const last = qc.getQueryData<MessageDTO[]>(qk.messages(id))?.at(-1);
      if (last?.role === 'assistant') void speak(last.swipes[last.swipeId]?.text ?? '', { settings: settings.data, voice: character.data?.game.voice?.voice, speed: character.data?.game.voice?.speed, reference: refOf(character.data?.game.voice) }).catch(() => {});
    }
    return r;
  };

  const actions: MessageActions = useMemo(
    () => ({
      onSwipe: async (m, dir) => {
        const next = m.swipeId + dir;
        if (dir === 1 && next >= m.swipes.length) {
          if (m.id === lastAssistant?.id && list[list.length - 1]?.id === m.id) void run('swipe');
          return;
        }
        if (next < 0) return;
        upsertMessage({ ...m, swipeId: next });
        try {
          upsertMessage(await post(`/api/messages/${m.id}/swipe`, { swipeId: next }));
          scriptBus.emit('swipe', { chatId: id, messageId: m.id, messageIndex: list.findIndex((x) => x.id === m.id) });
        } catch (e) {
          upsertMessage(m);
          toastError(e);
        }
      },
      onEdit: async (m, text) => {
        try {
          upsertMessage(await patch(`/api/messages/${m.id}`, { text }));
          scriptBus.emit('edit', { chatId: id, messageId: m.id, messageIndex: list.findIndex((x) => x.id === m.id) });
        } catch (e) {
          toastError(e);
        }
      },
      onDelete: async (m, andAfter) => {
        const count = andAfter ? list.length - list.findIndex((x) => x.id === m.id) : 1;
        if (!(await confirm({ title: count > 1 ? `Delete ${count} messages?` : 'Delete this message?', description: 'Game changes from deleted replies are rolled back.', confirmLabel: 'Delete', danger: true }))) return;
        try {
          const r = await del<{ ids: string[] }>(`/api/messages/${m.id}${andAfter ? '?after=1' : ''}`);
          qc.setQueryData<MessageDTO[]>(qk.messages(id), (l) => l?.filter((x) => !r.ids.includes(x.id)));
          scriptBus.emit('delete', { chatId: id, messageId: m.id, ids: r.ids });
        } catch (e) {
          toastError(e);
        }
      },
      onBranch: async (m) => {
        try {
          const c = await post(`/api/chats/${id}/branch`, { messageId: m.id });
          await qc.invalidateQueries({ queryKey: ['chats'] });
          navigate(`/chat/${c.id}`);
          toast({ title: 'New branch created', action: { label: 'Go back', run: () => navigate(`/chat/${id}`) } });
        } catch (e) {
          toastError(e);
        }
      },
      onBookmark: async (m) => upsertMessage(await patch(`/api/messages/${m.id}`, { bookmarked: !m.bookmarked })),
      onHide: async (m) => upsertMessage(await patch(`/api/messages/${m.id}`, { hidden: !m.hidden })),
      onRetrack: async (m) => {
        try {
          const r = await post<{ ok: boolean; summary: string[]; error?: string }>(`/api/messages/${m.id}/retrack`);
          if (!r.ok) toast({ title: 'Could not read changes', lines: [r.error ?? ''], tone: 'danger' });
          else if (!r.summary.length) toast('No game changes found');
        } catch (e) {
          toastError(e);
        }
      },
      onSpeak: (m) => settings.data && features.on.voice && void speak(m.swipes[m.swipeId]?.text ?? '', { settings: settings.data, voice: m.role === 'assistant' ? character.data?.game.voice?.voice : undefined, reference: m.role === 'assistant' ? refOf(character.data?.game.voice) : undefined }).catch(toastError),
      onRegenerate: () => void run('regenerate'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, list, lastAssistant?.id, settings.data, character.data, speaker, features.on.voice],
  );

  // Commands and scripts act on this chat through the same reply flow as the composer.
  useEffect(() => {
    setChatActions({ chatId: id, generate: (type, text) => run(type, text), setComposer, stop: () => void stop(id) }, id);
    return () => setChatActions(null, id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, speaker, target, scripts.runnable.length, scripts.extensions.length]);
  const scriptView: ScriptView = useMemo(
    () => ({
      settings: scripts.settings,
      active: scripts.active,
      safe: scripts.safe,
      chatId: id,
      characterId: chat.data?.characterId ?? null,
      review: setReview,
      renderers: scripts.extensions.flatMap((e) => e.messageRenderers.map((r) => ({ ext: e.id, key: e.key, tag: r.tag, file: r.file, permissions: e.permissions, updatedAt: e.updatedAt }))),
    }),
    [scripts.settings, scripts.active, scripts.safe, scripts.extensions, id, chat.data?.characterId],
  );
  const sendText = useCallback(async (text: string) => void (await run('normal', text)), [id, speaker, target]); // eslint-disable-line react-hooks/exhaustive-deps
  const swipeNew = useCallback(async () => void (await run('swipe')), [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (chat.isLoading || messages.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!chat.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="font-medium">Chat not found</p>
        <Button onClick={() => navigate('/')}>Back to chats</Button>
      </div>
    );
  }
  const c = chat.data;
  const title = group?.name ?? character.data?.name ?? c.title;
  const setMode = async (m: 'chat' | 'stage') => {
    qc.setQueryData(qk.chat(id), { ...c, metadata: { ...c.metadata, mode: m } });
    await patch(`/api/chats/${id}`, { metadata: { mode: m } }).catch(toastError);
  };

  const composerEl = (
    <Composer
      busy={busy}
      value={composer}
      onChange={setComposer}
      enterToSend={!!settings.data?.chat.enterToSend}
      stt={!!settings.data?.chat.stt}
      placeholder={`Message ${group ? 'the group' : title}`}
      onSend={(text) => {
        setComposer('');
        // "/command …" runs a command; "//text" sends text starting with a slash.
        if (isCommand(text)) return void runSlashLine(text.trim(), { perms: 'owner', chatId: id, from: 'You' });
        const t = text.trim().startsWith('//') ? text.trim().slice(1) : text.trim();
        // Scripts that are still starting (the chat just opened) get to hear this message's events.
        void whenStarted(3000).then(() => run('normal', t || undefined));
      }}
      onStop={() => void stop(id)}
      onMenu={() => setMenuOpen(true)}
      onSwipeKey={(dir) => {
        const last = list[list.length - 1];
        if (last && last.role === 'assistant' && !busy) void actions.onSwipe(last, dir);
      }}
      accessory={
        <>
          {composer.trim().startsWith('/') ? <SlashSuggest value={composer} onPick={setComposer} /> : null}
          {scripts.active?.pending.length && !pendingSeen ? (
            <div className="mb-2 flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm" role="status">
              <span className="min-w-0 flex-1 truncate">{scripts.active.pending.map((p) => p.name).join(', ')} {scripts.active.pending.length === 1 ? 'has' : 'have'} scripts that are off.</span>
              <Button size="sm" icon={ShieldQuestion} onClick={() => setReview(scripts.active!.pending[0]!.target)}>
                Review
              </Button>
              <IconButton size="sm" icon={X} label="Hide this notice" onClick={() => setPendingSeen(true)} />
            </div>
          ) : null}
          <QuickBar chatId={id} active={scripts.active} runnable={scripts.runnable} extensions={scripts.extensions} onSend={(t) => void run('normal', t)} setComposer={setComposer} busy={busy} />
          {group ? (
          <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
            <button onClick={() => setSpeaker(null)} className={cx('pressable h-8 flex-none rounded-full px-3 text-xs font-medium', !speaker ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-fg-2')}>
              {group.strategy === 'manual' ? 'Pick next speaker' : 'Auto'}
            </button>
            {group.members.map((mem) => {
              const ch = (qc.getQueryData<any[]>(qk.characters) ?? []).find((x) => x.id === mem.characterId);
              return (
                <button key={mem.characterId} onClick={() => setSpeaker(mem.characterId)} className={cx('pressable flex h-8 flex-none items-center gap-1.5 rounded-full pl-1 pr-3 text-xs font-medium', speaker === mem.characterId ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-fg-2', mem.muted && 'opacity-50')}>
                  <Avatar src={ch?.avatar} name={ch?.name ?? '?'} size="xs" />
                  {ch?.name ?? 'Member'}
                </button>
              );
            })}
          </div>
        ) : gameOn ? (
          <Suspense fallback={null}>
            <CastStrip />
            <ComposerChips campaign={campaign.data ?? null} target={target} setTarget={setTarget} setComposer={setComposer} composer={composer} chatId={id} busy={busy} />
          </Suspense>
        ) : null}
        </>
      }
    />
  );

  const quick: Command[] = [
    { id: 'continue', label: 'Continue the reply', icon: FastForward, group: 'Quick', keywords: 'more', run: () => void run('continue') },
    {
      id: 'impersonate',
      label: 'Write my next line',
      icon: UserRoundPen,
      group: 'Quick',
      keywords: 'impersonate',
      run: async () => {
        const t2 = await run('impersonate');
        if (t2) setComposer(String(t2));
      },
    },
    ...(gameOn ? [{ id: 'newgame', label: 'New game setup', icon: Sparkles, group: 'Quick' as const, keywords: 'wizard start campaign', run: () => document.dispatchEvent(new CustomEvent('everloom:tool', { detail: 'newgame' })) }] : []),
    ...(gameOn ? [{ id: 'log', label: 'Meanwhile… (world log)', icon: History, group: 'Quick' as const, keywords: 'events news digest', run: () => document.dispatchEvent(new CustomEvent('everloom:tool', { detail: 'log' })) }] : []),
    { id: 'note', label: "Author's note", icon: NotebookPen, group: 'Quick', run: () => setSheet('note') },
    ...(features.memory !== 'off' ? [{ id: 'memory', label: 'Memory', icon: Brain, group: 'Quick' as const, keywords: 'summary', run: () => setSheet('memory') }] : []),
    { id: 'inspector', label: 'Prompt inspector', icon: ScrollText, group: 'Quick', keywords: 'tokens debug', run: () => setSheet('inspector') },
    { id: 'world', label: 'World inspector', icon: Telescope, group: 'Quick', keywords: 'scene block calls cost health changes undo', run: () => setSheet('world') },
    { id: 'saves', label: 'Saves', icon: Save, group: 'Quick', keywords: 'save load slot checkpoint', run: () => setSheet('saves') },
    { id: 'cinematic', label: 'Cinematic mode', icon: Clapperboard, group: 'Quick', keywords: 'focus fullscreen immersive hide', run: () => setCinematic(true) },
    { id: 'scripts', label: 'Scripts', icon: Code2, group: 'Quick', keywords: 'extensions console permissions', run: () => setSheet('scripts') },
    // Extension panels and screens as tiles.
    ...scripts.extensions.flatMap((e) => [
      ...e.panels.filter((p) => p.tile).map((p) => ({ id: `ext:${e.id}:${p.id}`, label: p.title, icon: PanelRight, group: 'Quick' as const, keywords: `${e.name} extension`, run: () => openExtensionPanel(e, p, id, c.characterId) })),
      ...e.screens.map((sc) => ({ id: `ext:${e.id}:screen:${sc.id}`, label: sc.title, icon: PanelRight, group: 'Quick' as const, keywords: `${e.name} extension`, run: () => navigate(`/x/${encodeURIComponent(e.id)}/${encodeURIComponent(sc.id)}?chat=${id}`) })),
    ]),
  ];

  const renderMessage = (m: MessageDTO) => {
    const live = streams[m.id];
    const mine = gen.messageId === m.id;
    const streaming = mine || !!live;
    return (
      <Message
        key={m.id}
        index={list.indexOf(m)}
        depth={list.length - 1 - list.indexOf(m)}
        m={mine ? { ...m, swipeId: gen.swipeId } : live ? { ...m, swipeId: live.swipeId } : m}
        avatar={avatarFor(m)}
        isLast={m.id === list[list.length - 1]?.id}
        streamText={mine ? (gen.type === 'continue' ? (m.swipes[m.swipeId]?.text ?? '') + gen.text : gen.text) : live ? live.text : null}
        streamReasoning={mine ? gen.reasoning : live ? live.reasoning : null}
        streaming={streaming}
        showReasoning={settings.data?.chat.showReasoning !== false}
        highlight={highlight === m.id}
        busy={busy}
        actions={actions}
      />
    );
  };

  return (
    <div className="ev-story relative flex h-full flex-col bg-bg" data-genre={settings.data?.genreTheme !== false ? (campaign.data?.state?.meta.style ?? undefined) : undefined} data-cinematic={cinematic ? '' : undefined}>
      {cinematic ? (
        <Button size="sm" variant="secondary" icon={Minimize2} className="absolute right-3 top-[calc(var(--safe-top)+12px)] z-30 opacity-70 hover:opacity-100 focus-visible:opacity-100" onClick={() => setCinematic(false)}>
          Exit
        </Button>
      ) : null}
      <header className="ev-chrome z-20 flex flex-none items-center gap-1 px-2 pt-[var(--safe-top)] hairline-b">
        <IconButton icon={ArrowLeft} label="Back" onClick={() => navigate(c.characterId ? '/' : '/')} />
        <button className="pressable flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-2 pl-1 pr-2 text-left" onClick={() => setSheet('info')}>
          <Avatar src={group?.avatar ?? character.data?.avatar} name={title} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-5">{title}</span>
            <span className="block truncate text-xs text-fg-2">{busy ? 'writing…' : c.title}</span>
          </span>
        </button>
        <IconButton icon={Search} label="Find in chat" onClick={() => setSheet('search')} />
        {features.on.stage ? <IconButton icon={BookText} label={mode === 'stage' ? 'Switch to chat mode' : 'Switch to stage mode'} active={mode === 'stage'} onClick={() => setMode(mode === 'stage' ? 'chat' : 'stage')} /> : null}
        <Menu
          trigger={<IconButton icon={MoreHorizontal} label="Chat menu" />}
          items={[
            { label: 'Prompt inspector', icon: ScrollText, onSelect: () => setSheet('inspector') },
            { label: "Author's note", icon: NotebookPen, onSelect: () => setSheet('note') },
            { label: 'Memory', icon: Brain, onSelect: () => setSheet('memory') },
            { label: 'World inspector', icon: Telescope, onSelect: () => setSheet('world') },
            { label: 'Saves', icon: Save, onSelect: () => setSheet('saves'), separatorBefore: true },
            { label: 'View', icon: Eye, onSelect: () => setSheet('view') },
            { label: 'Cinematic mode', icon: Clapperboard, onSelect: () => setCinematic(true) },
            { label: 'Scripts', icon: Code2, onSelect: () => setSheet('scripts') },
            { label: 'Chat details', icon: MoreHorizontal, onSelect: () => setSheet('info'), separatorBefore: true },
          ]}
        />
      </header>

      <ScriptViewContext.Provider value={scriptView}>
      <FeaturesContext.Provider value={features}>
      <GameLayer chat={c} campaign={campaign.data ?? null} busy={busy} onRun={run} setComposer={setComposer} menuOpen={menuOpen} setMenuOpen={setMenuOpen} quick={quick}>
        {mode === 'stage' ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Spinner /></div>}>
            <Stage chat={c} messages={list} campaign={campaign.data ?? null} busy={busy} actions={actions} streamText={gen.chatId === id ? gen.text : null} streamingId={gen.messageId} composer={composerEl} />
          </Suspense>
        ) : (
          <>
            <div ref={scroller} onScroll={onScroll} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="mx-auto w-full max-w-[760px] px-4 pb-4 pt-2 sm:px-6">
                {list.length > limit ? (
                  <div className="flex justify-center py-3">
                    <Button size="sm" variant="quiet" onClick={() => setLimit((l) => l + PAGE)}>
                      Show earlier messages
                    </Button>
                  </div>
                ) : null}
                {visible.map(renderMessage)}
                {gen.chatId === id && !gen.messageId && gen.type !== 'impersonate' ? (
                  <div className="flex gap-3 py-3">
                    <Avatar src={character.data?.avatar} name={title} size="md" />
                    <div className="pt-3">
                      <span className="typing" role="status" aria-label="Writing">
                        <span />
                        <span />
                        <span />
                      </span>
                    </div>
                  </div>
                ) : null}
                {!list.length ? (
                  <div className="flex flex-col items-center gap-3 py-16 text-center">
                    <p className="text-sm text-fg-2">Say something to begin.</p>
                    {gameOn && !busy ? (
                      <Button variant="secondary" icon={Sparkles} onClick={() => document.dispatchEvent(new CustomEvent('everloom:tool', { detail: 'newgame' }))}>
                        Set up a new game
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <AnimatePresence>
              {!stuck ? (
                <motion.div className="pointer-events-none relative z-10 flex justify-center" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={t.fast}>
                  <IconButton
                    icon={ArrowDown}
                    label="Jump to latest"
                    className="pointer-events-auto absolute -top-14 !bg-surface shadow-2"
                    onClick={() => {
                      setStuck(true);
                      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
                    }}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
            <div className="flex-none bg-bg">{composerEl}</div>
          </>
        )}
      </GameLayer>
      </FeaturesContext.Provider>
      </ScriptViewContext.Provider>
      {scripts.on && scripts.settings && (scripts.runnable.length || scripts.extensions.some((e) => e.background)) ? (
        <Suspense fallback={null}>
          <ScriptLayer chatId={id} characterId={c.characterId} settings={scripts.settings} runnable={scripts.runnable} extensions={scripts.extensions} send={sendText} swipeNew={swipeNew} />
        </Suspense>
      ) : null}
      <ScriptsSheet open={sheet === 'scripts'} onOpenChange={(o) => setSheet(o ? 'scripts' : null)} active={scripts.active} extensions={scripts.extensions} safe={scripts.safe} on={scripts.on} onReview={setReview} />
      <ReviewSheet target={review} open={!!review} onOpenChange={(o) => !o && setReview(null)} />

      <InspectorSheet chatId={id} open={sheet === 'inspector'} onOpenChange={(o) => setSheet(o ? 'inspector' : null)} />
      <SearchSheet chatId={id} messages={list} open={sheet === 'search'} onOpenChange={(o) => setSheet(o ? 'search' : null)} onJump={jumpTo} />
      <NoteSheet chat={c} open={sheet === 'note'} onOpenChange={(o) => setSheet(o ? 'note' : null)} />
      <MemorySheet chat={c} open={sheet === 'memory'} onOpenChange={(o) => setSheet(o ? 'memory' : null)} />
      <WorldInspector chat={c} open={sheet === 'world'} onOpenChange={(o) => setSheet(o ? 'world' : null)} />
      <ChatInfoSheet chat={c} open={sheet === 'info'} onOpenChange={(o) => setSheet(o ? 'info' : null)} />
      <SavesSheet chat={c} open={sheet === 'saves'} onOpenChange={(o) => setSheet(o ? 'saves' : null)} />
      <ViewSheet open={sheet === 'view'} onOpenChange={(o) => setSheet(o ? 'view' : null)} onCinematic={() => setCinematic(true)} />
    </div>
  );
}

function refOf(v?: { kind?: string; reference?: string }) {
  return v?.kind === 'custom' ? v.reference : undefined;
}
