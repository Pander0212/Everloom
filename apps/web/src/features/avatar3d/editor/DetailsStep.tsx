/** Step 6: name, picture, and which characters use this avatar. */
import { Camera } from 'lucide-react';
import { useState } from 'react';
import { setAvatarThumbnail, type AvatarDetail } from '@/features/avatars/api';
import { patch } from '@/lib/api';
import { queryClient, qk, useCharacters } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Button, Field, Input, SectionTitle, Select } from '@/ui';
import type { PreviewHandle } from '../Preview3D';
import { captureThumbnail } from '../runtime/thumbnail';

export function DetailsStep({ avatar, name, setName, handle }: { avatar: AvatarDetail; name: string; setName: (s: string) => void; handle: PreviewHandle | null }) {
  const chars = useCharacters();
  const [busy, setBusy] = useState(false);
  const using = (chars.data ?? []).filter((c) => c.avatar3d === avatar.id);
  const link = async (id: string) => {
    if (!id) return;
    try {
      const c = await queryClient.fetchQuery({ queryKey: qk.character(id), queryFn: () => import('@/lib/api').then((m) => m.get(`/api/characters/${id}`)) });
      await patch(`/api/characters/${id}`, { game: { ...(c.game ?? {}), avatar3d: avatar.id, display: c.game?.display ?? 'auto' } });
      void queryClient.invalidateQueries({ queryKey: qk.characters });
      void queryClient.invalidateQueries({ queryKey: qk.character(id) });
      toast({ title: `${c.name} now uses ${avatar.name} in 3D`, tone: 'success' });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Field label="Name">
        <Input aria-label="Avatar name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Picture" hint="Taken from the preview: frame it there first.">
        <div className="flex items-center gap-3">
          {avatar.thumb ? <img src={avatar.thumb} alt="" className="h-20 w-20 rounded-md bg-surface-2 object-cover" /> : <div className="h-20 w-20 rounded-md bg-surface-2" />}
          <Button
            variant="secondary"
            icon={Camera}
            loading={busy}
            disabled={!handle}
            onClick={async () => {
              if (!handle) return;
              setBusy(true);
              try {
                await setAvatarThumbnail(avatar.id, await captureThumbnail(handle.stage));
              } catch (e) {
                toastError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            Take picture
          </Button>
        </div>
      </Field>
      <SectionTitle>Characters</SectionTitle>
      {using.length ? <p className="text-sm">Used by {using.map((c) => c.name).join(', ')}.</p> : <p className="text-sm text-fg-2">No character uses this avatar yet.</p>}
      <Field label="Use for a character">
        <Select aria-label="Use for a character" value="" onChange={(e) => void link(e.target.value)}>
          <option value="">Choose…</option>
          {(chars.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
