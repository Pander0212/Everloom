/**
 * The avatar import wizard and editor: check the model moves right, fix bone and face mapping,
 * set size, floor, facing and look, optimize again, and name it and give it a picture.
 * The preview sits on top on phones and on the left on wider screens; changes are kept in a draft
 * until saved.
 */
import { type AvatarConfig } from '@everloom/engine';
import { ArrowLeft, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Page } from '@/app/Shell';
import { deleteAvatar, reprocessAvatar, saveAvatar, useAvatar } from '@/features/avatars/api';
import { toast, toastError } from '@/lib/store';
import { Badge, Button, confirm, EmptyState, IconButton, Menu, Segmented, Spinner, TabPanel, Tabs, useDesktop } from '@/ui';
import { BonesStep } from './editor/BonesStep';
import { CheckStep } from './editor/CheckStep';
import { DetailsStep } from './editor/DetailsStep';
import { FaceStep } from './editor/FaceStep';
import { FitStep } from './editor/FitStep';
import { OptimizeStep } from './editor/OptimizeStep';
import { WardrobeStep } from './editor/WardrobeStep';
import Preview3D, { type PreviewHandle } from './Preview3D';
import type { Framing } from './runtime/stage';

const STEPS = [
  { value: 'check', label: 'Check' },
  { value: 'bones', label: 'Bones' },
  { value: 'face', label: 'Face' },
  { value: 'fit', label: 'Fit' },
  { value: 'wardrobe', label: 'Wardrobe' },
  { value: 'optimize', label: 'Optimize' },
  { value: 'details', label: 'Details' },
];

export default function AvatarEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const desktop = useDesktop();
  const q = useAvatar(id);
  const a = q.data;
  const [draft, setDraft] = useState<AvatarConfig | null>(null);
  const [name, setName] = useState('');
  const [step, setStep] = useState('check');
  const [framing, setFraming] = useState<Framing>('full');
  const [handle, setHandle] = useState<PreviewHandle | null>(null);
  const [saving, setSaving] = useState(false);
  const [tryOn, setTryOn] = useState<string | null>(null);
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
  const set = (patch: Partial<AvatarConfig>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const save = async () => {
    if (!a || !draft) return;
    setSaving(true);
    try {
      const r = await saveAvatar(a.id, { name, config: draft });
      loadedFor.current = `${r.id}:${r.updatedAt}`;
      setDraft(r.config);
      toast({ title: 'Saved', tone: 'success' });
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(false);
    }
  };

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
              </div>
            }
          />
        ) : (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center" data-testid="avatar-processing">
            <Spinner />
            <p className="font-medium">Preparing the model…</p>
            <p className="max-w-sm text-sm text-fg-2">Reading the skeleton and face, compressing textures and making a lighter copy for phones. Big models can take a minute.</p>
          </div>
        )}
      </Page>
    );
  }

  const preview = (
    <Preview3D src={a.model} config={draft} tryOn={{ outfit: tryOn }} framing={framing} inspect className={desktop ? 'h-[calc(100dvh-140px)]' : 'h-[36dvh]'} onLoaded={setHandle}>
      <div className="absolute inset-x-2 top-2 flex justify-center">
        <Segmented size="sm" label="Framing" value={framing} onChange={(v) => setFraming(v)} options={[{ value: 'portrait', label: 'Face' }, { value: 'half', label: 'Half' }, { value: 'full', label: 'Full' }]} className="bg-surface/80 backdrop-blur" />
      </div>
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
          <Button onClick={save} loading={saving} disabled={!dirty} data-testid="avatar-save">
            Save
          </Button>
          <Menu trigger={<IconButton icon={MoreHorizontal} label="More" />} items={[{ label: 'Delete avatar', icon: Trash2, onSelect: remove, danger: true }]} />
        </>
      }
    >
      <div className={desktop ? 'grid grid-cols-[minmax(0,1.1fr)_minmax(340px,1fr)] gap-6' : 'flex flex-col gap-3'}>
        <div className={desktop ? 'sticky top-[68px] self-start' : 'sticky top-[60px] z-10 -mx-4 bg-bg px-4 pb-1'}>{preview}</div>
        <Tabs tabs={STEPS} value={step} onChange={setStep}>
          <div className="pt-4">
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
              <WardrobeStep avatar={a} config={draft} set={set} tryOn={tryOn} setTryOn={setTryOn} />
            </TabPanel>
            <TabPanel value="optimize">
              <OptimizeStep avatar={a} />
            </TabPanel>
            <TabPanel value="details">
              <DetailsStep avatar={a} name={name} setName={setName} handle={handle} />
            </TabPanel>
          </div>
        </Tabs>
      </div>
    </Page>
  );
}
