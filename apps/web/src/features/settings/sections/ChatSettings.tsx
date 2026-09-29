import { ToggleRow } from '@/ui';
import { Section, useSettingsPatch } from '../common';

export default function ChatSection() {
  const { settings, update } = useSettingsPatch();
  if (!settings) return null;
  return (
    <Section title="Chat">
      <div className="flex flex-col divide-y divide-line">
        <ToggleRow label="Enter sends the message" description="Off: Enter adds a new line; use the send button (recommended on phones)." checked={settings.chat.enterToSend} onChange={(v) => update({ chat: { enterToSend: v } })} />
        <ToggleRow label="Show model reasoning" description="Collapsed above the reply when the model provides it." checked={settings.chat.showReasoning} onChange={(v) => update({ chat: { showReasoning: v } })} />
        <ToggleRow label="Voice input" description="Show a microphone button that uses your browser's speech recognition." checked={settings.chat.stt} onChange={(v) => update({ chat: { stt: v } })} />
        <ToggleRow label="Read replies aloud automatically" checked={settings.chat.autoTts} onChange={(v) => update({ chat: { autoTts: v } })} />
      </div>
    </Section>
  );
}
