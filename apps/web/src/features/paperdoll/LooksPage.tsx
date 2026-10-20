/**
 * Character Studio looks (/characters/looks): paper-doll characters. A list of story characters and
 * random NPCs; an editor with Body · Face · Hair · Clothing · Expressions, a preview swipeable
 * between the installed pose templates, randomize with locks, fill from a card's description,
 * lock the final design, duplicate, export/import as JSON; and the installed templates.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CATALOG, PALETTES, SLIDERS, TraitSheetSchema, WARDROBE_SLOTS, type TraitSheet } from '@everloom/engine/studio';
import { ChevronLeft, ChevronRight, Copy, Dices, Download, Layers, Lock, LockOpen, Save, Trash2, Upload, Wand2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { del, get, post, put, upload } from '@/lib/api';
import { cx } from '@/lib/format';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, confirm, EmptyState, Field, FileButton, IconButton, Input, Select, Slider, Tabs } from '@/ui';
import { DollView } from './DollView';

interface Row { id: string; characterId: string | null; kind: 'story' | 'npc'; sheet: TraitSheet }
interface TemplateRow { id: string; name: string; category: string; rating: string; supports: { wardrobe?: Record<string, string[]>; expressions?: string[] }; options: Array<{ id: string; label: string; values: Array<{ id: string; label: string }> }>; slots: Array<{ id: string; sex: string[] }>; base: string }
interface Character { id: string; name: string }

const LOCKS = [['hair', 'Hair'], ['face', 'Face'], ['body', 'Body'], ['wardrobe', 'Clothes'], ['name', 'Name']] as const;
const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function Chips<T extends string>({ value, options, onChange, name }: { value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (v: T) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={cx('pressable rounded-full border px-3 py-1.5 text-sm', value === o.id ? 'border-accent bg-accent/15 text-fg' : 'border-line bg-surface text-fg-2')}>{o.label}</button>
      ))}
    </div>
  );
}

function Swatches({ value, palette, onChange, name }: { value: string; palette: readonly string[]; onChange: (v: string) => void; name: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={name}>
      {palette.map((c) => <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c} aria-label={c} onClick={() => onChange(c)} className={cx('size-8 rounded-full border-2', value.toLowerCase() === c ? 'border-accent' : 'border-line')} style={{ background: c }} />)}
      <input type="color" aria-label={`${name}: any colour`} value={value} onChange={(e) => onChange(e.target.value)} className="size-8 rounded-full border border-line bg-transparent" />
    </div>
  );
}

export default function LooksPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const [view, setView] = useState<'characters' | 'templates'>('characters');
  const list = useQuery({ queryKey: ['paperdoll', 'characters', page], queryFn: () => get<{ items: Row[]; page: number; pages: number; total: number }>('/api/paperdoll/characters', { page, perPage: 13 }) });
  const templates = useQuery({ queryKey: ['paperdoll', 'templates'], queryFn: () => get<TemplateRow[]>('/api/paperdoll/templates') });
  const characters = useQuery({ queryKey: ['characters', 'mini'], queryFn: () => get<Character[]>('/api/characters') });
  const [sel, setSel] = useState<Row | null>(null);
  const [draft, setDraft] = useState<TraitSheet | null>(null);
  const [tab, setTab] = useState('body');
  const [tIndex, setTIndex] = useState(0);
  const [expression, setExpression] = useState<string | undefined>();
  const [locks, setLocks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /** A filled look whose card gave no age: it can't be saved until the owner enters one. */
  const [needsAge, setNeedsAge] = useState(false);
  const [linkTo, setLinkTo] = useState<string | null>(null);
  const touch = useRef<number | null>(null);

  const usable = useMemo(() => (templates.data ?? []).filter((t) => !draft || t.slots.some((s) => s.sex.includes(draft.sex))), [templates.data, draft]);
  const tpl = usable.length ? usable[((tIndex % usable.length) + usable.length) % usable.length] : null;
  const wardrobeOptions = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const t of templates.data ?? []) for (const [slot, items] of Object.entries(t.supports.wardrobe ?? {})) for (const i of items) (m[slot] ??= new Set()).add(i);
    return m;
  }, [templates.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['paperdoll', 'characters'] });
  const open = (r: Row) => { setSel(r); setDraft(r.sheet); setExpression(undefined); setNeedsAge(false); setLinkTo(null); };
  const edit = (f: (s: TraitSheet) => TraitSheet) => setDraft((d) => (d && !d.locked ? f(structuredClone(d)) : d));
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const r = sel ? await put<Row>(`/api/paperdoll/characters/${sel.id}`, { sheet: draft }) : await post<Row>('/api/paperdoll/characters', { sheet: draft, characterId: linkTo });
      setSel(r); setDraft(r.sheet); setLinkTo(null); await refresh();
      toast({ title: 'Saved', tone: 'success' });
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const roll = async () => {
    try { setDraft(await post<TraitSheet>('/api/paperdoll/roll', { base: draft ?? undefined, locks: draft ? locks : [] })); } catch (e) { toastError(e); }
  };
  const newNpc = async () => { setSel(null); setLocks([]); setNeedsAge(false); setLinkTo(null); try { setDraft(await post<TraitSheet>('/api/paperdoll/roll', {})); } catch (e) { toastError(e); } };
  const fill = async (characterId: string) => {
    setBusy(true);
    try {
      const { sheet, ageStated } = await post<{ sheet: TraitSheet; ageStated: boolean }>(`/api/paperdoll/fill/${characterId}`);
      if (!ageStated) {
        // No age in the card: never assumed; the owner enters it, then saves.
        setSel(null); setLinkTo(characterId); setDraft(sheet); setNeedsAge(true);
        toast({ title: 'Enter their age', lines: ['The description gives no age. Enter it (18 or over) before saving.'], tone: 'neutral' });
        return;
      }
      const r = await post<Row>('/api/paperdoll/characters', { characterId, sheet });
      open(r); await refresh();
      toast({ title: 'Filled from the description', lines: ['Check it over, then lock the final design.'], tone: 'success' });
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const exportJson = () => {
    if (!draft) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 1)], { type: 'application/json' }));
    a.download = `${draft.name.replace(/[^\w-]+/g, '_')}.look.json`;
    a.click();
  };
  const importJson = async (files: File[]) => {
    try { const s = TraitSheetSchema.parse(JSON.parse(await files[0]!.text())); setSel(null); setDraft({ ...s, locked: false }); } catch (e) { toastError(e); }
  };

  return (
    <div className="mx-auto flex h-dvh max-w-5xl flex-col gap-3 overflow-y-auto p-3" data-testid="looks-page">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">Character Studio looks</h1>
        <Tabs tabs={[{ value: 'characters', label: 'Characters' }, { value: 'templates', label: 'Templates' }]} value={view} onChange={(v) => setView(v as 'characters' | 'templates')} className="ml-auto" />
      </div>

      {view === 'templates' ? (
        <div className="flex flex-col gap-3" data-testid="looks-templates">
          <p className="text-sm text-fg-2">Pose and scene templates from packs. Each draws every character with the same traits, so a look stays identical across poses. Templates are made with tools/studio (docs/character-studio/).</p>
          <FileButton variant="secondary" icon={Upload} accept=".zip,application/zip" onFiles={async (fs) => { try { await upload('/api/paperdoll/templates/import', fs[0]!); await qc.invalidateQueries({ queryKey: ['paperdoll', 'templates'] }); toast({ title: 'Templates installed', tone: 'success' }); } catch (e) { toastError(e); } }}>Install a template pack</FileButton>
          {(templates.data ?? []).map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-line p-3">
              <Layers className="size-4 text-fg-3" />
              <div className="min-w-0 flex-1"><div className="font-medium">{t.name}</div><div className="text-xs text-fg-2">{label(t.category)} · {t.slots.length} character{t.slots.length > 1 ? 's' : ''} · {t.slots.flatMap((s) => s.sex).join('/')}{t.options.length ? ` · options: ${t.options.map((o) => o.label).join(', ')}` : ''}</div></div>
              {t.rating === '18+' ? <Badge tone="warning">18+</Badge> : null}
              <IconButton icon={Trash2} label={`Remove ${t.name}`} onClick={async () => { if (await confirm({ title: `Remove ${t.name}?`, danger: true, confirmLabel: 'Remove' })) { await del(`/api/paperdoll/templates/${t.id}`); await qc.invalidateQueries({ queryKey: ['paperdoll', 'templates'] }); } }} />
            </div>
          ))}
          {!templates.data?.length ? <EmptyState icon={Layers} title="No templates yet" body="Install a template pack (all-ages or 18+) to draw characters." /> : null}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-[18rem_1fr]">
          {/* The list: id, name, sex, with paging (13 a page). */}
          <div className="flex flex-col gap-2" data-testid="looks-list">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={Dices} onClick={newNpc}>Random NPC</Button>
              <Select aria-label="Fill from a character" value="" onChange={(e) => e.target.value && void fill(e.target.value)} className="w-auto flex-1" disabled={busy}>
                <option value="">From a character…</option>
                {(characters.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <FileButton size="sm" variant="ghost" icon={Upload} accept=".json,application/json" onFiles={importJson}>Import</FileButton>
            </div>
            <div className="rounded-lg border border-line">
              <div className="grid grid-cols-[3rem_1fr_2rem] bg-surface-2 px-3 py-2 text-xs font-medium text-fg-2"><span>ID</span><span>Name</span><span>Sex</span></div>
              {(list.data?.items ?? []).map((r, i) => (
                <button key={r.id} type="button" onClick={() => open(r)} className={cx('grid w-full grid-cols-[3rem_1fr_2rem] px-3 py-2 text-left text-sm', sel?.id === r.id ? 'bg-accent/15' : 'hover:bg-surface-2')}>
                  <span className="text-fg-3">{String(page * 13 + i + 1).padStart(3, '0')}</span><span className="truncate">{r.sheet.name}{r.kind === 'story' ? ' ·' : ''}</span><span>{r.sheet.sex === 'female' ? 'F' : 'M'}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-center gap-3">
              <IconButton icon={ChevronLeft} label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)} />
              <span className="text-sm">{(list.data?.page ?? 0) + 1}/{list.data?.pages ?? 1}</span>
              <IconButton icon={ChevronRight} label="Next page" disabled={page + 1 >= (list.data?.pages ?? 1)} onClick={() => setPage(page + 1)} />
            </div>
          </div>

          {draft ? (
            <div className="flex flex-col gap-3" data-testid="looks-editor">
              <div className="flex items-center gap-2">
                <Input aria-label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="flex-1" />
                <Badge>{draft.sex === 'female' ? 'F' : 'M'}</Badge>
                <Input aria-label="Age" type="number" min={18} max={200} value={needsAge ? '' : draft.age} placeholder="Age" invalid={needsAge}
                  onChange={(e) => { const v = Number(e.target.value); if (v >= 18) { setNeedsAge(false); edit((s) => { s.age = v; return s; }); } }} className="w-20" />
              </div>
              {/* Preview: swipe (or the arrows) between templates. */}
              <div className="relative h-[52dvh] rounded-xl bg-surface-2" onTouchStart={(e) => (touch.current = e.touches[0]!.clientX)} onTouchEnd={(e) => { const s = touch.current; touch.current = null; if (s === null) return; const dx = e.changedTouches[0]!.clientX - s; if (Math.abs(dx) > 40) setTIndex((i) => i + (dx < 0 ? 1 : -1)); }}>
                {tpl ? <DollView base={tpl.base} cast={[draft]} state={{ expression }} className="h-full w-full" testId="looks-preview" /> : <EmptyState icon={Layers} title="No template for this character" body="Install a template pack under Templates." />}
                {usable.length > 1 ? (<>
                  <IconButton icon={ChevronLeft} label="Previous template" className="absolute left-1 top-1/2" onClick={() => setTIndex(tIndex - 1)} />
                  <IconButton icon={ChevronRight} label="Next template" className="absolute right-1 top-1/2" onClick={() => setTIndex(tIndex + 1)} />
                </>) : null}
                {tpl ? <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-surface/80 px-2 text-xs" data-testid="looks-template-name">{tpl.name}</span> : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={Dices} onClick={roll} disabled={draft.locked}>Randomize</Button>
                {LOCKS.map(([k, l]) => <Button key={k} size="sm" variant={locks.includes(k) ? 'primary' : 'ghost'} aria-pressed={locks.includes(k)} onClick={() => setLocks(locks.includes(k) ? locks.filter((x) => x !== k) : [...locks, k])}>Keep {l.toLowerCase()}</Button>)}
              </div>
              <Tabs tabs={['body', 'face', 'hair', 'clothing', 'expressions'].map((v) => ({ value: v, label: label(v) }))} value={tab} onChange={setTab} />
              <fieldset disabled={draft.locked} className="flex flex-col gap-3">
                {tab === 'body' ? (<>
                  <Field label="Body type"><Chips name="Body type" value={draft.body.type} options={CATALOG.bodyType} onChange={(v) => edit((s) => { s.body.type = v; return s; })} /></Field>
                  {draft.sex === 'female' ? <Field label="Breast size"><Chips name="Breast size" value={draft.body.breast} options={CATALOG.size} onChange={(v) => edit((s) => { s.body.breast = v; return s; })} /></Field> : null}
                  <Field label="Hips"><Chips name="Hips" value={draft.body.hips} options={CATALOG.size} onChange={(v) => edit((s) => { s.body.hips = v; return s; })} /></Field>
                  <Field label="Skin"><Swatches name="Skin" value={draft.body.skin} palette={PALETTES.skin} onChange={(v) => edit((s) => { s.body.skin = v; return s; })} /></Field>
                  {SLIDERS.filter((k) => draft.sex === 'female' || k !== 'breast').map((k) => <Slider key={k} label={`Fine: ${k}`} min={-1} max={1} step={0.05} value={draft.body.sliders[k]} onChange={(v) => edit((s) => { s.body.sliders[k] = v; return s; })} />)}
                </>) : null}
                {tab === 'face' ? (<>
                  <Field label="Face"><Chips name="Face" value={draft.face.preset} options={CATALOG.facePreset} onChange={(v) => edit((s) => { s.face.preset = v; return s; })} /></Field>
                  <Field label="Eyes"><Swatches name="Eye colour" value={draft.face.eyeColor} palette={PALETTES.eyes} onChange={(v) => edit((s) => { s.face.eyeColor = v; return s; })} /></Field>
                  <Field label="Makeup"><Chips name="Makeup" value={draft.face.makeup} options={[{ id: 'none', label: 'None' }, { id: 'light', label: 'Light' }, { id: 'bold', label: 'Bold' }] as const} onChange={(v) => edit((s) => { s.face.makeup = v; return s; })} /></Field>
                </>) : null}
                {tab === 'hair' ? (<>
                  <Field label="Back"><Chips name="Hairstyle" value={draft.hair.back} options={CATALOG.hairBack} onChange={(v) => edit((s) => { s.hair.back = v; return s; })} /></Field>
                  <Field label="Front"><Chips name="Bangs" value={draft.hair.front} options={CATALOG.hairFront} onChange={(v) => edit((s) => { s.hair.front = v; return s; })} /></Field>
                  <Field label="Colour"><Swatches name="Hair colour" value={draft.hair.color} palette={PALETTES.hair} onChange={(v) => edit((s) => { s.hair.color = v; return s; })} /></Field>
                </>) : null}
                {tab === 'clothing' ? WARDROBE_SLOTS.filter((sl) => draft.sex === 'female' || sl !== 'bra').map((sl) => (
                  <Field key={sl} label={label(sl)}>
                    <Select aria-label={label(sl)} value={draft.wardrobe[sl] ?? ''} onChange={(e) => edit((s) => { s.wardrobe[sl] = e.target.value || null; return s; })}>
                      <option value="">Nothing</option>
                      {[...(wardrobeOptions[sl] ?? [])].map((i) => <option key={i} value={i}>{label(i)}</option>)}
                    </Select>
                  </Field>
                )) : null}
                {tab === 'expressions' ? <Chips name="Expression" value={(expression ?? draft.expressions[0]) as never} options={CATALOG.expression} onChange={(v) => setExpression(v)} /> : null}
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <Button icon={Save} loading={busy} onClick={save} disabled={needsAge} title={needsAge ? 'Enter the age first (18 or over)' : undefined}>Save</Button>
                <Button variant="secondary" icon={draft.locked ? Lock : LockOpen} aria-pressed={draft.locked} onClick={() => setDraft({ ...draft, locked: !draft.locked })}>{draft.locked ? 'Final design (locked)' : 'Lock final design'}</Button>
                <Button variant="ghost" icon={Copy} onClick={() => { setSel(null); setDraft({ ...draft, name: `${draft.name} (copy)`, locked: false }); }}>Duplicate</Button>
                <Button variant="ghost" icon={Download} onClick={exportJson}>Export</Button>
                {sel ? <Button variant="ghost" icon={Trash2} onClick={async () => { if (await confirm({ title: `Delete ${draft.name}?`, danger: true, confirmLabel: 'Delete' })) { await del(`/api/paperdoll/characters/${sel.id}`); setSel(null); setDraft(null); await refresh(); } }}>Delete</Button> : null}
              </div>
            </div>
          ) : <EmptyState icon={Wand2} title="Pick or make a character" body="Roll a random NPC, fill a look from one of your characters, or import one." />}
        </div>
      )}
    </div>
  );
}

