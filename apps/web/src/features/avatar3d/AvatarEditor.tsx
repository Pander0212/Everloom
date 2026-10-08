/**
 * The avatar import wizard and editor: check the model moves right, fix bone and face mapping,
 * set size, floor, facing and look, optimize again, and name it and give it a picture.
 * The preview sits on top on phones and on the left on wider screens; changes are kept in a draft
 * until saved.
 */
import { AvatarConfigSchema, type AvatarConfig } from '@everloom/engine';
import { ArrowLeft, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Page } from '@/app/Shell';
import { deleteAvatar, reprocessAvatar, saveAvatar, useAvatar } from '@/features/avatars/api';
import CodeMadeEditor from './CodeMadeEditor';
import Maker from './Maker';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, confirm, EmptyState, FileButton, IconButton, Menu, Segmented, Select, Spinner, Switch, TabPanel, Tabs, useDesktop } from '@/ui';
import { BonesStep } from './editor/BonesStep';
import { CheckStep } from './editor/CheckStep';
import { DetailsStep } from './editor/DetailsStep';
import { FaceStep } from './editor/FaceStep';
import { FitStep } from './editor/FitStep';
import { OptimizeStep } from './editor/OptimizeStep';
import { WardrobeStep } from './editor/WardrobeStep';
import Preview3D, { type PreviewHandle } from './Preview3D';
import type { Framing } from './runtime/stage';
import { HumanControls, useHumanLibrary } from './NativeHuman';
import { ContentStep } from './editor/ContentStep';
import { ExportStep } from './editor/ExportStep';
import { api } from '@/lib/api';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildHuman } from './runtime/makehuman';
import { configureMaterials } from './runtime/materials';
import { MaterialsStep } from './editor/MaterialsStep';
import { BodyStep } from './editor/BodyStep';
import { SkinStep } from './editor/SkinStep';
import { disposeScene } from './runtime/loader';
import { downloadPreset, readPreset } from './editor/presets';
import { PRESETS, type LightingPreset } from './runtime/lighting';

const STEPS = [
  { value: 'body', label: 'Body' },
  { value: 'skin', label: 'Skin' },
  { value: 'check', label: 'Check' },
  { value: 'bones', label: 'Bones' },
  { value: 'face', label: 'Face' },
  { value: 'fit', label: 'Fit' },
  { value: 'wardrobe', label: 'Wardrobe' },
  { value: 'materials', label: 'Materials' },
  { value: 'optimize', label: 'Optimize' },
  { value: 'details', label: 'Details' },
  { value: 'content', label: 'Content' },
  { value: 'export', label: 'Export' },
];

/** Code-made avatars have their own editor (a recipe, no model file). */
export default function AvatarEditor() {
  const { id } = useParams();
  const q = useAvatar(id);
  if (q.data?.kind === 'code') return <CodeMadeEditor key={q.data.id} avatar={q.data} />;
  if (q.data?.kind === 'parts' && q.data.config.maker) return <Maker key={q.data.id} avatar={q.data} />;
  return <ImportedEditor />;
}

function ImportedEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const desktop = useDesktop();
  const q = useAvatar(id);
  const a = q.data;
  const humans = useHumanLibrary(!!a?.config.makehuman);
  const [draft, setDraft] = useState<AvatarConfig | null>(null);
  const [name, setName] = useState('');
  const [step, setStep] = useState('check');
  const [framing, setFraming] = useState<Framing>('full');
  const [lighting, setLighting] = useState<LightingPreset['id']>('studio');
  const [handle, setHandle] = useState<PreviewHandle | null>(null);
  const [saving, setSaving] = useState(false);
  const [tryOn, setTryOn] = useState<string | null>(null);
  const [autosave, setAutosave] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const past = useRef<AvatarConfig[]>([]), future = useRef<AvatarConfig[]>([]);
  const loadedFor = useRef<string | null>(null);

  // Start the draft from what's saved (and again after processing finishes).
  useEffect(() => {
    if (!a || a.status !== 'ready') return;
    const stamp = `${a.id}:${a.updatedAt}`;
    if (loadedFor.current === stamp && draft) return;
    if (!loadedFor.current?.startsWith(`${a.id}:`) || !draft) {
      setDraft(a.config);
      setName(a.name);
    }
    loadedFor.current = stamp;
  }, [a]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => !!a && !!draft && (JSON.stringify(draft) !== JSON.stringify(a.config) || name !== a.name), [a, draft, name]);
  const set = (patch: Partial<AvatarConfig>) => {
    if (!draft) return;
    past.current = [...past.current.slice(-49), draft]; future.current = [];
    setSaveError(null); setDraft({ ...draft, ...patch });
  };
  const undo = () => { const previous = past.current.pop(); if (!previous || !draft) return; future.current.push(draft); setSaveError(null); setDraft(previous); };
  const redo = () => { const next = future.current.pop(); if (!next || !draft) return; past.current.push(draft); setSaveError(null); setDraft(next); };

  const save = async (automatic = false) => {
    if (!a || !draft) return;
    setSaving(true); setSaveError(null);
    try {
      if (draft.makehuman && JSON.stringify([draft.makehuman, draft.materialOverrides, draft.content]) !== JSON.stringify([a.config.makehuman, a.config.materialOverrides, a.config.content])) {
        const scene = await buildHuman(draft.makehuman, undefined, draft.content);
        try {
          await configureMaterials(scene, draft.materialOverrides);
          scene.userData.everloom = { config: draft };
          const bytes = await new GLTFExporter().parseAsync(scene, { binary: true });
          await api(`/api/avatars/${a.id}/native-model`, { method: 'PUT', raw: bytes as ArrayBuffer });
        } finally { disposeScene(scene); }
      }
      const r = await saveAvatar(a.id, { name, config: draft });
      loadedFor.current = `${r.id}:${r.updatedAt}`;
      setDraft(current => JSON.stringify(current) === JSON.stringify(draft) ? r.config : current);
      if (!automatic) toast({ title: 'Saved', tone: 'success' });
    } catch (e) {
      setSaveError((e as Error).message);
      if (!automatic) toastError(e);
    } finally {
      setSaving(false);
    }
  };
  const saveCurrent = useRef(save); saveCurrent.current = save;
  useEffect(() => {
    if (!autosave || !dirty || saving || saveError || a?.processingStage) return;
    const timer = setTimeout(() => void saveCurrent.current(true), 3000);
    return () => clearTimeout(timer);
  }, [autosave, dirty, draft, name, saving, saveError, a?.processingStage]);

  const remove = async () => {
    if (!a) return;
    if (!(await confirm({ title: `Delete ${a.name}?`, description: 'The model, its optimized copies and its settings are removed. Characters using it go back to their pictures.', confirmLabel: 'Delete', danger: true }))) return;
    await deleteAvatar(a.id);
    navigate('/characters/avatars');
  };

  const back = <IconButton icon={ArrowLeft} label="All avatars" onClick={() => navigate('/characters/avatars')} />;
  if (q.isLoading) return <Page title="Avatar" back={back}><div className="grid min-h-[40vh] place-items-center"><Spinner /></div></Page>;
  if (!a) return <Page title="Avatar" back={back}><EmptyState title="This avatar is gone" body="It may have been deleted." /></Page>;

  if (a.status !== 'ready' || !draft) {
    return (
      <Page title={a.name} back={back}>
        {a.status === 'failed' ? (
          <EmptyState
            title="This model couldn't be prepared"
            body={a.error ?? 'Something went wrong while reading it.'}
            action={
              <div className="flex gap-2">
                <Button variant="secondary" icon={RotateCcw} onClick={() => void reprocessAvatar(a.id, {}).catch(toastError)}>
                  Try again
                </Button>
                <Button variant="danger" icon={Trash2} onClick={remove}>
                  Delete
                </Button>
                <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(JSON.stringify({ id: a.id, status: a.status, format: a.format, error: a.error, info: a.info }, null, 2)).catch(toastError)}>Copy details</Button>
              </div>
            }
          />
        ) : (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center" data-testid="avatar-processing">
            <Spinner />
            <p className="font-medium" role="status">{a.processingStage ?? 'Preparing the model…'}</p>
            <p className="max-w-sm text-sm text-fg-2">Reading the skeleton and face, compressing textures and making a lighter copy for phones. Big models can take a minute.</p>
          </div>
        )}
      </Page>
    );
  }

  const preview = (
    <Preview3D src={a.model} fallbackSrc={a.info.conversion ? null : a.source} config={draft} tryOn={{ outfit: tryOn }} framing={framing} lighting={lighting} inspect className={desktop ? 'h-[calc(100dvh-180px)]' : 'h-[36dvh]'} onLoaded={setHandle}>
      <div className="absolute inset-x-2 top-2 flex justify-center">
        <Segmented size="sm" label="Framing" value={framing} onChange={(v) => setFraming(v)} options={[{ value: 'portrait', label: 'Face' }, { value: 'half', label: 'Half' }, { value: 'full', label: 'Full' }]} className="bg-surface/80 backdrop-blur" />
      </div>
      <Select aria-label="Portrait lighting" className="absolute bottom-2 left-2 w-32 bg-surface/90" value={lighting} onChange={event => setLighting(event.target.value as LightingPreset['id'])}>{Object.keys(PRESETS).map(id => <option key={id} value={id}>{id[0].toUpperCase() + id.slice(1)}</option>)}</Select>
    </Preview3D>
  );

  return (
    <Page
      title={
        <span className="flex items-center gap-2">
          {name || a.name}
          <Badge>{a.format === 'glb' ? 'GLB' : a.format === 'vrm0' ? 'VRM 0.x' : a.format === 'vrm1' ? 'VRM 1.0' : a.format.toUpperCase()}</Badge>
        </span>
      }
      back={back}
      actions={
        <>
          <Button onClick={() => void save()} loading={saving} disabled={!dirty} data-testid="avatar-save">
            Save
          </Button>
          <Menu trigger={<IconButton icon={MoreHorizontal} label="More" />} items={[{ label: 'Delete avatar', icon: Trash2, onSelect: remove, danger: true }]} />
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={!past.current.length || saving} onClick={undo}>Undo</Button>
        <Button size="sm" variant="secondary" disabled={!future.current.length || saving} onClick={redo}>Redo</Button>
        <Switch checked={autosave} onChange={setAutosave} label="Autosave" /><span className="text-xs text-fg-2">{saving ? 'Saving…' : saveError ? 'Changes need saving' : dirty ? 'Unsaved changes' : 'Saved'}</span>
        <Button size="sm" variant="secondary" onClick={() => void downloadPreset(a.id, draft, 'character').catch(toastError)}>Save preset</Button>
        <FileButton size="sm" variant="secondary" onFiles={async ([file]) => {
          if (!file) return;
          try {
            const preset = await readPreset(a.id, file);
            if (preset.format !== 'everloom-character-preset' || preset.version !== 1) throw new Error('Choose an Everloom character preset.');
            if (preset.family !== draft.family) throw new Error('Choose a preset for the same body family.');
            const config = AvatarConfigSchema.parse(preset.config);
            if (!!config.makehuman !== !!draft.makehuman) throw new Error('This preset uses a different character kind.');
            set(config);
          } catch (error) { toastError(error); }
        }}>Apply preset</FileButton>
      </div>
      {saveError ? <p role="alert" className="mb-3 text-sm text-danger">Autosave paused: {saveError}. Correct the settings, or press Save to retry.</p> : null}
      <div className={desktop ? 'grid grid-cols-[minmax(0,1.1fr)_minmax(340px,1fr)] gap-6' : 'flex flex-col gap-3'}>
        <div className={desktop ? 'sticky top-[68px] self-start' : 'sticky top-[60px] z-10 -mx-4 bg-bg px-4 pb-1'}>{preview}</div>
        <Tabs tabs={STEPS} value={step} onChange={setStep}>
          <div className="pt-4">
            <TabPanel value="body">
              {draft.makehuman && humans.data ? <HumanControls content={draft.content} profile={draft.makehuman} set={makehuman => set({ makehuman, ...(makehuman.rig !== draft.makehuman?.rig ? { boneMap: {} } : {}) })} library={humans.data} /> : <BodyStep config={draft} set={set} handle={handle} />}
            </TabPanel>
            <TabPanel value="skin"><SkinStep config={draft} set={set} handle={handle} /></TabPanel>
            <TabPanel value="check">
              <CheckStep avatar={a} handle={handle} />
            </TabPanel>
            <TabPanel value="bones">
              <BonesStep avatar={a} config={draft} set={set} handle={handle} />
            </TabPanel>
            <TabPanel value="face">
              <FaceStep avatar={a} config={draft} set={set} handle={handle} />
            </TabPanel>
            <TabPanel value="fit">
              <FitStep config={draft} set={set} handle={handle} />
            </TabPanel>
            <TabPanel value="wardrobe">
              <WardrobeStep avatar={a} config={draft} set={set} tryOn={tryOn} setTryOn={setTryOn} handle={handle} />
            </TabPanel>
            <TabPanel value="materials"><MaterialsStep config={draft} set={set} handle={handle} /></TabPanel>
            <TabPanel value="optimize">
              <OptimizeStep avatar={a} />
            </TabPanel>
            <TabPanel value="details">
              <DetailsStep avatar={a} name={name} setName={setName} handle={handle} />
            </TabPanel>
            <TabPanel value="content"><ContentStep config={draft} set={set} /></TabPanel>
            <TabPanel value="export"><ExportStep avatar={a} config={draft} handle={handle} /></TabPanel>
          </div>
        </Tabs>
      </div>
    </Page>
  );
}
