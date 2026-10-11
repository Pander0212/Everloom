import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Field, Input, Segmented, ToggleRow } from '@/ui';
import { useFeatures } from '@/lib/features';
import { Section, useSettingsPatch } from '../common';
import { HUD_OPTIONS } from '@/features/game/hud-options';

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

/** A part that is switched off in Settings › Features: say so, with the way back. */
function OffNote({ what }: { what: string }) {
  return (
    <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-fg-2">
      {what} is off. Turn it on in{' '}
      <Link to="/settings/features" className="font-medium text-accent-text">
        Features
      </Link>
      .
    </p>
  );
}

function WorldSection() {
  const { settings, update } = useSettingsPatch();
  const f = useFeatures(null);
  if (!settings) return null;
  const w = settings.world;
  return (
    <>
      <Section title="World engine" description="How much the world does between replies. Every extra AI call is listed in a chat's Story state › Model calls.">
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
          {f.on.dice ? <ToggleRow label="Dice" description="Risky actions get a roll decided by code, shown to the narrator. A new version replays the same roll." checked={w.dice} onChange={(v) => update({ world: { dice: v } })} /> : null}
          {f.on.storylines ? (
            <>
              <ToggleRow label="Random events" description="Now and then something happens on its own. No extra AI call." checked={w.pulse} onChange={(v) => update({ world: { pulse: v } })} />
              <ToggleRow label="Off-screen storylines" description="Slow-burning threads that grow from rumour to something you can't ignore. No extra AI call." checked={w.threads} onChange={(v) => update({ world: { threads: v } })} />
              <ToggleRow label={<CostLabel text="Seed new storylines" cost="background" />} checked={w.threadSeeding} onChange={(v) => update({ world: { threadSeeding: v } })} disabled={!w.threads} />
            </>
          ) : null}
          {f.on.offscreen ? <ToggleRow label={<CostLabel text="Off-screen life" cost="background" />} description="What the people you aren't with do to each other." checked={w.social} onChange={(v) => update({ world: { social: v } })} /> : null}
          {f.on.preRead ? <ToggleRow label={<CostLabel text="Read my message first" cost="main" />} description="A quick read before the reply, for moves, time skips and checks the rules missed." checked={w.preRead} onChange={(v) => update({ world: { preRead: v } })} /> : null}
        </div>
        {f.on.offscreen ? (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Field label="Off-screen life every N turns" htmlFor="se">
              <Input id="se" type="number" min={1} max={50} value={w.socialEvery} onChange={(e) => update({ world: { socialEvery: Number(e.target.value) } })} />
            </Field>
          </div>
        ) : null}
      </Section>
    </>
  );
}


export default function GameSection() {
  const { settings, update } = useSettingsPatch();
  const f = useFeatures(null);
  if (!settings) return null;
  const w = settings.world;
  const pinned = settings.hud.pinned;
  const toggle = (id: string) => update({ hud: { pinned: pinned.includes(id) ? pinned.filter((p) => p !== id) : [...pinned, id] } });
  return (
    <>
      <Section title="Auto-tracking" description="After each reply, Everloom reads what happened and updates items, time, places, people and stats.">
        {!f.on.trackerPass ? (
          <OffNote what="Auto-tracking" />
        ) : settings.tracker.mode === 'off' ? (
          <div className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-fg-2">
            <span className="flex-1">Auto-tracking is paused. You can still change things by hand.</span>
            <Button size="sm" onClick={() => update({ tracker: { mode: 'separate' } })}>
              Resume
            </Button>
          </div>
        ) : (
          <Field label="How it runs" htmlFor="tm" hint={settings.tracker.mode === 'separate' ? 'A second, small call to the utility model after each reply. Most reliable.' : 'The main model notes the changes inside its reply. One call, but it depends on the model following instructions.'}>
            <Segmented
              label="How auto-tracking runs"
              value={settings.tracker.mode}
              onChange={(v) => update({ tracker: { mode: v } })}
              options={[
                { value: 'separate', label: 'Separate call' },
                { value: 'inline', label: 'Inside the reply' },
              ]}
            />
          </Field>
        )}
      </Section>
      <Section title="What the AI sees" description="The story state (time, place, people here, what each person knows) given to the AI with every reply.">
        {!f.on.sceneBlock ? (
          <OffNote what="What the AI sees" />
        ) : !settings.tracker.injectState ? (
          <div className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-fg-2">
            <span className="flex-1">The story state isn't being sent.</span>
            <Button size="sm" onClick={() => update({ tracker: { injectState: true } })}>
              Send it again
            </Button>
          </div>
        ) : (
          <Field label="Size limit (tokens)" htmlFor="ib" hint="Over the limit, the least important lines go first; where you are, who's here and the dice never do.">
            <Input id="ib" type="number" min={300} max={4000} step={50} value={w.sceneBudget} onChange={(e) => update({ world: { sceneBudget: Number(e.target.value) } })} className="max-w-[160px]" />
          </Field>
        )}
      </Section>
      <Section title="Status bar" description="The thin bar at the top of a game chat. Tap it to see your status, or the place to open the map.">
        <div className="flex flex-wrap gap-2">
          {HUD_OPTIONS.map(([id, label]) => (
            <button key={id} onClick={() => toggle(id)} aria-pressed={pinned.includes(id)} className={`pressable h-9 rounded-full px-3.5 text-sm ${pinned.includes(id) ? 'bg-accent-soft font-medium text-accent-text' : 'bg-surface-2 text-fg-2'}`}>
              {label}
            </button>
          ))}
        </div>
      </Section>
      <WorldSection />
      <Section title="Memory" description="What the story remembers and who knows it. In a chat, Tools › Memory shows it all.">
        <div className="flex flex-col divide-y divide-line">
          <ToggleRow label="Remember events and facts" description="Read from each reply by auto-tracking — no extra call." checked={w.memory} onChange={(v) => update({ world: { memory: v } })} />
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
      {f.on.helper ? (
        <Section title="Helper" description="The small companion you can ask about the game (Tools › Helper). Weather and particles are in Tools › Weather & mood.">
          <Field label="Helper name" htmlFor="hn">
            <Input id="hn" value={settings.helper.name} onChange={(e) => update({ helper: { name: e.target.value } })} className="max-w-[240px]" />
          </Field>
        </Section>
      ) : null}
    </>
  );
}
