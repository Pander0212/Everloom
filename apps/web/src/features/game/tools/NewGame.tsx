import type { CampaignState, NewGameConfig, Style } from '@everloom/engine';
import { defaultNewGame } from '@everloom/engine';
import { ArrowLeft, ArrowRight, Plus, Sparkles, Wand2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState, type ReactNode } from 'react';
import { ArtPicture } from '@/lib/art';
import { post } from '@/lib/api';
import { cx } from '@/lib/format';
import { t } from '@/lib/motion';
import { setCampaignState, useMessages } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Button, confirm, Field, IconButton, Input, Segmented, Select, Slider, Textarea, ToggleRow } from '@/ui';
import { runGeneration } from '@/features/story/gen';
import { useGame } from '../context';
import { ToolSheet } from './ToolSheet';

const STEPS = ['Story', 'You', 'World', 'Start kit', 'People', 'Needs', 'Begin'] as const;
const AGE_STAGES = ['Child', 'Teen', 'Young adult', 'Adult', 'Middle-aged', 'Elder'];
const CATEGORIES = ['misc', 'food', 'drink', 'weapon', 'armor', 'clothing', 'accessory', 'key', 'tool', 'material', 'consumable', 'medicine', 'book', 'container', 'quest', 'valuable'];
const STYLE_DEFAULTS: Record<Style, { currency: NewGameConfig['currency']; year: number }> = {
  fantasy: { currency: { name: 'Gold', symbol: 'g', amount: 100 }, year: 1024 },
  modern: { currency: { name: 'Dollars', symbol: '$', amount: 250 }, year: 2026 },
  scifi: { currency: { name: 'Credits', symbol: '₵', amount: 500 }, year: 2387 },
};

type Setter = (p: Partial<NewGameConfig>) => void;

export default function NewGame() {
  const { chat, state, close } = useGame();
  const messages = useMessages(chat.id);
  const [cfg, setCfg] = useState<NewGameConfig>(() => {
    const c = defaultNewGame(Math.floor(Math.random() * 2 ** 31));
    c.title = chat.title || c.title;
    if (state?.player.name && state.player.name !== 'You') c.character.name = state.player.name;
    return c;
  });
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [premise, setPremise] = useState('');
  const [filling, setFilling] = useState(false);
  const [opening, setOpening] = useState(true);
  const [starting, setStarting] = useState(false);
  const set: Setter = (p) => setCfg((c) => ({ ...c, ...p }));
  const go = (n: number) => {
    setDir(n > step ? 1 : -1);
    setStep(Math.max(0, Math.min(STEPS.length - 1, n)));
  };

  const fill = async () => {
    setFilling(true);
    try {
      const r = await post<{ config: NewGameConfig }>('/api/newgame/fill', { config: cfg, premise });
      setCfg(r.config);
      toast({ title: 'Filled in the blanks', lines: ['Review each step — everything stays editable.'], tone: 'success' });
    } catch (e) {
      toastError(e);
    } finally {
      setFilling(false);
    }
  };

  const start = async () => {
    if ((messages.data?.length ?? 0) > 0 && !(await confirm({ title: 'Start over?', description: 'This replaces the game state for this chat. Messages stay, but trackers, map, people and items are reset to your new setup.', confirmLabel: 'Start new game', danger: true }))) return;
    setStarting(true);
    try {
      if (!opening) {
        const r = await post<{ state: CampaignState }>(`/api/chats/${chat.id}/newgame`, { config: cfg, opening: false });
        setCampaignState(chat.campaignId!, r.state);
        toast({ title: 'New game ready', tone: 'success' });
        close();
        return;
      }
      close();
      void runGeneration(chat.id, 'normal', `/api/chats/${chat.id}/newgame`, { config: cfg, opening: true }, (ev) => {
        if (ev.type === 'state' && ev.state) setCampaignState(chat.campaignId!, ev.state);
      });
    } catch (e) {
      toastError(e);
    } finally {
      setStarting(false);
    }
  };

  const last = step === STEPS.length - 1;
  return (
    <ToolSheet
      title="New game"
      description={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`}
      footer={
        <>
          <Button variant="ghost" icon={ArrowLeft} onClick={() => go(step - 1)} disabled={step === 0}>
            Back
          </Button>
          <span className="flex-1" />
          {last ? (
            <Button variant="primary" size="lg" icon={Sparkles} loading={starting} onClick={start} disabled={!cfg.character.name.trim()}>
              Start
            </Button>
          ) : (
            <Button variant="primary" iconRight={ArrowRight} onClick={() => go(step + 1)}>
              Next
            </Button>
          )}
        </>
      }
    >
      <nav aria-label="Steps" className="mb-5 flex gap-1">
        {STEPS.map((label, i) => (
          <button key={label} onClick={() => go(i)} aria-current={i === step ? 'step' : undefined} aria-label={label} className="group flex h-6 flex-1 items-center">
            <span className={cx('h-1 w-full rounded-full transition-colors', i <= step ? 'bg-accent' : 'bg-surface-3 group-hover:bg-line-strong')} />
          </button>
        ))}
      </nav>
      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div key={step} custom={dir} initial={{ opacity: 0, x: dir * 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -24 }} transition={t.base} className="flex flex-col gap-4">
            {step === 0 ? <StoryStep cfg={cfg} set={set} premise={premise} setPremise={setPremise} fill={fill} filling={filling} /> : null}
            {step === 1 ? <YouStep cfg={cfg} set={set} /> : null}
            {step === 2 ? <WorldStep cfg={cfg} set={set} /> : null}
            {step === 3 ? <KitStep cfg={cfg} set={set} /> : null}
            {step === 4 ? <PeopleStep cfg={cfg} set={set} /> : null}
            {step === 5 ? <NeedsStep cfg={cfg} set={set} /> : null}
            {step === 6 ? <Review cfg={cfg} opening={opening} setOpening={setOpening} fill={fill} filling={filling} /> : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </ToolSheet>
  );
}

// ------------------------------------------------------------------ steps

function StoryStep({ cfg, set, premise, setPremise, fill, filling }: { cfg: NewGameConfig; set: Setter; premise: string; setPremise: (v: string) => void; fill: () => void; filling: boolean }) {
  return (
    <>
      <Field label="Title" htmlFor="ng-title">
        <Input id="ng-title" value={cfg.title} onChange={(e) => set({ title: e.target.value })} maxLength={120} />
      </Field>
      <Field label="Setting">
        <ArtPicture key={cfg.style} src={`genre/${cfg.style}`} width={640} height={360} className="mb-2 block overflow-hidden rounded-md" imgClassName="aspect-video h-auto w-full object-cover" />
        <Segmented<Style>
          label="Setting"
          className="w-full"
          value={cfg.style}
          onChange={(style) => {
            const d = STYLE_DEFAULTS[style];
            const untouchedCurrency = Object.values(STYLE_DEFAULTS).some((x) => x.currency.name === cfg.currency.name);
            set({ style, ...(untouchedCurrency ? { currency: { ...d.currency } } : {}), startDate: { ...cfg.startDate, year: Object.values(STYLE_DEFAULTS).some((x) => x.year === cfg.startDate.year) || cfg.startDate.year === 2026 ? d.year : cfg.startDate.year } });
          }}
          options={[
            { value: 'fantasy', label: 'Fantasy' },
            { value: 'modern', label: 'Modern' },
            { value: 'scifi', label: 'Sci-fi' },
          ]}
        />
      </Field>
      <Field label="Premise" htmlFor="ng-premise" hint="A few sentences about the story you want. Used when filling in the blanks.">
        <Textarea id="ng-premise" value={premise} onChange={(e) => setPremise(e.target.value)} maxLength={4000} placeholder="A courier in a rain-soaked river town gets caught between two guilds…" />
      </Field>
      <Button variant="secondary" icon={Wand2} loading={filling} onClick={fill}>
        Fill the blanks with AI
      </Button>
      <p className="text-xs text-fg-3">Only empty fields are filled. Uses your Utility model (or Main if none).</p>
    </>
  );
}

function YouStep({ cfg, set }: { cfg: NewGameConfig; set: Setter }) {
  const ch = cfg.character;
  const setCh = (p: Partial<NewGameConfig['character']>) => set({ character: { ...ch, ...p } });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" htmlFor="ng-name" className="col-span-2 sm:col-span-1">
          <Input id="ng-name" value={ch.name} onChange={(e) => setCh({ name: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Class or role" htmlFor="ng-class" className="col-span-2 sm:col-span-1">
          <Input id="ng-class" value={ch.className} onChange={(e) => setCh({ className: e.target.value })} maxLength={80} placeholder="Courier" />
        </Field>
        <Field label="Age" htmlFor="ng-age">
          <Input id="ng-age" inputMode="numeric" value={ch.age ?? ''} onChange={(e) => setCh({ age: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} maxLength={5} />
        </Field>
        <Field label="Life stage" htmlFor="ng-stage">
          <Select id="ng-stage" value={ch.ageStage} onChange={(e) => setCh({ ageStage: e.target.value })}>
            {AGE_STAGES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </Field>
        <Field label="Level" htmlFor="ng-level">
          <Input id="ng-level" inputMode="numeric" value={ch.level} onChange={(e) => setCh({ level: Math.max(1, Math.min(99, Number(e.target.value.replace(/\D/g, '')) || 1)) })} maxLength={2} />
        </Field>
        <Field label="Resources" htmlFor="ng-res">
          <Select id="ng-res" value={ch.resourceProfile} onChange={(e) => setCh({ resourceProfile: e.target.value as NewGameConfig['character']['resourceProfile'] })}>
            <option value="hybrid">HP, MP and AP</option>
            <option value="mp">HP and MP</option>
            <option value="ap">HP and AP</option>
          </Select>
        </Field>
      </div>
      <Field label="Appearance" htmlFor="ng-app">
        <Textarea id="ng-app" value={cfg.appearance} onChange={(e) => set({ appearance: e.target.value })} maxLength={2000} />
      </Field>
    </>
  );
}

function WorldStep({ cfg, set }: { cfg: NewGameConfig; set: Setter }) {
  const L = cfg.location;
  const setL = (p: Partial<NewGameConfig['location']>) => set({ location: { ...L, ...p } });
  const d = cfg.startDate;
  const setD = (p: Partial<NewGameConfig['startDate']>) => set({ startDate: { ...d, ...p } });
  const num = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Number(v.replace(/\D/g, '')) || min));
  return (
    <>
      <ArtPicture key={cfg.style} src={`maps/${cfg.style}`} width={512} height={256} className="block overflow-hidden rounded-md" imgClassName="aspect-[2/1] h-auto w-full object-cover" />
      <Field label="World" htmlFor="ng-world">
        <Input id="ng-world" value={L.world} onChange={(e) => setL({ world: e.target.value })} maxLength={80} placeholder={cfg.style === 'scifi' ? 'The Reach' : cfg.style === 'modern' ? 'The City' : 'The Realm'} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Region" htmlFor="ng-region">
          <Input id="ng-region" value={L.region} onChange={(e) => setL({ region: e.target.value })} maxLength={80} />
        </Field>
        <Field label="Starting place" htmlFor="ng-local">
          <Input id="ng-local" value={L.local} onChange={(e) => setL({ local: e.target.value })} maxLength={80} />
        </Field>
      </div>
      <Field label="What it's like" htmlFor="ng-ldesc">
        <Textarea id="ng-ldesc" value={L.description} onChange={(e) => setL({ description: e.target.value })} maxLength={2000} />
      </Field>
      <div>
        <p className="mb-1.5 text-sm font-medium">Start date</p>
        <div className="grid grid-cols-4 gap-2">
          <Input aria-label="Year" inputMode="numeric" value={d.year} onChange={(e) => setD({ year: num(e.target.value, 1, 99999) })} />
          <Input aria-label="Month" inputMode="numeric" value={d.month} onChange={(e) => setD({ month: num(e.target.value, 1, 12) })} />
          <Input aria-label="Day" inputMode="numeric" value={d.day} onChange={(e) => setD({ day: num(e.target.value, 1, 31) })} />
          <Input aria-label="Hour" inputMode="numeric" value={d.hour} onChange={(e) => setD({ hour: Math.min(23, Number(e.target.value.replace(/\D/g, '')) || 0) })} />
        </div>
        <p className="mt-1 text-xs text-fg-3">Year · month · day · hour (0–23)</p>
      </div>
      <ToggleRow
        label="Real-time days"
        description={cfg.dayLength.mode === 'realtime' ? `A game day passes every ${cfg.dayLength.realMinutesPerDay} real minutes while you play.` : 'Time moves only when the story says so.'}
        checked={cfg.dayLength.mode === 'realtime'}
        onChange={(v) => set({ dayLength: { ...cfg.dayLength, mode: v ? 'realtime' : 'turns' } })}
      />
    </>
  );
}

function Rows<T>({ label, items, onChange, blank, render, addLabel }: { label: string; items: T[]; onChange: (v: T[]) => void; blank: T; render: (item: T, set: (p: Partial<T>) => void) => ReactNode; addLabel: string }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-3">{label}</h3>
      <div className="flex flex-col gap-2">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-2 rounded-md bg-surface-2 p-2">
            <div className="flex min-w-0 flex-1 flex-col gap-2">{render(it, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}</div>
            <IconButton size="sm" icon={X} label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Button variant="quiet" size="sm" icon={Plus} onClick={() => onChange([...items, structuredClone(blank)])} className="self-start">
          {addLabel}
        </Button>
      </div>
    </section>
  );
}

function KitStep({ cfg, set }: { cfg: NewGameConfig; set: Setter }) {
  const c = cfg.currency;
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Currency" htmlFor="ng-cur">
          <Input id="ng-cur" value={c.name} onChange={(e) => set({ currency: { ...c, name: e.target.value } })} maxLength={30} />
        </Field>
        <Field label="Symbol" htmlFor="ng-sym">
          <Input id="ng-sym" value={c.symbol} onChange={(e) => set({ currency: { ...c, symbol: e.target.value } })} maxLength={4} />
        </Field>
        <Field label="Amount" htmlFor="ng-amt">
          <Input id="ng-amt" inputMode="decimal" value={c.amount} onChange={(e) => set({ currency: { ...c, amount: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 } })} />
        </Field>
      </div>
      <Rows
        label="Items"
        addLabel="Add item"
        items={cfg.items}
        onChange={(items) => set({ items })}
        blank={{ name: '', qty: 1, category: 'misc' as const }}
        render={(it, up) => (
          <div className="flex gap-2">
            <Input aria-label="Item name" placeholder="Name" value={it.name} onChange={(e) => up({ name: e.target.value })} className="min-w-0 flex-1" maxLength={80} />
            <Input aria-label="Quantity" inputMode="numeric" value={it.qty} onChange={(e) => up({ qty: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} className="w-14" />
            <Select aria-label="Category" value={it.category ?? 'misc'} onChange={(e) => up({ category: e.target.value as any })} className="w-28">
              {CATEGORIES.map((k) => (
                <option key={k} value={k}>
                  {k[0].toUpperCase() + k.slice(1)}
                </option>
              ))}
            </Select>
          </div>
        )}
      />
      <Rows
        label="Skills"
        addLabel="Add skill"
        items={cfg.skills}
        onChange={(skills) => set({ skills })}
        blank={{ name: '', kind: 'utility' as const, cost: 0, costType: 'none' as const, power: 10 }}
        render={(sk, up) => (
          <>
            <div className="flex gap-2">
              <Input aria-label="Skill name" placeholder="Name" value={sk.name} onChange={(e) => up({ name: e.target.value })} className="min-w-0 flex-1" maxLength={80} />
              <Select aria-label="Kind" value={sk.kind} onChange={(e) => up({ kind: e.target.value as any })} className="w-28">
                {['attack', 'heal', 'buff', 'debuff', 'utility'].map((k) => (
                  <option key={k} value={k}>
                    {k[0].toUpperCase() + k.slice(1)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex gap-2">
              <Input aria-label="Power" inputMode="numeric" value={sk.power} onChange={(e) => up({ power: Number(e.target.value.replace(/\D/g, '')) || 0 })} className="w-20" />
              <Input aria-label="Cost" inputMode="numeric" value={sk.cost} onChange={(e) => up({ cost: Number(e.target.value.replace(/\D/g, '')) || 0 })} className="w-20" />
              <Select aria-label="Cost type" value={sk.costType} onChange={(e) => up({ costType: e.target.value as any })} className="min-w-0 flex-1">
                <option value="none">Free</option>
                <option value="mp">MP</option>
                <option value="ap">AP</option>
              </Select>
            </div>
          </>
        )}
      />
    </>
  );
}

function PeopleStep({ cfg, set }: { cfg: NewGameConfig; set: Setter }) {
  return (
    <>
      <Rows
        label="People you know"
        addLabel="Add person"
        items={cfg.npcs}
        onChange={(npcs) => set({ npcs })}
        blank={{ name: '', role: '', personality: '' }}
        render={(n, up) => (
          <>
            <div className="flex gap-2">
              <Input aria-label="Name" placeholder="Name" value={n.name} onChange={(e) => up({ name: e.target.value })} className="min-w-0 flex-1" maxLength={80} />
              <Input aria-label="Role" placeholder="Role" value={n.role ?? ''} onChange={(e) => up({ role: e.target.value })} className="min-w-0 flex-1" maxLength={80} />
            </div>
            <Input aria-label="Personality" placeholder="Personality" value={n.personality ?? ''} onChange={(e) => up({ personality: e.target.value })} maxLength={300} />
          </>
        )}
      />
      <Rows
        label="Organizations"
        addLabel="Add organization"
        items={cfg.groups}
        onChange={(groups) => set({ groups })}
        blank={{ name: '', type: '', standing: 50 }}
        render={(g, up) => (
          <>
            <div className="flex gap-2">
              <Input aria-label="Name" placeholder="Name" value={g.name} onChange={(e) => up({ name: e.target.value })} className="min-w-0 flex-1" maxLength={80} />
              <Input aria-label="Type" placeholder="Guild, gang…" value={g.type} onChange={(e) => up({ type: e.target.value })} className="min-w-0 flex-1" maxLength={80} />
            </div>
            <div className="flex items-center gap-3">
              <span className="w-24 flex-none text-xs text-fg-2">Standing {Math.round(g.standing)}</span>
              <Slider label="Standing" value={g.standing} onChange={(v) => up({ standing: v })} />
            </div>
          </>
        )}
      />
      <Rows
        label="Quests"
        addLabel="Add quest"
        items={cfg.quests}
        onChange={(quests) => set({ quests })}
        blank={{ title: '', desc: '', objectives: [] as string[] }}
        render={(q, up) => (
          <>
            <Input aria-label="Quest title" placeholder="Title" value={q.title} onChange={(e) => up({ title: e.target.value })} maxLength={120} />
            <Input aria-label="Objectives" placeholder="Objectives, separated by ;" value={q.objectives.join('; ')} onChange={(e) => up({ objectives: e.target.value.split(';').map((x) => x.trimStart()) })} maxLength={600} />
          </>
        )}
      />
      <Field label="World facts" htmlFor="ng-facts" hint="One per line. Stored in the databank and recalled when relevant.">
        <Textarea id="ng-facts" value={cfg.facts.join('\n')} onChange={(e) => set({ facts: e.target.value.split('\n') })} maxLength={6000} />
      </Field>
    </>
  );
}

function NeedsStep({ cfg, set }: { cfg: NewGameConfig; set: Setter }) {
  return (
    <>
      <p className="text-sm text-fg-2">Needs drift with time and show on your HUD. Turn off what you don't want to manage.</p>
      <div className="flex flex-col divide-y divide-line">
        {cfg.trackers.map((tr, i) => (
          <div key={tr.id} className="py-2">
            <ToggleRow
              label={tr.label}
              description={tr.direction === 'need' ? `Rises ${Math.abs(tr.perHour)} per hour` : `Falls ${Math.abs(tr.perHour)} per hour`}
              checked={tr.enabled}
              onChange={(v) => set({ trackers: cfg.trackers.map((x, j) => (j === i ? { ...x, enabled: v } : x)) })}
            />
            {tr.enabled ? (
              <div className="mt-1 flex items-center gap-3 pl-0.5">
                <span className="w-20 flex-none text-xs text-fg-2">Start {Math.round(tr.value)}</span>
                <Slider label={`${tr.label} start value`} value={tr.value} max={tr.max} onChange={(v) => set({ trackers: cfg.trackers.map((x, j) => (j === i ? { ...x, value: v } : x)) })} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

function Review({ cfg, opening, setOpening, fill, filling }: { cfg: NewGameConfig; opening: boolean; setOpening: (v: boolean) => void; fill: () => void; filling: boolean }) {
  const rows = useMemo(
    () =>
      [
        ['Story', `${cfg.title} · ${cfg.style === 'scifi' ? 'Sci-fi' : cfg.style[0].toUpperCase() + cfg.style.slice(1)}`],
        ['You', [cfg.character.name || 'Unnamed', cfg.character.className, cfg.character.age ? `${cfg.character.age}` : null, `Level ${cfg.character.level}`].filter(Boolean).join(' · ')],
        ['Start', [cfg.location.local, cfg.location.region, cfg.location.world].filter(Boolean).join(', ') || 'Unnamed place'],
        ['Money', `${cfg.currency.symbol}${cfg.currency.amount} ${cfg.currency.name}`],
        ['Items', cfg.items.filter((i) => i.name.trim()).map((i) => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(', ')],
        ['Skills', cfg.skills.filter((s) => s.name.trim()).map((s) => s.name).join(', ')],
        ['People', cfg.npcs.filter((n) => n.name.trim()).map((n) => n.name).join(', ')],
        ['Factions', cfg.groups.filter((g) => g.name.trim()).map((g) => g.name).join(', ')],
        ['Quests', cfg.quests.filter((q) => q.title.trim()).map((q) => q.title).join(', ')],
        ['Needs', cfg.trackers.filter((x) => x.enabled).map((x) => x.label).join(', ')],
      ].filter(([, v]) => v),
    [cfg],
  );
  return (
    <>
      <dl className="flex flex-col divide-y divide-line rounded-md border border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 px-3 py-2.5 text-sm">
            <dt className="w-20 flex-none text-fg-2">{k}</dt>
            <dd className="min-w-0 flex-1">{v}</dd>
          </div>
        ))}
      </dl>
      {!cfg.character.name.trim() ? <p className="text-sm text-danger">Give your character a name (step 2) to start.</p> : null}
      <ToggleRow label="Write an opening scene" description="The Main model sets the scene from your setup." checked={opening} onChange={setOpening} />
      <Button variant="quiet" size="sm" icon={Wand2} loading={filling} onClick={fill} className="self-start">
        Fill remaining blanks with AI
      </Button>
    </>
  );
}
