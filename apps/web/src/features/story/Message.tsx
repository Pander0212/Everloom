import { applyRegexScripts, frameInput, isInputMode, RegexPlacement, type MessageDTO } from '@everloom/engine';
import { Compass, PenLine, Bookmark, BookmarkCheck, Brain, ChevronDown, ChevronLeft, ChevronRight, Copy, EyeOff, GitBranch, MoreHorizontal, Pencil, RefreshCw, ScanSearch, Trash2, Volume2 } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '@/lib/format';
import { renderStory } from '@/lib/render';
import { t } from '@/lib/motion';
import { Avatar, Button, Icon, IconButton, Menu, Textarea, Typing, type MenuItem } from '@/ui';
import { useFeatureOn } from '@/lib/features';
import { splitInteractive } from '@/scripting/bus';
import { useScriptView } from '@/scripting/context';

// Interactive HTML (sandboxed frames) only loads for messages that have some.
const InteractiveMessage = lazy(() => import('@/scripting/InteractiveMessage'));
const NO_RULES: never[] = [];

export interface MessageActions {
  onSwipe: (m: MessageDTO, dir: -1 | 1) => void;
  onEdit: (m: MessageDTO, text: string) => void;
  onDelete: (m: MessageDTO, andAfter?: boolean) => void;
  onBranch: (m: MessageDTO) => void;
  onBookmark: (m: MessageDTO) => void;
  onHide: (m: MessageDTO) => void;
  onRetrack: (m: MessageDTO) => void;
  onSpeak: (m: MessageDTO) => void;
  onRegenerate: () => void;
}

interface Props {
  m: MessageDTO;
  /** Position in the chat (for message scripts and depth-limited display rules). */
  index?: number;
  /** Messages after this one (depth 0 = the newest). */
  depth?: number;
  avatar?: string | null;
  isLast: boolean;
  /** Live text while this message streams. */
  streamText?: string | null;
  streamReasoning?: string | null;
  streaming?: boolean;
  showReasoning: boolean;
  highlight?: boolean;
  busy: boolean;
  actions: MessageActions;
}

function Reasoning({ text, live }: { text: string; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="mb-2">
      <button onClick={() => setOpen((o) => !o)} className="pressable flex items-center gap-1.5 rounded-sm py-1 text-xs font-medium text-fg-2 hover:text-fg" aria-expanded={open}>
        <Icon icon={Brain} size={14} />
        {live ? 'Thinking…' : 'Reasoning'}
        <Icon icon={ChevronDown} size={14} className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      {open ? <div className="mt-1 whitespace-pre-wrap border-l-2 border-line pl-3 text-sm leading-6 text-fg-2">{text}</div> : null}
    </div>
  );
}

export const Message = memo(function Message({ m, index = 0, depth, avatar, isLast, streamText, streamReasoning, streaming, showReasoning, highlight, busy, actions }: Props) {
  const swipe = m.swipes[m.swipeId] ?? m.swipes[0];
  const text = streamText ?? swipe?.text ?? '';
  const reasoning = streamReasoning ?? swipe?.reasoning ?? '';
  const [editing, setEditing] = useState(false);
  // Editing happens in place: the editor opens at the height the text had, so nothing jumps.
  const textRef = useRef<HTMLDivElement>(null);
  const [editHeight, setEditHeight] = useState(0);
  const startEdit = () => {
    setEditHeight(Math.min(textRef.current?.offsetHeight ?? 0, window.innerHeight * 0.6) + 20);
    setEditing(true);
  };
  // A message that just arrived comes in with the theme's motion; older ones simply appear.
  const [arrived] = useState(() => Date.now() - m.createdAt < 6000);
  const [draft, setDraft] = useState(text);
  // Display-only regex rules change what is shown (never what is stored); interactive blocks render in frames.
  const view = useScriptView();
  const scriptsOn = !!view?.settings?.enabled && !view.safe;
  const rules = (scriptsOn ? view?.active?.regex : undefined) ?? NO_RULES;
  const shown = useMemo(
    () => (rules.length && !streaming && m.role !== 'system' ? applyRegexScripts(text, rules, { placement: m.role === 'user' ? RegexPlacement.userInput : RegexPlacement.aiOutput, target: 'display', depth }) : text),
    [text, rules, streaming, m.role, depth],
  );
  const interactive = !!view?.settings?.renderHtml && !view.safe && !streaming && splitInteractive(shown, view.settings.htmlTag, scriptsOn ? view.renderers.map((r) => r.tag) : []).some((p) => p.type !== 'text');
  // Input modes show as what they are: an action in italics, speech in quotes.
  const inputMode = m.role === 'user' && isInputMode(m.extra?.inputMode) ? m.extra.inputMode : null;
  const display = inputMode === 'act' || inputMode === 'say' ? frameInput(inputMode, shown) : shown;
  const html = useMemo(() => (interactive ? '' : renderStory(display)), [display, interactive]);
  const isUser = m.role === 'user';
  const isNarrator = m.role === 'system';
  const canSwipe = m.role === 'assistant' && (isLast || m.swipes.length > 1);
  const x = useMotionValue(0);
  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);

  const voiceOn = useFeatureOn('voice');
  const gameOn = useFeatureOn('game');
  // Actions show on the newest message, and on others when hovered, focused or tapped.
  const [open, setOpen] = useState(false);
  const reveal = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button, input, textarea, select, iframe, [role=button], [role=menuitem]')) return;
    if (window.getSelection()?.toString()) return;
    setOpen((o) => !o);
  };
  const more: MenuItem[] = [
    ...(m.role === 'assistant' && isLast ? [{ group: 'This version', label: 'Rewrite this version', description: 'Replaces this version with a new one', icon: RefreshCw, onSelect: actions.onRegenerate, disabled: busy }] : []),
    { group: 'Story', label: 'Branch from here', description: 'A new chat that goes on from this message', icon: GitBranch, onSelect: () => actions.onBranch(m) },
    ...(m.role === 'assistant' && gameOn ? [{ group: 'Story', label: 'Re-read story changes', description: 'Look for items, places and feelings again', icon: ScanSearch, onSelect: () => actions.onRetrack(m), disabled: busy }] : []),
    { group: 'Story', label: m.hidden ? 'Show to the AI' : 'Hide from the AI', description: m.hidden ? 'The AI reads this message again' : 'Stays here, but the AI won\u2019t read it', icon: EyeOff, onSelect: () => actions.onHide(m) },
    { group: 'Keep', label: m.bookmarked ? 'Remove bookmark' : 'Bookmark', description: 'Find it later under Find in chat', icon: m.bookmarked ? BookmarkCheck : Bookmark, onSelect: () => actions.onBookmark(m) },
    ...(voiceOn ? [{ group: 'Keep', label: 'Read aloud', icon: Volume2, onSelect: () => actions.onSpeak(m) }] : []),
    { group: 'Delete', label: 'Delete this and everything after', icon: Trash2, danger: true, onSelect: () => actions.onDelete(m, true), disabled: busy },
  ];
  const actionRow = (
    <div className={cx('ev-msg-actions flex items-center gap-0.5 text-fg-2 transition-opacity', isLast || open ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100')}>
      <IconButton size="sm" icon={Pencil} label="Edit" disabled={busy} onClick={startEdit} />
      <Menu trigger={<IconButton size="sm" icon={MoreHorizontal} label="More actions" />} items={more} align={isUser ? 'end' : 'start'} />
      {/* On the newest message only Edit and More stay out; Copy and Delete join them on tap or hover. */}
      <span className={cx('flex items-center gap-0.5 transition-opacity', isLast && !open && 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100')}>
        <IconButton size="sm" icon={Copy} label="Copy text" onClick={() => void navigator.clipboard?.writeText(text)} />
        <IconButton size="sm" icon={Trash2} label="Delete" disabled={busy} onClick={() => actions.onDelete(m)} />
      </span>
    </div>
  );

  const body = editing ? (
    <div className="flex flex-col gap-2">
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxRows={40} autoFocus aria-label="Edit message" className={cx('story', isUser && '!text-[16px]')} style={editHeight ? { minHeight: editHeight } : undefined} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(text); }}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={() => { setEditing(false); if (draft !== text) actions.onEdit(m, draft); }}>
          Save
        </Button>
      </div>
    </div>
  ) : streaming && !text ? (
    <Typing className="mt-1" />
  ) : interactive ? (
    <Suspense fallback={<div className="ev-message-text story" dangerouslySetInnerHTML={{ __html: renderStory(shown) }} />}>
      <InteractiveMessage m={m} text={shown} index={index} streaming={streaming} />
    </Suspense>
  ) : (
    <div ref={textRef} className={cx('ev-message-text story', streaming && 'is-streaming')} dangerouslySetInnerHTML={{ __html: html }} />
  );

  if (isUser && (inputMode === 'story' || inputMode === 'direct')) {
    // The player's own narration reads like the story; a direction is a quiet note outside it.
    return (
      <div id={`msg-${m.id}`} data-mode={inputMode} className={cx('ev-message ev-message-user group py-2', arrived && 'ev-arrive', m.hidden && 'opacity-50', highlight && 'rounded-md bg-accent-soft')} onClick={editing ? undefined : reveal}>
        {inputMode === 'story' ? (
          <div className="border-l-2 border-accent pl-3">
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-3">
              <Icon icon={PenLine} size={13} /> Your narration
            </span>
            {body}
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm text-fg-2 [&_.story]:text-sm [&_.story]:font-sans">
            <Icon icon={Compass} size={15} className="mt-0.5 flex-none text-fg-3" />
            <span className="min-w-0 flex-1">
              <span className="font-medium text-fg">Direction: </span>
              {body}
            </span>
          </div>
        )}
        {!editing ? <div className="mt-0.5">{actionRow}</div> : null}
      </div>
    );
  }

  if (isUser) {
    return (
      <div id={`msg-${m.id}`} className={cx('ev-message ev-message-user group', arrived && 'ev-arrive', ' flex flex-col items-end py-2', m.hidden && 'opacity-50', highlight && 'rounded-md bg-accent-soft')} onClick={editing ? undefined : reveal}>
        <div className="flex max-w-[88%] items-start gap-1 sm:max-w-[75%]">
          {m.hidden ? <Icon icon={EyeOff} size={14} className="mt-3 text-fg-3" aria-label="Hidden from the AI" /> : null}
          <div className="ev-bubble min-w-0 rounded-lg rounded-tr-sm bg-surface-2 px-4 py-2.5 [&_.story]:text-[16px]">{body}</div>
        </div>
        {!editing ? <div className="mt-0.5">{actionRow}</div> : null}
      </div>
    );
  }

  const many = m.swipes.length > 1;
  const swipeBar =
    canSwipe && !editing ? (
      <div className="flex items-center gap-0.5 text-fg-2">
        {many ? <IconButton size="sm" icon={ChevronLeft} label="Previous version" disabled={busy || m.swipeId === 0} onClick={() => actions.onSwipe(m, -1)} /> : null}
        {many ? (
          <span className="min-w-[32px] text-center text-xs tabular-nums" aria-label={`Version ${m.swipeId + 1} of ${m.swipes.length}`}>
            {m.swipeId + 1}/{m.swipes.length}
          </span>
        ) : null}
        <IconButton size="sm" icon={ChevronRight} label={m.swipeId === m.swipes.length - 1 ? 'New version' : 'Next version'} disabled={busy || (!isLast && m.swipeId === m.swipes.length - 1)} onClick={() => actions.onSwipe(m, 1)} />
        <span className="mx-1 h-4 w-px bg-line" aria-hidden="true" />
      </div>
    ) : null;

  const content = (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-center gap-2">
        <span className="truncate text-sm font-semibold text-fg">{m.name}</span>
        {m.bookmarked ? <Icon icon={BookmarkCheck} size={14} className="text-accent-text" /> : null}
        {m.hidden ? <Icon icon={EyeOff} size={14} className="text-fg-3" aria-label="Hidden from the AI" /> : null}
      </div>
      {showReasoning ? <Reasoning text={reasoning} live={streaming && !text} /> : null}
      {body}
      {swipe?.changes?.length && !streaming ? <p className="mt-2 text-xs text-fg-3">{swipe.changes.join(' · ')}</p> : null}
      {Array.isArray(m.extra?.shieldHint) && (m.extra.shieldHint as string[]).length && !streaming ? (
        <p className="mt-2 text-xs text-fg-3">Name shield: possible stand-in left in the text ({(m.extra.shieldHint as string[]).join(', ')}). Edit the message if it should be the real name.</p>
      ) : null}
      {!editing && !(streaming && !text) ? (
        <div className="mt-1.5 flex flex-wrap items-center">
          {swipeBar}
          {actionRow}
        </div>
      ) : null}
    </div>
  );

  return (
    <motion.div
      id={`msg-${m.id}`}
      className={cx('ev-message', arrived && 'ev-arrive', isNarrator ? 'ev-message-system' : 'ev-message-assistant', 'group relative flex gap-3 py-3', m.hidden && 'opacity-50', highlight && '-mx-2 rounded-md bg-accent-soft px-2', isNarrator && 'pl-0')}
      style={canSwipe && !editing ? { x } : undefined}
      drag={canSwipe && !editing && !busy ? 'x' : false}
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.18}
      dragSnapToOrigin
      onClick={editing ? undefined : reveal}
      onDragEnd={(_e, info) => {
        if (info.offset.x < -70 && Math.abs(info.velocity.y) < 600) actions.onSwipe(m, 1);
        else if (info.offset.x > 70 && m.swipeId > 0) actions.onSwipe(m, -1);
        void animate(x, 0, t.base);
      }}
    >
      {!isNarrator ? <Avatar src={avatar} name={m.name} size="md" className="ev-msg-avatar mt-0.5" /> : null}
      {content}
    </motion.div>
  );
});
