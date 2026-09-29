import { useEffect, useState } from 'react';
import { Button, Field, Input, Segmented, Select, Slider } from '@/ui';
import { speak } from '@/features/story/tts';
import { Section, useSettingsPatch } from '../common';

export default function VoiceSection() {
  const { settings, update } = useSettingsPatch();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
    return () => speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);
  if (!settings) return null;
  const tts = settings.tts;
  return (
    <Section title="Voice" description="Characters use the voice set on their card; the narrator voice reads everything else.">
      <div className="flex flex-col gap-5">
        <Field label="Speech engine" hint={tts.provider === 'browser' ? 'Free, works offline, quality depends on your device.' : 'Uses the Voice connection from Connections → Roles.'}>
          <Segmented
            label="Speech engine"
            value={tts.provider}
            onChange={(v) => update({ tts: { provider: v } })}
            options={[
              { value: 'browser', label: 'Browser' },
              { value: 'connection', label: 'Connection' },
            ]}
          />
        </Field>
        <Field label="Narrator voice" htmlFor="nv">
          {tts.provider === 'browser' && voices.length ? (
            <Select id="nv" value={tts.narratorVoice} onChange={(e) => update({ tts: { narratorVoice: e.target.value } })}>
              <option value="">Device default</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </Select>
          ) : (
            <Input id="nv" value={tts.narratorVoice} onChange={(e) => update({ tts: { narratorVoice: e.target.value } })} placeholder="Voice id" />
          )}
        </Field>
        <Field label={`Speed ${tts.rate.toFixed(2)}×`}>
          <Slider label="Speed" min={0.5} max={2} step={0.05} value={tts.rate} onChange={(v) => update({ tts: { rate: v } })} />
        </Field>
        <Field label={`Pitch ${tts.pitch.toFixed(2)}`} hint="Browser voices only.">
          <Slider label="Pitch" min={0.5} max={1.5} step={0.05} value={tts.pitch} onChange={(v) => update({ tts: { pitch: v } })} />
        </Field>
        <div>
          <Button variant="secondary" onClick={() => speak('The lanterns flicker as the rain begins again.', { settings, voice: tts.narratorVoice })}>
            Listen
          </Button>
        </div>
      </div>
    </Section>
  );
}
