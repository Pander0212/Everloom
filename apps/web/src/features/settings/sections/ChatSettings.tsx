import { cx } from '@/lib/format';
import { useFeatures } from '@/lib/features';
import { ToggleRow } from '@/ui';
import { defaultQuick, QUICK_ACTIONS } from '@/features/game/ComposerChips';
import { Section, useSettingsPatch } from '../common';

export default function ChatSection() {
  const { settings, update } = useSettingsPatch();
  const f = useFeatures(null);
  if (!settings) return null;
  const game = f.on.game;
  const quick: string[] = settings.ui?.quick ?? defaultQuick(game);
  const offered = QUICK_ACTIONS.filter((q) => !q.game || game);
  const toggle = (id: string) => update({ ui: { quick: quick.includes(id) ? quick.filter((x) => x !== id) : [...quick, id] } as never });
  return (
    <>
      <Section title="Chat" description="How the message box behaves and what shows with a reply.">
        <div className="flex flex-col divide-y divide-line">
          <ToggleRow label="Enter sends the message" description="Off: Enter adds a new line; use the send button (recommended on phones)." checked={settings.chat.enterToSend} onChange={(v) => update({ chat: { enterToSend: v } })} />
          <ToggleRow label="Show model reasoning" description="Collapsed above the reply when the model provides it." checked={settings.chat.showReasoning} onChange={(v) => update({ chat: { showReasoning: v } })} />
          {f.on.voice ? (
            <>
              <ToggleRow label="Dictation" description="A microphone button in the message box that turns your speech into text." checked={settings.chat.stt} onChange={(v) => update({ chat: { stt: v } })} />
              <ToggleRow label="Read replies aloud automatically" checked={settings.chat.autoTts} onChange={(v) => update({ chat: { autoTts: v } })} />
            </>
          ) : null}
        </div>
      </Section>
      <Section title="Quick actions" description="Buttons above the message box. Keep the few you use; everything else is in Tools.">
        <div className="flex flex-col gap-1.5" role="group" aria-label="Quick actions">
          {offered.map((q) => {
            const on = quick.includes(q.id);
            return (
              <button key={q.id} aria-pressed={on} onClick={() => toggle(q.id)} className={cx('pressable flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 text-left', on ? 'border-accent bg-accent-soft' : 'border-line hover:bg-surface-2')}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{q.label}</span>
                  <span className="block text-xs text-fg-2">{q.description}</span>
                </span>
                <span className={cx('text-xs font-medium', on ? 'text-accent-text' : 'text-fg-3')}>{on ? 'Shown' : 'Hidden'}</span>
              </button>
            );
          })}
        </div>
      </Section>
    </>
  );
}
