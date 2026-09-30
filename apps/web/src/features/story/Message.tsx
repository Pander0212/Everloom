import type { MessageDTO } from '@everloom/engine';
import { Bookmark, BookmarkCheck, Brain, ChevronDown, ChevronLeft, ChevronRight, Copy, EyeOff, GitBranch, MoreHorizontal, Pencil, RefreshCw, ScanSearch, Trash2, Volume2 } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
import { memo, useEffect, useMemo, useState } from 'react';
import { cx } from '@/lib/format';
import { renderStory } from '@/lib/render';
import { t } from '@/lib/motion';
import { Avatar, Button, Icon, IconButton, Menu, Textarea, Typing } from '@/ui';

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

export const Message = memo(function Message({ m, avatar, isLast, streamText, streamReasoning, streaming, showReasoning, highlight, busy, actions }: Props) {
  const swipe = m.swipes[m.swipeId] ?? m.swipes[0];
  const text = streamText ?? swipe?.text ?? '';
  const reasoning = streamReasoning ?? swipe?.reasoning ?? '';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const html = useMemo(() => renderStory(text), [text]);
  const isUser = m.role === 'user';
  const isNarrator = m.role === 'system';
  const canSwipe = m.role === 'assistant' && (isLast || m.swipes.length > 1);
  const x = useMotionValue(0);
  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);

  const menu = (
    <Menu
      trigger={<IconButton size="sm" icon={MoreHorizontal} label="Message actions" className="opacity-70 hover:opacity-100" />}
      items={[
        { label: 'Edit', icon: Pencil, onSelect: () => setEditing(true), disabled: busy },
        { label: 'Copy text', icon: Copy, onSelect: () => void navigator.clipboard?.writeText(text) },
        { label: 'Read aloud', icon: Volume2, onSelect: () => actions.onSpeak(m) },
        { label: m.bookmarked ? 'Remove bookmark' : 'Bookmark', icon: m.bookmarked ? BookmarkCheck : Bookmark, onSelect: () => actions.onBookmark(m) },
        { label: 'Branch from here', icon: GitBranch, onSelect: () => actions.onBranch(m) },
        ...(m.role === 'assistant' ? [{ label: 'Re-read game changes', icon: ScanSearch, onSelect: () => actions.onRetrack(m), disabled: busy }] : []),
        { label: m.hidden ? 'Include in prompt' : 'Hide from prompt', icon: EyeOff, onSelect: () => actions.onHide(m) },
        { label: 'Delete', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => actions.onDelete(m), disabled: busy },
        { label: 'Delete this and after', icon: Trash2, danger: true, onSelect: () => actions.onDelete(m, true), disabled: busy },
      ]}
    />
  );

  const body = editing ? (
    <div className="flex flex-col gap-2">
      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} maxRows={20} autoFocus aria-label="Edit message" className="story !text-[16px]" />
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
  ) : (
    <div className={cx('ev-message-text story', streaming && 'is-streaming')} dangerouslySetInnerHTML={{ __html: html }} />
  );

  if (isUser) {
    return (
      <div id={`msg-${m.id}`} className={cx('ev-message ev-message-user group flex flex-col items-end py-2', m.hidden && 'opacity-50', highlight && 'rounded-md bg-accent-soft')}>
        <div className="flex max-w-[88%] items-start gap-1 sm:max-w-[75%]">
          <div className="opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">{menu}</div>
          <div className="min-w-0 rounded-lg rounded-tr-sm bg-surface-2 px-4 py-2.5 [&_.story]:text-[16px]">{body}</div>
        </div>
      </div>
    );
  }

  const swipeBar =
    canSwipe && !editing ? (
      <div className="mt-2 flex items-center gap-1 text-fg-2">
        <IconButton size="sm" icon={ChevronLeft} label="Previous swipe" disabled={busy || m.swipeId === 0} onClick={() => actions.onSwipe(m, -1)} />
        <span className="min-w-[36px] text-center text-xs tabular-nums">
          {m.swipeId + 1}/{m.swipes.length}
        </span>
        <IconButton size="sm" icon={ChevronRight} label={m.swipeId === m.swipes.length - 1 ? 'New swipe' : 'Next swipe'} disabled={busy || (!isLast && m.swipeId === m.swipes.length - 1)} onClick={() => actions.onSwipe(m, 1)} />
        {isLast ? <IconButton size="sm" icon={RefreshCw} label="Regenerate" disabled={busy} onClick={actions.onRegenerate} /> : null}
      </div>
    ) : null;

  const content = (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex items-center gap-2">
        <span className="truncate text-sm font-semibold text-fg">{m.name}</span>
        {m.bookmarked ? <Icon icon={BookmarkCheck} size={14} className="text-accent-text" /> : null}
        {m.hidden ? <Icon icon={EyeOff} size={14} className="text-fg-3" /> : null}
        <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">{menu}</span>
      </div>
      {showReasoning ? <Reasoning text={reasoning} live={streaming && !text} /> : null}
      {body}
      {swipe?.changes?.length && !streaming ? <p className="mt-2 text-xs text-fg-3">{swipe.changes.join(' · ')}</p> : null}
      {swipeBar}
    </div>
  );

  return (
    <motion.div
      id={`msg-${m.id}`}
      className={cx('ev-message', isNarrator ? 'ev-message-system' : 'ev-message-assistant', 'group relative flex gap-3 py-3', m.hidden && 'opacity-50', highlight && '-mx-2 rounded-md bg-accent-soft px-2', isNarrator && 'pl-0')}
      style={canSwipe && !editing ? { x } : undefined}
      drag={canSwipe && !editing && !busy ? 'x' : false}
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.18}
      dragSnapToOrigin
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
