import { Field, Input, Segmented, ToggleRow } from '@/ui';
import { Section, useSettingsPatch } from '../common';

export const HUD_OPTIONS = [
  ['time', 'Time'],
  ['date', 'Date'],
  ['weather', 'Weather'],
  ['location', 'Location'],
  ['currency', 'Money'],
  ['hp', 'HP'],
  ['mp', 'MP'],
  ['ap', 'AP'],
  ['xp', 'XP'],
  ['hunger', 'Hunger'],
  ['energy', 'Energy'],
  ['hygiene', 'Hygiene'],
  ['status', 'Status'],
] as const;

export default function GameSection() {
  const { settings, update } = useSettingsPatch();
  if (!settings) return null;
  const pinned = settings.hud.pinned;
  const toggle = (id: string) => update({ hud: { pinned: pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id] } });
  return (
    <>
      <Section title="State tracking" description="After each reply the game reads what happened and updates items, time, places, people and stats.">
        <Field label="Tracker mode" htmlFor="tm" hint={settings.tracker.mode === 'separate' ? 'A second, cheap call to the utility model after each reply. Most reliable.' : settings.tracker.mode === 'inline' ? 'The main model appends changes in a hidden tag. One call, but depends on the model following instructions.' : 'No automatic tracking. You can still change state by hand.'}>
          <Segmented
            label="Tracker mode"
            value={settings.tracker.mode}
            onChange={(v) => update({ tracker: { mode: v } })}
            options={[
              { value: 'separate', label: 'Separate pass' },
              { value: 'inline', label: 'Inline tags' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Field>
        <div className="mt-2 flex flex-col divide-y divide-line">
          <ToggleRow label="Send game state to the model" description="Adds a compact summary of time, place, vitals and nearby people." checked={settings.tracker.injectState} onChange={(v) => update({ tracker: { injectState: v } })} />
        </div>
        <Field label="Game state budget (tokens)" htmlFor="ib" className="mt-3">
          <Input id="ib" type="number" min={100} max={4000} step={50} value={settings.tracker.injectBudget} onChange={(e) => update({ tracker: { injectBudget: Number(e.target.value) } })} className="max-w-[160px]" />
        </Field>
      </Section>
      <Section title="HUD" description="The thin bar at the top of a chat. Tap it to see everything.">
        <div className="flex flex-wrap gap-2">
          {HUD_OPTIONS.map(([id, label]) => (
            <button key={id} onClick={() => toggle(id)} aria-pressed={pinned.includes(id)} className={`pressable h-9 rounded-full px-3.5 text-sm ${pinned.includes(id) ? 'bg-accent-soft font-medium text-accent-text' : 'bg-surface-2 text-fg-2'}`}>
              {label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Memory" description="Long chats are summarized automatically by the utility model so older events stay in context.">
        <div className="flex flex-col divide-y divide-line">
          <ToggleRow label="Automatic summaries" checked={settings.memory.auto} onChange={(v) => update({ memory: { auto: v } })} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Every N messages" htmlFor="me">
            <Input id="me" type="number" min={6} max={200} value={settings.memory.every} onChange={(e) => update({ memory: { every: Number(e.target.value) } })} />
          </Field>
          <Field label="Summary length (words)" htmlFor="mw">
            <Input id="mw" type="number" min={50} max={1500} value={settings.memory.maxWords} onChange={(e) => update({ memory: { maxWords: Number(e.target.value) } })} />
          </Field>
        </div>
      </Section>
      <Section title="Helper and atmosphere">
        <div className="flex flex-col divide-y divide-line">
          <ToggleRow label="Show the helper companion" checked={settings.helper.visible} onChange={(v) => update({ helper: { visible: v } })} />
          <ToggleRow label="Weather and time-of-day overlay" description="A subtle tint and particles in Stage mode." checked={settings.atmosphere.enabled} onChange={(v) => update({ atmosphere: { enabled: v } })} />
          <ToggleRow label="Particles" checked={settings.atmosphere.particles} onChange={(v) => update({ atmosphere: { particles: v } })} disabled={!settings.atmosphere.enabled} />
        </div>
        <Field label="Helper name" htmlFor="hn" className="mt-3">
          <Input id="hn" value={settings.helper.name} onChange={(e) => update({ helper: { name: e.target.value } })} className="max-w-[240px]" />
        </Field>
      </Section>
    </>
  );
}
