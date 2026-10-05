import { contentStorageAllowed } from '@/lib/vaultMode';
/**
 * Character studio: write a card with an AI's help. Brainstorm concepts, write a full card from a
 * brief, refine the whole card, (re)write one field, or select a passage and revise just that.
 * Start from scratch or from an existing character; save as new or overwrite (a snapshot is kept).
 */
import { emptyCardData, STUDIO_FIELDS, type CardData, type CharacterDTO, type StudioField, type StudioRequest, type StudioResult } from '@everloom/engine';
import { ArrowLeft, Lightbulb, Plus, SlidersHorizontal, Sparkles, Undo2, UserRound, Wand2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Page } from '@/app/Shell';
import { get, patch, post } from '@/lib/api';
import { useCharacters, useConnections } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Button, confirm, Field, IconButton, Input, Menu, Textarea } from '@/ui';
import { CharacterPicker, StudioSettings } from './StudioSheets';

type Draft = Partial<Pick<CardData, StudioField>>;
const STORE = 'everloom.studio';
const MAIN_FIELDS = STUDIO_FIELDS.filter((f) => !['system_prompt', 'post_history_instructions'].includes(f.key));
const EXTRA_FIELDS = STUDIO_FIELDS.filter((f) => ['system_prompt', 'post_history_instructions'].includes(f.key));
const QUICK = ['Shorter', 'More vivid', 'More in character', 'Fix grammar'];

function loadSaved(): { draft: Draft; baseId: string | null; brief: string } {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (v && typeof v === 'object') return { draft: v.draft ?? {}, baseId: v.baseId ?? null, brief: v.brief ?? '' };
  } catch {
    /* no storage */
  }
  return { draft: {}, baseId: null, brief: '' };
}

const filled = (d: Draft) => STUDIO_FIELDS.some(({ key }) => (Array.isArray(d[key]) ? (d[key] as string[]).length : String(d[key] ?? '').trim()));

export default function StudioPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const saved = useMemo(loadSaved, []);
  const [draft, setDraft] = useState<Draft>(saved.draft);
  const [baseId, setBaseId] = useState<string | null>(saved.baseId);
  const [brief, setBrief] = useState(saved.brief);
  const [ideas, setIdeas] = useState<Array<{ title: string; pitch: string }>>([]);
  const [history, setHistory] = useState<Draft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [refine, setRefine] = useState('');
  const [picker, setPicker] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [saving, setSaving] = useState(false);
  const chars = useCharacters();
  const conns = useConnections();
  const base = chars.data?.find((c) => c.id === baseId) ?? null;

  useEffect(() => {
    try {
      if (contentStorageAllowed()) localStorage.setItem(STORE, JSON.stringify({ draft, baseId, brief }));
    } catch {
      /* no storage */
    }
  }, [draft, baseId, brief]);

  // ?base=<id> starts from an existing character.
  useEffect(() => {
    const id = params.get('base');
    if (id && id !== baseId) void startFrom(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const remember = () => setHistory((h) => [...h.slice(-29), draft]);
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setDraft(prev);
    setNotes('');
  };
  const setField = (k: StudioField, v: Draft[StudioField]) => setDraft((d) => ({ ...d, [k]: v }));

  async function run(request: StudioRequest, key: string): Promise<StudioResult | null> {
    if (!conns.data?.length) {
      toast({ title: 'Add a connection first', lines: ['Settings → Connections'], tone: 'danger' });
      return null;
    }
    setBusy(key);
    try {
      return await post<StudioResult>('/api/studio/run', { request, draft });
    } catch (e) {
      toastError(e);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function startFrom(id: string) {
    try {
      const c = await get<CharacterDTO>(`/api/characters/${id}`);
      if (filled(draft)) remember();
      const d: Draft = {};
      for (const { key } of STUDIO_FIELDS) (d as any)[key] = structuredClone((c.card as any)[key] ?? (key === 'tags' || key === 'alternate_greetings' ? [] : ''));
      setDraft(d);
      setBaseId(c.id);
      setNotes(`Started from ${c.name}.`);
      setPicker(false);
    } catch (e) {
      toastError(e);
    } finally {
      if (params.get('base')) setParams({}, { replace: true });
    }
  }

  const brainstorm = async () => {
    const r = await run({ mode: 'brainstorm', brief }, 'brainstorm');
    if (r?.mode === 'brainstorm') setIdeas(r.ideas);
  };
  const create = async (text = brief) => {
    const r = await run({ mode: 'create', brief: text }, 'create');
    if (r?.mode !== 'create') return;
    remember();
    setDraft((d) => ({ ...d, ...r.card }));
    setNotes(r.notes || 'Wrote the card.');
    setIdeas([]);
  };
  const refineCard = async () => {
    const r = await run({ mode: 'refine', instruction: refine }, 'refine');
    if (r?.mode !== 'refine') return;
    remember();
    setDraft((d) => ({ ...d, ...r.card }));
    setNotes(r.notes || `Changed ${Object.keys(r.card).length} field(s).`);
    setRefine('');
  };
  const writeField = async (field: StudioField) => {
    const r = await run({ mode: 'field', field }, `field:${field}`);
    if (r?.mode !== 'field') return;
    remember();
    setField(field, r.value as any);
    setNotes(`Rewrote ${STUDIO_FIELDS.find((f) => f.key === field)!.label.toLowerCase()}.`);
  };
  const revise = async (field: StudioField, sel: Selection, instruction: string) => {
    const r = await run({ mode: 'revise', field, selection: sel.text, instruction }, `revise:${field}`);
    if (r?.mode !== 'revise') return false;
    const cur = String(draft[field] ?? '');
    // Replace exactly what was selected; if the text moved since, replace the first match.
    const at = cur.slice(sel.start, sel.end) === sel.text ? sel.start : cur.indexOf(sel.text);
    if (at < 0) {
      toast({ title: 'The selected text changed', lines: ['Select it again and retry.'], tone: 'danger' });
      return false;
    }
    remember();
    setField(field, cur.slice(0, at) + r.text + cur.slice(at + sel.text.length));
    setNotes('Revised the selection.');
    return true;
  };

  const card = (): CardData => ({ ...emptyCardData(), ...draft, name: (draft.name ?? '').trim() || 'Unnamed' }) as CardData;
  const saveNew = async () => {
    setSaving(true);
    try {
      const c = await post<CharacterDTO>('/api/characters', { card: card() });
      toast({ title: 'Character created', tone: 'success' });
      reset(false);
      navigate(`/characters/${c.id}`);
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  const overwrite = async () => {
    if (!base || !(await confirm({ title: `Overwrite ${base.name}?`, description: 'The current version is kept in its history, so you can restore it.', confirmLabel: 'Overwrite' }))) return;
    setSaving(true);
    try {
      await patch(`/api/characters/${base.id}`, { card: draft });
      toast({ title: `${draft.name || base.name} saved`, lines: ['The previous version is in its history.'], tone: 'success' });
      reset(false);
      navigate(`/characters/${base.id}`);
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };
  const reset = (ask = true) => {
    const go = () => {
      setDraft({});
      setBaseId(null);
      setBrief('');
      setIdeas([]);
      setHistory([]);
      setNotes('');
    };
    if (!ask) return go();
    void confirm({ title: 'Start over?', description: 'This clears the draft.', confirmLabel: 'Start over', danger: true }).then((ok) => ok && go());
  };

  const has = filled(draft);
  return (
    <Page
      narrow
      back={<IconButton icon={ArrowLeft} label="Back" onClick={() => navigate('/characters')} />}
      title="Studio"
      actions={
        <>
          <IconButton icon={Undo2} label="Undo" disabled={!history.length} onClick={undo} />
          <IconButton icon={SlidersHorizontal} label="Studio settings" onClick={() => setSettingsOpen(true)} />
          {base ? (
            <Menu
              trigger={
                <Button variant="primary" loading={saving} disabled={!draft.name?.trim()}>
                  Save
                </Button>
              }
              items={[
                { label: `Overwrite ${base.name}`, onSelect: overwrite },
                { label: 'Save as new character', onSelect: saveNew },
              ]}
            />
          ) : (
            <Button variant="primary" loading={saving} disabled={!draft.name?.trim()} onClick={saveNew}>
              Save
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-6 pb-16 pt-1">
        <section className="rounded-lg border border-line p-4" aria-label="Start">
          <Field label={has ? 'Brief' : 'Describe the character you want'} htmlFor="studio-brief">
            <Textarea id="studio-brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={2} maxRows={8} placeholder="A retired lighthouse keeper on a haunted coast who keeps a log of ships that never arrive…" />
          </Field>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:flex">
            <Button icon={Lightbulb} loading={busy === 'brainstorm'} disabled={!!busy} onClick={brainstorm}>
              Brainstorm
            </Button>
            <Button variant="primary" icon={Wand2} loading={busy === 'create'} disabled={!!busy || brief.trim().length < 3} onClick={() => create()}>
              {has ? 'Rewrite card' : 'Write the card'}
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-1">
            <Button variant="quiet" size="sm" icon={UserRound} className="-ml-2" onClick={() => setPicker(true)}>
              {base ? `Based on ${base.name}` : 'Start from a character'}
            </Button>
            {has ? (
              <Button variant="quiet" size="sm" onClick={() => reset()}>
                Start over
              </Button>
            ) : null}
          </div>
          {ideas.length ? (
            <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Ideas">
              {ideas.map((i) => (
                <li key={i.title}>
                  <button
                    className="pressable flex h-full w-full flex-col gap-1 rounded-md bg-surface-2 p-3 text-left hover:bg-surface-3 disabled:opacity-60"
                    disabled={!!busy}
                    onClick={() => {
                      const text = `${i.title}. ${i.pitch}`;
                      setBrief(text);
                      void create(text);
                    }}
                  >
                    <span className="text-sm font-semibold">{i.title}</span>
                    <span className="text-sm text-fg-2">{i.pitch}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {has ? (
          <section className="flex flex-col gap-2" aria-label="Refine">
            <div className="flex items-end gap-2">
              <Textarea
                value={refine}
                onChange={(e) => setRefine(e.target.value)}
                rows={1}
                maxRows={5}
                aria-label="Ask for changes"
                placeholder="Ask for changes to the whole card: make her warmer, add a rival…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && refine.trim().length >= 3) {
                    e.preventDefault();
                    void refineCard();
                  }
                }}
              />
              <Button icon={Sparkles} loading={busy === 'refine'} disabled={!!busy || refine.trim().length < 3} onClick={refineCard}>
                Refine
              </Button>
            </div>
            {notes ? (
              <p className="flex items-center gap-2 text-sm text-fg-2" aria-live="polite">
                <span className="min-w-0 flex-1">{notes}</span>
                {history.length ? (
                  <button className="pressable text-sm font-medium text-accent-text" onClick={undo}>
                    Undo
                  </button>
                ) : null}
              </p>
            ) : null}
          </section>
        ) : null}

        {has || busy === 'create' ? (
          <section className="flex flex-col gap-5" aria-label="Card">
            {MAIN_FIELDS.map((f) => (
              <StudioFieldEditor key={f.key} field={f.key} label={f.label} value={draft[f.key]} busy={busy} onChange={(v) => setField(f.key, v)} onWrite={() => writeField(f.key)} onRevise={(sel, how) => revise(f.key, sel, how)} />
            ))}
            {showExtra ? (
              EXTRA_FIELDS.map((f) => <StudioFieldEditor key={f.key} field={f.key} label={f.label} value={draft[f.key]} busy={busy} onChange={(v) => setField(f.key, v)} onWrite={() => writeField(f.key)} onRevise={(sel, how) => revise(f.key, sel, how)} />)
            ) : (
              <button className="pressable self-start text-sm font-medium text-fg-2 hover:text-fg" onClick={() => setShowExtra(true)}>
                More fields: system prompt, post-history instructions
              </button>
            )}
          </section>
        ) : (
          <p className="text-center text-sm text-fg-2">Describe a character above, or start from one you already have. Once there's a draft, you can refine it, rewrite any field, or select a passage and revise just that part.</p>
        )}
      </div>
      <CharacterPicker open={picker} onOpenChange={setPicker} onPick={startFrom} />
      <StudioSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
    </Page>
  );
}

interface Selection {
  start: number;
  end: number;
  text: string;
}

function StudioFieldEditor({ field, label, value, busy, onChange, onWrite, onRevise }: { field: StudioField; label: string; value: unknown; busy: string | null; onChange: (v: any) => void; onWrite: () => void; onRevise: (sel: Selection, how: string) => Promise<boolean> }) {
  const [sel, setSel] = useState<Selection | null>(null);
  const [how, setHow] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = `studio-${field}`;
  const writing = busy === `field:${field}`;
  const revising = busy === `revise:${field}`;
  const write = (
    <Button size="sm" variant="quiet" icon={Sparkles} className="w-8 !px-0" aria-label={`Write ${label.toLowerCase()} with AI`} title={`Write ${label.toLowerCase()} with AI`} loading={writing} disabled={!!busy} onClick={onWrite} />
  );
  if (field === 'tags') {
    const tags = (value as string[] | undefined) ?? [];
    return (
      <Field label={label} htmlFor={id} trailing={write}>
        <Input id={id} value={tags.join(', ')} onChange={(e) => onChange(e.target.value.split(',').map((t) => t.trim()).filter((t, i, a) => t || i === a.length - 1))} placeholder="mystery, coastal, slow burn" />
      </Field>
    );
  }
  if (field === 'alternate_greetings') {
    const list = (value as string[] | undefined) ?? [];
    return (
      <Field label={label} trailing={write}>
        <div className="flex flex-col gap-2">
          {list.map((g, i) => (
            <div key={i} className="flex items-start gap-1">
              <Textarea value={g} onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))} rows={2} maxRows={12} aria-label={`Greeting ${i + 1}`} className="story" />
              <IconButton size="sm" icon={X} label={`Remove greeting ${i + 1}`} onClick={() => onChange(list.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" variant="quiet" icon={Plus} className="self-start" onClick={() => onChange([...list, ''])}>
            Add greeting
          </Button>
        </div>
      </Field>
    );
  }
  const text = String(value ?? '');
  const onSelect = () => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    if (e - s >= 3) setSel({ start: s, end: e, text: text.slice(s, e) });
  };
  // Touch devices select by long-press; that reliably reports only through the document's selectionchange.
  useEffect(() => {
    const on = () => document.activeElement === ref.current && onSelect();
    document.addEventListener('selectionchange', on);
    return () => document.removeEventListener('selectionchange', on);
  });
  const go = async (instruction: string) => {
    if (!sel || instruction.trim().length < 2) return;
    if (await onRevise(sel, instruction)) {
      setSel(null);
      setHow('');
    }
  };
  return (
    <Field label={label} htmlFor={id} trailing={write}>
      <Textarea
        ref={ref}
        id={id}
        value={text}
        onChange={(e) => {
          onChange(e.target.value);
          setSel(null);
        }}
        onSelect={onSelect}
        onMouseUp={onSelect}
        onKeyUp={onSelect}
        rows={field === 'name' ? 1 : 3}
        maxRows={field === 'description' ? 24 : 14}
        className={field === 'name' ? '' : 'story'}
      />
      {sel ? (
        <div className="flex flex-col gap-2 rounded-md bg-accent-soft p-2.5" role="group" aria-label={`Revise the selected ${label.toLowerCase()} text`}>
          <p className="line-clamp-2 text-xs text-fg-2">
            Revise “{sel.text.length > 120 ? `${sel.text.slice(0, 120)}…` : sel.text}”
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button key={q} className="pressable rounded-full bg-surface px-2.5 py-1 text-xs font-medium disabled:opacity-60" disabled={!!busy} onClick={() => go(q)}>
                {q}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Input value={how} onChange={(e) => setHow(e.target.value)} placeholder="Or say how…" aria-label="How to revise the selection" onKeyDown={(e) => e.key === 'Enter' && void go(how)} className="!bg-surface" />
            <Button size="sm" loading={revising} disabled={!!busy || how.trim().length < 2} onClick={() => go(how)}>
              Revise
            </Button>
            <IconButton size="sm" icon={X} label="Cancel revision" onClick={() => setSel(null)} />
          </div>
        </div>
      ) : null}
    </Field>
  );
}
