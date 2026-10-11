/**
 * Scenarios (docs/ux/hakawati.md): reusable starting points. Start a story from one (its questions
 * are asked first), edit, share as JSON (clipboard or file), or import one.
 */
import { exportScenario, findQuestions, PRESET_INFO, validAnswer, type FeaturePreset, type ScenarioCard, type ScenarioDTO, type ScenarioData } from '@everloom/engine';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCopy, ClipboardPaste, Download, Map as MapIcon, Pencil, Play, Plus, Trash2, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/app/Shell';
import { del, get, post, put } from '@/lib/api';
import { useCharacters, usePersonas } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Button, confirm, EmptyState, Field, FileButton, HelpToggle, IconButton, Input, Select, Sheet, Textarea } from '@/ui';

const EMPTY: ScenarioData = { title: '', summary: '', cover: null, characterId: null, opening: '', instructions: '', plot: '', note: '', mode: null, game: null, cards: [] };
const HELP = 'A scenario is a starting point you can use again and again: the opening, how the narrator should run it, where the plot should go, a note to the AI, starting money and items, story cards and a cover. Each story started from it gets its own copy, so editing the scenario never changes a story. Text can ask ${questions}, answered when a story starts. Example: “Heist at the Opera”, opening in the rain outside the theatre.';

export default function ScenariosPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['scenarios'], queryFn: () => get<ScenarioDTO[]>('/api/scenarios') });
  const [editing, setEditing] = useState<ScenarioDTO | 'new' | null>(null);
  const [starting, setStarting] = useState<ScenarioDTO | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['scenarios'] });
  const importText = async (text: string) => {
    try {
      await post('/api/scenarios', JSON.parse(text));
      await refresh();
      toast({ title: 'Scenario imported', tone: 'success' });
    } catch (e) {
      toastError(e instanceof SyntaxError ? new Error('That isn’t a scenario (the JSON could not be read)') : e);
    }
  };
  const download = (s: ScenarioDTO) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportScenario(s)], { type: 'application/json' }));
    a.download = `${s.title.replace(/[^\w\s.-]+/g, '').slice(0, 60) || 'scenario'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <Page
      title="Scenarios"
      actions={
        <div className="flex gap-1">
          <IconButton icon={ClipboardPaste} label="Import from the clipboard" onClick={async () => {
            try {
              await importText(await navigator.clipboard.readText());
            } catch (e) {
              toastError(e);
            }
          }} />
          <FileButton variant="quiet" icon={Upload} accept=".json,application/json" onFiles={async (f) => f[0] && importText(await f[0].text())}>
            <span className="max-sm:sr-only">Import</span>
          </FileButton>
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            <span className="max-sm:sr-only">New scenario</span>
          </Button>
        </div>
      }
    >
      <HelpToggle help={HELP} className="mb-3" />
      {list.data?.length ? (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Scenarios">
          {list.data.map((s) => (
            <li key={s.id} className="flex gap-3 rounded-lg border border-line p-3">
              {s.cover ? <img src={s.cover} alt="" className="size-20 flex-none rounded-md object-cover" /> : <span className="flex size-20 flex-none items-center justify-center rounded-md bg-surface-2 text-fg-3"><MapIcon /></span>}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{s.title}</span>
                <span className="line-clamp-2 text-sm text-fg-2">{s.summary || s.opening.slice(0, 140) || 'No opening yet'}</span>
                <div className="mt-auto flex flex-wrap gap-1 pt-2">
                  <Button size="sm" variant="primary" icon={Play} onClick={() => setStarting(s)}>
                    Start
                  </Button>
                  <IconButton size="sm" icon={Pencil} label={`Edit ${s.title}`} onClick={() => setEditing(s)} />
                  <IconButton size="sm" icon={ClipboardCopy} label={`Copy ${s.title} as JSON`} onClick={() => void navigator.clipboard.writeText(exportScenario(s)).then(() => toast({ title: 'Copied', tone: 'success' }))} />
                  <IconButton size="sm" icon={Download} label={`Download ${s.title}`} onClick={() => download(s)} />
                  <IconButton size="sm" icon={Trash2} label={`Delete ${s.title}`} onClick={async () => {
                    if (!(await confirm({ title: `Delete ${s.title}?`, description: 'Stories started from it keep their own copy.', confirmLabel: 'Delete', danger: true }))) return;
                    await del(`/api/scenarios/${s.id}`).catch(toastError);
                    await refresh();
                  }} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={MapIcon} title="No scenarios yet" body="A scenario is a starting point you can use again: an opening, a plot, cards and a starting kit. Make one, import one, or save a chat as one from This chat." action={<Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>New scenario</Button>} />
      )}
      {editing ? <Editor initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
      {starting ? <StartSheet scenario={starting} onClose={() => setStarting(null)} /> : null}
    </Page>
  );
}

function Editor({ initial, onClose, onSaved }: { initial: ScenarioDTO | null; onClose: () => void; onSaved: () => void }) {
  const chars = useCharacters();
  const [d, setD] = useState<ScenarioData>(initial ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<ScenarioData>) => setD((x) => ({ ...x, ...p }));
  const items = (d.game?.items ?? []) as Array<{ name: string; qty: number }>;
  const cover = async (f: File) => {
    // A small cover: scaled down and stored inside the scenario.
    const img = await createImageBitmap(f);
    const k = Math.min(1, 320 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * k);
    cv.height = Math.round(img.height * k);
    cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
    set({ cover: cv.toDataURL('image/webp', 0.8) });
  };
  const save = async () => {
    setBusy(true);
    try {
      if (initial) await put(`/api/scenarios/${initial.id}`, d);
      else await post('/api/scenarios', d);
      onSaved();
      onClose();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const setCard = (i: number, p: Partial<ScenarioCard>) => set({ cards: d.cards.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={initial ? `Edit ${initial.title}` : 'New scenario'} size="lg" help={HELP} footer={<Button variant="primary" size="lg" block loading={busy} disabled={!d.title.trim()} onClick={() => void save()}>Save scenario</Button>}>
      <div className="flex flex-col gap-4">
        <Field label="Title" htmlFor="sc-title">
          <Input id="sc-title" value={d.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="One line about it" htmlFor="sc-sum">
          <Input id="sc-sum" value={d.summary} maxLength={300} onChange={(e) => set({ summary: e.target.value })} />
        </Field>
        <div className="flex items-center gap-3">
          {d.cover ? <img src={d.cover} alt="Cover" className="size-16 rounded-md object-cover" /> : null}
          <FileButton variant="secondary" icon={Upload} accept="image/*" onFiles={(f) => f[0] && void cover(f[0])}>
            {d.cover ? 'Change cover' : 'Add a cover'}
          </FileButton>
          {d.cover ? <IconButton icon={X} label="Remove cover" onClick={() => set({ cover: null })} /> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Character" htmlFor="sc-char">
            <Select id="sc-char" value={d.characterId ?? ''} onChange={(e) => set({ characterId: e.target.value || null })}>
              <option value="">Choose when starting</option>
              {(chars.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mode" htmlFor="sc-mode">
            <Select id="sc-mode" value={d.mode ?? ''} onChange={(e) => set({ mode: (e.target.value || null) as FeaturePreset | null })}>
              <option value="">Follow Settings</option>
              {(['classic', 'story', 'full'] as const).map((p) => (
                <option key={p} value={p}>
                  {PRESET_INFO[p].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Opening" htmlFor="sc-open" hint="The story's first message. It can ask ${Your name?} or ${Your ship? | options: Gull, Wren}.">
          <Textarea id="sc-open" rows={5} value={d.opening} onChange={(e) => set({ opening: e.target.value })} />
        </Field>
        <Field label="How the narrator should run it" htmlFor="sc-instr">
          <Textarea id="sc-instr" rows={3} value={d.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="Slow-burn mystery; clues are fair; nobody is who they seem." />
        </Field>
        <Field label="Where the plot should go" htmlFor="sc-plot" hint="Only the narrator sees this.">
          <Textarea id="sc-plot" rows={3} value={d.plot} onChange={(e) => set({ plot: e.target.value })} />
        </Field>
        <Field label="Note to the AI" htmlFor="sc-note">
          <Textarea id="sc-note" rows={2} value={d.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>
        <section className="flex flex-col gap-2" aria-label="Starting kit">
          <h3 className="text-sm font-medium">Starting kit (Story and Full RPG)</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Money" htmlFor="sc-money">
              <Input id="sc-money" type="number" min={0} value={d.game?.currency?.amount ?? ''} onChange={(e) => set({ game: { ...d.game, currency: { name: d.game?.currency?.name ?? 'Gold', symbol: d.game?.currency?.symbol ?? 'g', amount: Number(e.target.value) || 0 } } })} />
            </Field>
            <Field label="Starting place" htmlFor="sc-place">
              <Input id="sc-place" value={d.game?.location?.local ?? ''} onChange={(e) => set({ game: { ...d.game, location: { world: d.game?.location?.world ?? '', region: d.game?.location?.region ?? '', local: e.target.value, description: d.game?.location?.description ?? '' } } })} />
            </Field>
          </div>
          {items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label="Item" value={it.name} onChange={(e) => set({ game: { ...d.game, items: items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) } })} />
              <Input aria-label="How many" type="number" min={1} className="w-20" value={it.qty} onChange={(e) => set({ game: { ...d.game, items: items.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x)) } })} />
              <IconButton icon={X} label="Remove item" onClick={() => set({ game: { ...d.game, items: items.filter((_, j) => j !== i) } })} />
            </div>
          ))}
          <Button size="sm" variant="quiet" icon={Plus} className="self-start" onClick={() => set({ game: { ...d.game, items: [...items, { name: '', qty: 1 }] } })}>
            Add an item
          </Button>
        </section>
        <section className="flex flex-col gap-2" aria-label="Story cards">
          <h3 className="text-sm font-medium">Story cards</h3>
          {d.cards.map((c, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-md border border-line p-2">
              <div className="flex gap-2">
                <Input aria-label="Card title" placeholder="Title" value={c.title} onChange={(e) => setCard(i, { title: e.target.value })} />
                <IconButton icon={X} label="Remove card" onClick={() => set({ cards: d.cards.filter((_, j) => j !== i) })} />
              </div>
              <Input aria-label="Trigger words" placeholder="Words that bring it up, comma separated" value={c.keys.join(', ')} onChange={(e) => setCard(i, { keys: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })} />
              <Textarea aria-label="Card text" rows={2} value={c.content} onChange={(e) => setCard(i, { content: e.target.value })} />
            </div>
          ))}
          <Button size="sm" variant="quiet" icon={Plus} className="self-start" onClick={() => set({ cards: [...d.cards, { type: 'concept', title: '', keys: [], content: '' }] })}>
            Add a card
          </Button>
        </section>
      </div>
    </Sheet>
  );
}

function StartSheet({ scenario: s, onClose }: { scenario: ScenarioDTO; onClose: () => void }) {
  const chars = useCharacters();
  const personas = usePersonas();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [characterId, setCharacterId] = useState(s.characterId ?? '');
  const [personaId, setPersonaId] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const questions = useMemo(() => findQuestions([s.opening, s.instructions, s.plot, s.note, ...s.cards.map((c) => c.content)]), [s]);
  const ready = !!characterId && questions.every((q) => validAnswer(q, answers[q.key]));
  const start = async () => {
    setBusy(true);
    try {
      const chat = await post<{ id: string }>(`/api/scenarios/${s.id}/start`, { characterId, personaId: personaId || null, answers: Object.fromEntries(questions.map((q) => [q.key, answers[q.key]!.trim()])) });
      await qc.invalidateQueries({ queryKey: ['chats'] });
      navigate(`/chat/${chat.id}`);
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={`Start “${s.title}”`} size="md" footer={<Button variant="primary" size="lg" block icon={Play} disabled={!ready} loading={busy} onClick={() => void start()}>Start the story</Button>}>
      <div className="flex flex-col gap-4">
        {!s.characterId ? (
          <Field label="With" htmlFor="st-char">
            <Select id="st-char" value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
              <option value="">Choose a character…</option>
              {(chars.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {questions.map((q, i) => (
          <Field key={q.key} label={q.text} htmlFor={`sq-${i}`}>
            {q.fixed ? (
              <Select id={`sq-${i}`} value={answers[q.key] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}>
                <option value="">Choose…</option>
                {q.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            ) : (
              <>
                <Input id={`sq-${i}`} value={answers[q.key] ?? ''} maxLength={200} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} />
                {q.options.length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {q.options.map((o) => (
                      <button key={o} type="button" onClick={() => setAnswers((a) => ({ ...a, [q.key]: o }))} className="pressable h-8 rounded-full bg-surface-2 px-3 text-xs font-medium text-fg-2 hover:text-fg">
                        {o}
                      </button>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </Field>
        ))}
        <Field label="Play as" htmlFor="st-persona">
          <Select id="st-persona" value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
            <option value="">Default persona</option>
            {(personas.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}
