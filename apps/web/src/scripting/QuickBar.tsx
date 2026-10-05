/** Quick replies, script buttons and extension buttons above the composer. */
import { useEffect, useMemo } from 'react';
import { cx } from '@/lib/format';
import { scriptBus } from './bus';
import { isCommand, runSlashLine, setQuickReplies, setScriptButtons } from './commands';
import type { ActiveSet, ActiveScript, ExtensionUi } from './types';

export function QuickBar({ chatId, active, runnable, extensions, onSend, setComposer, busy }: { chatId: string; active: ActiveSet | null; runnable: ActiveScript[]; extensions: ExtensionUi[]; onSend: (text: string) => void; setComposer: (t: string) => void; busy: boolean }) {
  const replies = useMemo(() => (active?.quickReplies ?? []).flatMap((q) => q.set.items.map((it) => ({ ...it, set: q.set.name, scope: q.scope }))), [active]);
  const buttons = useMemo(
    () => [
      ...runnable.filter((s) => s.script.triggers.includes('button')).flatMap((s) => s.script.buttons.map((b) => ({ id: `${s.key}:${b.id}`, key: s.key, button: b.id, label: b.label, name: s.script.name }))),
      ...extensions.flatMap((e) => e.composerButtons.map((b) => ({ id: `${e.key}:${b.id}`, key: e.key, button: b.id, label: b.label, name: e.name }))),
    ],
    [runnable, extensions],
  );
  useEffect(() => {
    setQuickReplies(replies.map((r) => ({ label: r.label, message: r.message })));
    setScriptButtons(buttons.map((b) => ({ name: b.label, key: b.key, buttonId: b.button })));
  }, [replies, buttons]);
  if (!replies.length && !buttons.length) return null;
  const use = (msg: string, fill: boolean) => {
    if (fill) return setComposer(msg);
    if (isCommand(msg)) void runSlashLine(msg, { perms: 'owner', chatId, from: 'Quick reply' });
    else onSend(msg);
  };
  return (
    <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto" role="toolbar" aria-label="Quick replies and script buttons">
      {replies.map((r) => (
        <button key={`${r.set}:${r.id}`} disabled={busy && !r.fillOnly} onClick={() => use(r.message, r.fillOnly)} title={r.message.slice(0, 200)} className={cx('pressable h-8 flex-none rounded-full bg-surface-2 px-3 text-xs font-medium text-fg-2 hover:text-fg disabled:opacity-50')}>
          {r.label}
        </button>
      ))}
      {buttons.map((b) => (
        <button key={b.id} onClick={() => scriptBus.emit('button', { chatId, key: b.key, button: b.button })} title={b.name} className="pressable h-8 flex-none rounded-full bg-accent-soft px-3 text-xs font-medium text-accent-text">
          {b.label}
        </button>
      ))}
    </div>
  );
}
