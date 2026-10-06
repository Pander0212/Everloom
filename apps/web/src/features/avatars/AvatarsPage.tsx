/** The 3D avatar library: import models, see what's being prepared, open one to edit. */
import { AvatarRecipeSchema } from '@everloom/engine';
import { ArrowLeft, Box, Shapes, Shirt, Upload, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Page } from '@/app/Shell';
import { toastError } from '@/lib/store';
import { Badge, Button, EmptyState, FileButton, Icon, IconButton, Menu, Spinner } from '@/ui';
import { createCodeAvatar, fmtBytes, uploadAvatar, useAvatars, useBlender } from './api';
import { RealisticMaker } from './Realistic';

export const MODEL_ACCEPT = '.glb,.vrm,.blend,.zip,.fbx,.pmx,.pmd,.obj,.dae';

export default function AvatarsPage() {
  const navigate = useNavigate();
  const list = useAvatars();
  const blender = useBlender();
  const [busy, setBusy] = useState(false);
  const [realistic, setRealistic] = useState(false);
  const importFile = async ([f]: File[]) => {
    if (!f) return;
    setBusy(true);
    try {
      const a = await uploadAvatar(f);
      navigate(`/characters/avatars/${a.id}`);
    } catch (e) {
      toastError(e);
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
              { label: 'From parts (pick hair, clothes…)', icon: Shirt, onSelect: () => navigate('/characters/maker') },
              { label: 'Code-made (simple, no files)', icon: Shapes, onSelect: () => void newCode() },
              // Made in Blender with MPFB: only offered where Blender runs.
              ...(blender.data?.found ? [{ label: 'Realistic (MakeHuman, in Blender)', icon: UserRound, onSelect: () => setRealistic(true) }] : []),
            ]}
          />
          <FileButton accept={MODEL_ACCEPT} onFiles={importFile} loading={busy} icon={Upload} data-testid="avatar-import">
            Import
          </FileButton>
        </>
      }
    >
      <p className="mb-4 text-sm text-fg-2">
        GLB and VRM (0.x and 1.0) import directly.{' '}
        {blender.data?.found ? `.blend files (or a zip of a .blend with its textures), FBX, PMX, OBJ and DAE go through Blender ${blender.data.version ?? ''}.` : '.blend, FBX, PMX, OBJ and DAE need Blender (free from blender.org); set it up in Settings → 3D characters.'}
      </p>
      {list.isLoading ? (
        <div className="grid min-h-[30vh] place-items-center">
          <Spinner />
        </div>
      ) : !list.data?.length ? (
        <EmptyState icon={Box} title="No 3D avatars yet" body="Import a GLB or VRM model, or make a code-made character from simple choices." />
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="avatar-list">
          {list.data.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => navigate(`/characters/avatars/${a.id}`)} className="pressable flex w-full flex-col overflow-hidden rounded-lg border border-line bg-surface text-left hover:border-line-strong">
                <div className="grid aspect-square place-items-center bg-surface-2">
                  {a.thumb ? <img src={a.thumb} alt="" className="h-full w-full object-cover" /> : a.status === 'processing' ? <Spinner /> : <Icon icon={Box} size={32} className="text-fg-3" />}
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
      <RealisticMaker open={realistic} onOpenChange={setRealistic} />
    </Page>
  );
}
