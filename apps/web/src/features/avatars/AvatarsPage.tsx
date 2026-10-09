/** The 3D avatar library: import models, see what's being prepared, open one to edit. */
import { AvatarRecipeSchema } from '@everloom/engine';
import { ArrowLeft, Box, Shapes, Shirt, Upload, UserRound } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/app/Shell';
import { toastError } from '@/lib/store';
import { Badge, Button, EmptyState, FileButton, Icon, IconButton, Menu, Spinner } from '@/ui';
import { createCodeAvatar, fmtBytes, uploadAvatar, useAvatars, useBlender } from './api';
import { RealisticMaker } from './Realistic';
import { usePrefs3D } from './prefs';
import { UnityImport } from './UnityImport';
const NativeHuman = lazy(() => import('@/features/avatar3d/NativeHuman'));

export const MODEL_ACCEPT = '.glb,.gltf,.vrm,.blend,.vroid,.vroidcustomitem,.fbx,.pmx,.pmd,.obj,.mtl,.png,.jpg,.jpeg,.webp,.tga,.bin,.unitypackage,.zip,.prefab,.mat,.meta';

/** A Unity package, a zip (often an extracted Unity folder) or loose Unity files go to the Unity import. */
const unityInput = (files: File[]) => files.some((f) => /\.(unitypackage|zip|prefab|meta)$/i.test(f.name));

export default function AvatarsPage() {
  const navigate = useNavigate();
  const list = useAvatars();
  const blender = useBlender();
  const [busy, setBusy] = useState(false);
  const [realistic, setRealistic] = useState(false);
  const [native, setNative] = useState(false);
  const experimental = usePrefs3D(p => p.experimentalProcedural);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unity, setUnity] = useState<File[] | null>(null);
  const importFile = async (files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (unityInput(files)) {
      setUnity(files);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const a = await uploadAvatar(files, undefined, setProgress);
      navigate(`/characters/avatars/${a.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const newCode = async () => {
    setBusy(true);
    try {
      const a = await createCodeAvatar('New character', AvatarRecipeSchema.parse({}));
      navigate(`/characters/avatars/${a.id}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page
      title="3D avatars"
      back={<IconButton icon={ArrowLeft} label="Characters" onClick={() => navigate('/characters')} />}
      actions={
        <>
          <Menu
            trigger={
              <Button variant="secondary" icon={Shapes} disabled={busy} data-testid="avatar-make">
                Make
              </Button>
            }
            items={[
              { label: 'MakeHuman (in your browser)', icon: UserRound, onSelect: () => setNative(true) },
              { label: 'From parts (bring your own pack)', icon: Shirt, onSelect: () => navigate('/characters/maker') },
              ...(experimental ? [{ label: 'Experimental code-made character', icon: Shapes, onSelect: () => void newCode() }] : []),
              // Made in Blender with MPFB: only offered where Blender runs.
              ...(blender.data?.found ? [{ label: 'Realistic (MakeHuman, in Blender)', icon: UserRound, onSelect: () => setRealistic(true) }] : []),
            ]}
          />
          <FileButton multiple onFiles={importFile} loading={busy} icon={Upload} data-testid="avatar-import">
            Import
          </FileButton>
        </>
      }
    >
      <p className="mb-4 text-sm text-fg-2">
        Drop a VRM, GLB, glTF, FBX, PMX or OBJ here, or a Unity package (.unitypackage) from BOOTH or Gumroad, or a zip of an extracted Unity folder. Select companion textures together with the model. Conversion happens in your browser.
      </p>
      <div className="mb-4 rounded-lg border border-dashed border-line p-4 text-sm text-fg-2" data-testid="avatar-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) void importFile(Array.from(e.dataTransfer.files)); }}>
        {busy ? <span role="status">{progress || 'Reading model…'}</span> : 'Drop the model and any companion files here'}
      </div>
      {error ? <div role="alert" className="mb-4 rounded-lg border border-line p-3"><p className="text-sm text-danger">{error}</p><Button variant="secondary" className="mt-2" onClick={() => void navigator.clipboard.writeText(error).catch(toastError)}>Copy details</Button></div> : null}
      {list.isLoading ? (
        <div className="grid min-h-[30vh] place-items-center">
          <Spinner />
        </div>
      ) : !list.data?.length ? (
        <EmptyState icon={Box} title="No 3D avatars yet" body="Import a model to edit it and use it on the stage." />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="avatar-list">
          {list.data.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => navigate(`/characters/avatars/${a.id}`)} className="pressable flex w-full flex-col overflow-hidden rounded-lg border border-line bg-surface text-left hover:border-line-strong">
                <div className="grid aspect-square place-items-center bg-surface-2">
                  {a.thumb ? <img src={a.thumb} alt="" className={`h-full w-full object-cover ${a.adult ? 'blur-lg' : ''}`} /> : a.status === 'processing' ? <Spinner /> : <Icon icon={Box} size={32} className="text-fg-3" />}
                </div>
                <div className="flex flex-col gap-1 p-2">
                  <span className="truncate text-sm font-medium">{a.name}</span>
                  <span className="flex flex-wrap items-center gap-1 text-xs text-fg-2">
                    {a.kind === 'code' ? <Badge>Code-made</Badge> : a.kind === 'parts' ? <Badge>Parts</Badge> : a.kind === 'realistic' && a.status === 'ready' ? <Badge>Realistic</Badge> : a.status === 'processing' ? <Badge>Preparing</Badge> : a.status === 'failed' ? <Badge tone="danger">Failed</Badge> : <>{a.triangles ? `${Math.round(a.triangles / 1000)}k tris · ` : ''}{fmtBytes(a.size)}</>}
                    {a.warnings && a.status === 'ready' ? <Badge tone="warning">{a.warnings} {a.warnings === 1 ? 'note' : 'notes'}</Badge> : null}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <UnityImport files={unity} onClose={() => setUnity(null)} />
      <RealisticMaker open={realistic} onOpenChange={setRealistic} />
      {native ? <Suspense fallback={<Spinner />}><NativeHuman open={native} onOpenChange={setNative} /></Suspense> : null}
    </Page>
  );
}
