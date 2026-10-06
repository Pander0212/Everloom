/**
 * The editor for a code-made character: body, face, hair and clothes as plain choices, rebuilt
 * live in the preview. "Fill from a character" asks the utility model for a look that matches a
 * character's description (or works it out from the text when no model is set up).
 */
import { AGE_STAGES, AvatarRecipeSchema, BOTTOMS, EXTRAS, HAIR_STYLES, HATS, PATTERNS, SHOES, TOPS, type AvatarRecipe } from '@everloom/engine';
import { ArrowLeft, MoreHorizontal, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/app/Shell';
import { deleteAvatar, fillRecipe, saveAvatar, setAvatarThumbnail, type AvatarDetail } from '@/features/avatars/api';
import { useCharacters } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, confirm, Field, IconButton, Menu, Segmented, Select, Slider, TabPanel, Tabs, ToggleRow, useDesktop } from '@/ui';
import { DetailsStep } from './editor/DetailsStep';
import Preview3D, { type PreviewHandle } from './Preview3D';
import { captureThumbnail } from './runtime/thumbnail';

const TABS = [
  { value: 'body', label: 'Body' },
  { value: 'face', label: 'Face & hair' },
  { value: 'clothes', label: 'Clothes' },
  { value: 'extras', label: 'Extras' },
  { value: 'details', label: 'Details' },
];

const SKINS = ['#f6d7c3', '#eec1a1', '#e0ac8a', '#c98e6b', '#a8704f', '#8a5a3c', '#6b4329', '#4d2f1d'];
const HEIGHTS: Record<AvatarRecipe['body']['age'], [number, number]> = { child: [0.9, 1.5], teen: [1.4, 1.9], adult: [1.45, 2.1], elder: [1.4, 1.95] };
const label = (s: string) => (s === 'tshirt' ? 'T-shirt' : s === 'long_skirt' ? 'Long skirt' : s[0]!.toUpperCase() + s.slice(1));

function Colour({ value, onChange, name, swatches }: { value: string; onChange: (v: string) => void; name: string; swatches?: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {swatches?.map((s) => (
        <button key={s} type="button" aria-label={`${name} ${s}`} aria-pressed={value === s} onClick={() => onChange(s)} className="pressable h-8 w-8 rounded-full border-2" style={{ background: s, borderColor: value === s ? 'var(--accent)' : 'var(--line)' }} />
      ))}
      <input type="color" aria-label={name} value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent" />
    </div>
  );
}

function Options<T extends string>({ id, value, options, onChange }: { id: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o === 'none' ? 'None' : label(o)}
        </option>
      ))}
    </Select>
  );
}

export default function CodeMadeEditor({ avatar }: { avatar: AvatarDetail }) {
  const navigate = useNavigate();
  const desktop = useDesktop();
  const chars = useCharacters();
  const [recipe, setRecipe] = useState<AvatarRecipe>(() => AvatarRecipeSchema.parse(avatar.config.recipe ?? {}));
  const [name, setName] = useState(avatar.name);
  const [tab, setTab] = useState('body');
  const [handle, setHandle] = useState<PreviewHandle | null>(null);
  const [saving, setSaving] = useState(false);
  const [filling, setFilling] = useState(false);
  const [from, setFrom] = useState('');
  // The preview rebuilds a moment after the last change (dragging a slider doesn't rebuild every step).
  const [shown, setShown] = useState(recipe);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    timer.current = setTimeout(() => setShown(recipe), 300);
    return () => clearTimeout(timer.current!);
  }, [recipe]);

  const saved = useMemo(() => JSON.stringify(AvatarRecipeSchema.parse(avatar.config.recipe ?? {})), [avatar.config.recipe]);
  const dirty = JSON.stringify(recipe) !== saved || name !== avatar.name;
  const set = <K extends keyof AvatarRecipe>(k: K, patch: Partial<AvatarRecipe[K]>) => setRecipe((r) => ({ ...r, [k]: { ...(r[k] as object), ...patch } }));

  const save = async () => {
    setSaving(true);
    try {
      await saveAvatar(avatar.id, { name, config: { ...avatar.config, recipe } });
      // A fresh picture for the library.
      if (handle && JSON.stringify(shown) === JSON.stringify(recipe)) await setAvatarThumbnail(avatar.id, await captureThumbnail(handle.stage)).catch(() => undefined);
      toast({ title: 'Saved', tone: 'success' });
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

  const fill = async () => {
    if (!from) return;
    setFilling(true);
    try {
      const r = await fillRecipe({ characterId: from });
      setRecipe(r.recipe);
      toast({ title: r.source === 'model' ? 'Look filled in by the model' : 'Look worked out from the description', lines: r.source === 'model' ? undefined : ['Set up a utility model for a closer match.'], tone: 'success' });
    } catch (e) {
      toastError(e);
    } finally {
      setFilling(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: `Delete ${avatar.name}?`, description: 'Characters using it go back to their pictures (or an automatic figure).', confirmLabel: 'Delete', danger: true }))) return;
    await deleteAvatar(avatar.id);
    navigate('/characters/avatars');
  };

  const b = recipe.body;
  const [hMin, hMax] = HEIGHTS[b.age];
  const preview = <Preview3D src={null} recipe={shown} config={{ look: 'toon', outlines: true }} className={desktop ? 'h-[70vh]' : 'h-[36dvh]'} onLoaded={setHandle} />;
  const extraOn = (k: (typeof EXTRAS)[number]) => recipe.extras.find((e) => e.kind === k);
  return (
    <Page
      title={
        <span className="flex items-center gap-2">
          {name || avatar.name}
          <Badge>Code-made</Badge>
        </span>
      }
      back={<IconButton icon={ArrowLeft} label="All avatars" onClick={() => navigate('/characters/avatars')} />}
      actions={
        <>
          <Button onClick={save} loading={saving} disabled={!dirty} data-testid="avatar-save">
            Save
          </Button>
          <Menu trigger={<IconButton icon={MoreHorizontal} label="More" />} items={[{ label: 'Delete', icon: Trash2, onSelect: remove, danger: true }]} />
        </>
      }
    >
      <div className={desktop ? 'grid grid-cols-[minmax(0,1.1fr)_minmax(340px,1fr)] gap-6' : 'flex flex-col gap-3'}>
        <div className={desktop ? 'sticky top-[68px] self-start' : 'sticky top-[60px] z-10 -mx-4 bg-bg px-4 pb-1'}>{preview}</div>
        <Tabs tabs={TABS} value={tab} onChange={setTab}>
          <div className="grid gap-4 pt-4">
            <TabPanel value="body">
              <div className="grid gap-4">
                <Field label="Age">
                  <Segmented label="Age" options={AGE_STAGES.map((a) => ({ value: a, label: label(a) }))} value={b.age} onChange={(age) => set('body', { age, height: Math.min(HEIGHTS[age][1], Math.max(HEIGHTS[age][0], b.height)), ...(age === 'child' ? { chest: 0 } : {}) })} />
                </Field>
                <Field label={`Height · ${b.height.toFixed(2)} m`}>
                  <Slider label="Height" min={hMin} max={hMax} step={0.01} value={b.height} onChange={(height) => set('body', { height })} />
                </Field>
                <Field label="Build" hint="Slender to heavy.">
                  <Slider label="Build" min={0} max={1} step={0.05} value={b.build} onChange={(build) => set('body', { build })} />
                </Field>
                <Field label="Frame" hint="Wider hips to broader shoulders.">
                  <Slider label="Frame" min={0} max={1} step={0.05} value={b.frame} onChange={(frame) => set('body', { frame })} />
                </Field>
                {b.age !== 'child' ? (
                  <Field label="Chest">
                    <Slider label="Chest" min={0} max={1} step={0.05} value={b.chest} onChange={(chest) => set('body', { chest })} />
                  </Field>
                ) : null}
                <Field label="Skin">
                  <Colour name="Skin" value={b.skin} swatches={SKINS} onChange={(skin) => set('body', { skin })} />
                </Field>
              </div>
            </TabPanel>
            <TabPanel value="face">
              <div className="grid gap-4">
                <Field label="Eyes">
                  <Colour name="Eye colour" value={recipe.face.eyes} onChange={(eyes) => set('face', { eyes })} />
                </Field>
                <Field label="Eye size">
                  <Slider label="Eye size" min={0} max={1} step={0.05} value={recipe.face.eyeSize} onChange={(eyeSize) => set('face', { eyeSize })} />
                </Field>
                <ToggleRow label="Rosy cheeks" checked={recipe.face.blush} onChange={(blush) => set('face', { blush })} />
                <Field label="Hairstyle" htmlFor="cm-hair">
                  <Options id="cm-hair" value={recipe.hair.style} options={HAIR_STYLES} onChange={(style) => set('hair', { style })} />
                </Field>
                <Field label="Hair colour">
                  <Colour name="Hair colour" value={recipe.hair.color} swatches={['#1d1a19', '#4a3021', '#8a3b22', '#d9b56c', '#ece9e2', '#3b5ba8', '#d37aa0']} onChange={(color) => set('hair', { color })} />
                </Field>
                {recipe.hair.style === 'long' || recipe.hair.style === 'ponytail' || recipe.hair.style === 'twintails' ? (
                  <Field label="Hair length">
                    <Slider label="Hair length" min={0} max={1} step={0.05} value={recipe.hair.length} onChange={(length) => set('hair', { length })} />
                  </Field>
                ) : null}
              </div>
            </TabPanel>
            <TabPanel value="clothes">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Top" htmlFor="cm-top">
                  <Options id="cm-top" value={recipe.top.kind} options={TOPS} onChange={(kind) => set('top', { kind })} />
                </Field>
                <Field label="Top colour">
                  <Colour name="Top colour" value={recipe.top.color} onChange={(color) => set('top', { color })} />
                </Field>
                {recipe.top.kind === 'shirt' ? (
                  <Field label="Sleeves" className="sm:col-span-2">
                    <Slider label="Sleeves" min={0.1} max={1} step={0.05} value={recipe.top.sleeve} onChange={(sleeve) => set('top', { sleeve })} />
                  </Field>
                ) : null}
                {recipe.top.kind !== 'none' && recipe.top.kind !== 'armor' ? (
                  <>
                    <Field label="Top pattern">
                      <Segmented label="Top pattern" size="sm" options={PATTERNS.map((p) => ({ value: p, label: label(p) }))} value={recipe.top.pattern} onChange={(pattern) => set('top', { pattern })} />
                    </Field>
                    <Field label="Fit" hint="Fitted to loose.">
                      <Slider label="Top fit" min={0} max={1} step={0.05} value={recipe.top.looseness} onChange={(looseness) => set('top', { looseness })} />
                    </Field>
                    <div className="sm:col-span-2">
                      <ToggleRow label="Collar" checked={recipe.top.collar || recipe.top.kind === 'jacket' || recipe.top.kind === 'robe'} disabled={recipe.top.kind === 'jacket' || recipe.top.kind === 'robe'} onChange={(collar) => set('top', { collar })} />
                    </div>
                  </>
                ) : null}
                <Field label="Bottom" htmlFor="cm-bottom" hint={recipe.top.kind === 'robe' ? 'A robe brings its own long skirt.' : undefined}>
                  <Options id="cm-bottom" value={recipe.bottom.kind} options={BOTTOMS} onChange={(kind) => set('bottom', { kind, length: kind === 'shorts' ? 0.3 : kind === 'none' ? recipe.bottom.length : Math.max(recipe.bottom.length, 0.6) })} />
                </Field>
                <Field label="Bottom colour">
                  <Colour name="Bottom colour" value={recipe.bottom.color} onChange={(color) => set('bottom', { color })} />
                </Field>
                {recipe.bottom.kind !== 'none' ? (
                  <Field label="Length" className="sm:col-span-2">
                    <Slider label="Length" min={0} max={1} step={0.05} value={recipe.bottom.length} onChange={(length) => set('bottom', { length })} />
                  </Field>
                ) : null}
                {recipe.bottom.kind !== 'none' ? (
                  <Field label="Bottom pattern" className="sm:col-span-2">
                    <Segmented label="Bottom pattern" size="sm" options={PATTERNS.map((p) => ({ value: p, label: label(p) }))} value={recipe.bottom.pattern} onChange={(pattern) => set('bottom', { pattern })} />
                  </Field>
                ) : null}
                <Field label="Shoes" htmlFor="cm-shoes">
                  <Options id="cm-shoes" value={recipe.shoes.kind} options={SHOES} onChange={(kind) => set('shoes', { kind })} />
                </Field>
                <Field label="Shoe colour">
                  <Colour name="Shoe colour" value={recipe.shoes.color} onChange={(color) => set('shoes', { color })} />
                </Field>
                <Field label="Hat" htmlFor="cm-hat">
                  <Options id="cm-hat" value={recipe.hat.kind} options={HATS} onChange={(kind) => set('hat', { kind })} />
                </Field>
                <Field label="Hat colour">
                  <Colour name="Hat colour" value={recipe.hat.color} onChange={(color) => set('hat', { color })} />
                </Field>
              </div>
              <p className="pt-3 text-xs text-fg-2">Everyone wears at least plain underwear; bodies have no anatomical detail.</p>
            </TabPanel>
            <TabPanel value="extras">
              <ul className="grid gap-2">
                {EXTRAS.map((k) => {
                  const on = extraOn(k);
                  return (
                    <li key={k} className="flex items-center justify-between gap-3 rounded-lg border border-line p-2">
                      <ToggleRow label={label(k)} checked={!!on} onChange={(v) => setRecipe((r) => ({ ...r, extras: v ? [...r.extras, { kind: k, color: k === 'glasses' ? '#2a2a2a' : '#7a2a2a' }] : r.extras.filter((e) => e.kind !== k) }))} />
                      {on ? <Colour name={`${label(k)} colour`} value={on.color} onChange={(color) => setRecipe((r) => ({ ...r, extras: r.extras.map((e) => (e.kind === k ? { ...e, color } : e)) }))} /> : null}
                    </li>
                  );
                })}
              </ul>
            </TabPanel>
            <TabPanel value="details">
              <div className="grid gap-5">
                <Field label="Fill in from a character" htmlFor="cm-from" hint="Uses the utility model when one is set up; otherwise the description's words (hair, clothes, colours, age).">
                  <div className="flex gap-2">
                    <Select id="cm-from" value={from} onChange={(e) => setFrom(e.target.value)}>
                      <option value="">Choose a character…</option>
                      {(chars.data ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    <Button icon={Wand2} variant="secondary" onClick={fill} loading={filling} disabled={!from}>
                      Fill
                    </Button>
                  </div>
                </Field>
                <DetailsStep avatar={avatar} name={name} setName={setName} handle={handle} />
              </div>
            </TabPanel>
          </div>
        </Tabs>
      </div>
    </Page>
  );
}
