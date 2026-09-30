import type { ReactNode } from 'react';
import { Badge, Field, Input, Segmented, ToggleRow } from '@/ui';
import { Section, useSettingsPatch } from '../common';

/** A setting label with the kind of model call it costs. */
export function CostLabel({ text, cost }: { text: ReactNode; cost: 'background' | 'utility' | 'embeddings' | 'main' }) {
  const label = { background: 'background call', utility: 'utility call', embeddings: 'embeddings', main: 'adds latency' }[cost];
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {text}
      <Badge tone={cost === 'main' ? 'warning' : 'neutral'}>{label}</Badge>
    </span>
  );
}

const PROFILE_HINT: Record<string, string> = {
  cheap: 'The tracker call after each reply, plus a chronicle read every 30 turns. Summaries fold in plain text.',
  balanced: 'Adds model-written summaries and off-screen life every few turns, and meaning-based recall when an embeddings connection is set. Nothing slows the reply down.',
  max: 'Max immersion: everything, more often, plus a quick read of your message before each reply (movement, time, dice) — adds a little latency.',
  custom: 'Your own mix of the switches below.',
};

function WorldSection() {
  const { settings, update } = useSettingsPatch();
  if (!settings) return null;
  const w = settings.world;
  return (
    <>
      <Section title="World engine" description="How much the world does between replies. Every extra model call is listed in the World inspector's call log.">
        <Segmented
          label="World engine profile"
          value={w.profile}
          onChange={(v) => v !== 'custom' && update({ world: { profile: v } })}
          options={[
            { value: 'cheap', label: 'Cheap' },
            { value: 'balanced', label: 'Balanced' },
            { value: 'max', label: 'Max' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        <p className="mt-2 text-sm text-fg-2">{PROFILE_HINT[w.profile]}</p>
      </Section>
      <Section title="World simulation">
        <div className="flex flex-col divide-y divide-line">
          <ToggleRow label="Understand where you go" description="“I head to the market” moves you before the reply is written, and your companions come along. No model call." checked={w.intent} onChange={(v) => update({ world: { intent: v } })} />
          <ToggleRow label="Skill checks with real odds" description="Risky actions get a roll decided by code, shown to the narrator. A swipe replays the same roll." checked={w.dice} onChange={(v) => update({ world: { dice: v } })} />
          <ToggleRow label="Random events" description="Now and then something happens on its own. No model call." checked={w.pulse} onChange={(v) => update({ world: { pulse: v } })} />
          <ToggleRow label="Off-screen storylines" description="Slow-burning threads that grow from rumour to something you can't ignore. No model call." checked={w.threads} onChange={(v) => update({ world: { threads: v } })} />
          <ToggleRow label={<CostLabel text="Seed new storylines" cost="background" />} checked={w.threadSeeding} onChange={(v) => update({ world: { threadSeeding: v } })} disabled={!w.threads} />
          <ToggleRow label={<CostLabel text="Off-screen life" cost="background" />} description="What the people you aren't with do to each other." checked={w.social} onChange={(v) => update({ world: { social: v } })} />
          <ToggleRow label={<CostLabel text="Read my message first" cost="main" />} description="A quick utility-model read before the reply, for moves, time skips and checks the rules missed." checked={w.preRead} onChange={(v) => update({ world: { preRead: v } })} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Off-screen life every N turns" htmlFor="se">
            <Input id="se" type="number" min={1} max={50} value={w.socialEvery} onChange={(e) => update({ world: { socialEvery: Number(e.target.value) } })} />
          </Field>
        </div>
      </Section>
    </>
  );
}

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
  const w = settings.world;
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
        <Field label="Scene block budget (tokens)" htmlFor="ib" className="mt-3" hint="Over budget, the least important lines go first; where you are, who's here and the dice never do.">
          <Input id="ib" type="number" min={300} max={4000} step={50} value={w.sceneBudget} onChange={(e) => update({ world: { sceneBudget: Number(e.target.value) } })} className="max-w-[160px]" />
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
      <WorldSection />
      <Section title="Memory" description="What the story remembers and who knows it. Open Memory from a chat's menu to see it all.">
        <div className="flex flex-col divide-y divide-line">
          <ToggleRow label="Remember events and facts" description="Read from each reply by the tracker pass — no extra call." checked={w.memory} onChange={(v) => update({ world: { memory: v } })} />
          <ToggleRow label={<CostLabel text="Search by meaning" cost="embeddings" />} description="Also recall memories that mean the same thing in other words. Needs an embeddings connection." checked={w.semantic} onChange={(v) => update({ world: { semantic: v } })} />
          <ToggleRow label="Gossip" description="People standing together pass on what they saw (never secrets). No model call." checked={w.hearsay} onChange={(v) => update({ world: { hearsay: v } })} />
          <ToggleRow label={<CostLabel text="Chronicler" cost="background" />} description="Reads the chat in batches for anything the turn-by-turn pass missed. The only memory writer in chats without a game." checked={w.chronicler} onChange={(v) => update({ world: { chronicler: v } })} />
          <ToggleRow label={<CostLabel text="Write summaries with the model" cost="background" />} description="Finished scenes, days and chapters are folded either way; off means plain text." checked={w.consolidate} onChange={(v) => update({ world: { consolidate: v } })} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Chronicle every N turns" htmlFor="ce">
            <Input id="ce" type="number" min={2} max={200} value={w.chronicleEvery} onChange={(e) => update({ world: { chronicleEvery: Number(e.target.value) } })} />
          </Field>
          <Field label="Fold summaries every N turns" htmlFor="cs">
            <Input id="cs" type="number" min={1} max={50} value={w.consolidateEvery} onChange={(e) => update({ world: { consolidateEvery: Number(e.target.value) } })} />
          </Field>
          <Field label="Memories recalled per reply" htmlFor="rl">
            <Input id="rl" type="number" min={0} max={20} value={w.recallLimit} onChange={(e) => update({ world: { recallLimit: Number(e.target.value) } })} />
          </Field>
          <Field label="Chat summary length (words)" htmlFor="mw">
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
