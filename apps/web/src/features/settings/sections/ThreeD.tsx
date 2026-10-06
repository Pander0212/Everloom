/** Settings › 3D characters: this device's quality and effects, Blender, and the avatar library. */
import { Box, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router';
import { deleteClip, refreshBlender, setBlenderPath, useAvatarClips, useAvatars, useBlender } from '@/features/avatars/api';
import { usePrefs3D, type Quality3D } from '@/features/avatars/prefs';
import { toastError } from '@/lib/store';
import { Button, confirm, Field, IconButton, Input, ListRow, Segmented, Sheet, Spinner, ToggleRow } from '@/ui';

const ClipImporter = lazy(() => import('@/features/avatar3d/ClipImporter'));
import { Section } from '../common';

export default function ThreeDSection() {
  const p = usePrefs3D();
  const navigate = useNavigate();
  const avatars = useAvatars();
  const blender = useBlender();
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clips = useAvatarClips();
  const [importing, setImporting] = useState(false);
  return (
    <>
      <Section title="Avatars" description="3D models for your characters. Each character can show as 3D, Live2D or pictures (set on the character).">
        <Button variant="secondary" icon={Box} onClick={() => navigate('/characters/avatars')}>
          Open the avatar library{avatars.data ? ` (${avatars.data.length})` : ''}
        </Button>
      </Section>

      <Section
        title="Motion clips"
        description="Your own emotes, from GLB, VRMA, FBX, BVH or VMD files. They join the built-in ones everywhere: the picker, /emote, and the story."
        action={
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setImporting(true)}>
            Import
          </Button>
        }
      >
        {clips.data?.length ? (
          <div className="flex flex-col" data-testid="clip-list">
            {clips.data.map((c) => (
              <ListRow
                key={c.id}
                title={c.label}
                subtitle={`${c.id} · ${c.category}${c.source ? ` · ${c.source}` : ''}`}
                trailing={
                  <IconButton
                    icon={Trash2}
                    label={`Delete ${c.label}`}
                    onClick={async () => {
                      if (await confirm({ title: `Delete “${c.label}”?`, description: 'Characters stop using it; the story can no longer pick it.', confirmLabel: 'Delete', danger: true })) await deleteClip(c.id).catch(toastError);
                    }}
                  />
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-2">No imported motions yet.</p>
        )}
      </Section>
      <Sheet open={importing} onOpenChange={setImporting} title="Import a motion" size="lg">
        {importing ? (
          <Suspense fallback={<Spinner />}>
            <ClipImporter onDone={() => setImporting(false)} />
          </Suspense>
        ) : null}
      </Sheet>

      <Section title="On this device" description="Saved in this browser only, so a phone and a computer can differ.">
        <ToggleRow label="Show pictures instead of 3D" description="For slow or battery-tight devices. Nothing 3D is downloaded while this is on." checked={p.spritesOnly} onChange={(v) => p.set({ spritesOnly: v })} />
        <Field label="Quality" hint="Automatic lowers resolution, shadows, outlines and physics when frames run slow, and raises them when there's room.">
          <Segmented<Quality3D>
            label="3D quality"
            value={p.quality}
            onChange={(v) => p.set({ quality: v })}
            options={[
              { value: 'auto', label: 'Automatic' },
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
          />
        </Field>
        <Field label="Frame rate limit">
          <Segmented<string>
            label="Frame rate limit"
            value={String(p.fpsCap)}
            onChange={(v) => p.set({ fpsCap: Number(v) as 30 | 60 })}
            options={[
              { value: '30', label: '30 fps (saves battery)' },
              { value: '60', label: '60 fps' },
            ]}
          />
        </Field>
        <ToggleRow label="Hair and cloth physics" checked={p.physics} onChange={(v) => p.set({ physics: v })} />
        <ToggleRow label="Outlines" description="The ink line around toon-shaded characters." checked={p.outlines} onChange={(v) => p.set({ outlines: v })} />
      </Section>

      <Section
        title="Blender"
        description="Optional. Used to import FBX, PMX/PMD, OBJ and DAE models and FBX/BVH/VMD motions. Runs in the background, one job at a time, with no network access needed."
        action={
          <Button
            size="sm"
            variant="ghost"
            icon={RefreshCw}
            onClick={() => void refreshBlender().catch(toastError)}
          >
            Look again
          </Button>
        }
      >
        <p className="text-sm" data-testid="blender-status">
          {blender.isLoading ? 'Looking for Blender…' : blender.data?.found ? `Found Blender ${blender.data.version ?? ''} at ${blender.data.path}.${blender.data.mmd ? ' MMD Tools is installed (PMX/VMD work).' : ' For PMX and VMD files, add the MMD Tools extension in Blender.'}` : 'Blender was not found. Install it from blender.org, or enter where it is below.'}
        </p>
        <Field label="Blender program" hint="Leave empty to look in the usual places.">
          <div className="flex gap-2">
            <Input aria-label="Blender path" placeholder="/usr/bin/blender" value={path ?? (blender.data?.source === 'setting' ? (blender.data.path ?? '') : '')} onChange={(e) => setPath(e.target.value)} />
            <Button
              variant="secondary"
              loading={busy}
              disabled={path === null}
              onClick={async () => {
                setBusy(true);
                try {
                  await setBlenderPath(path?.trim() || null);
                  setPath(null);
                } catch (e) {
                  toastError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save
            </Button>
          </div>
        </Field>
      </Section>
    </>
  );
}
