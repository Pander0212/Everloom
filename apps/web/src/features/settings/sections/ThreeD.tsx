/** Settings › 3D characters: this device's quality and effects, Blender, and the avatar library. */
import { Box, Plus, RefreshCw, Shirt, Trash2, Upload } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';
import { del, get } from '@/lib/api';
import { useNavigate } from 'react-router';
import { deleteClip, refreshBlender, setBlenderPath, useAvatarClips, useAvatars, useBlender, useBlenderJobs } from '@/features/avatars/api';
import { usePrefs3D, type Quality3D } from '@/features/avatars/prefs';
import { deletePack, importPack, setPackEnabled, usePacks } from '@/features/avatars/packs';
import { toastError } from '@/lib/store';
import { Button, confirm, Field, FileButton, IconButton, Input, ListRow, Segmented, Sheet, Spinner, Switch, ToggleRow } from '@/ui';

const ClipImporter = lazy(() => import('@/features/avatar3d/ClipImporter'));
import { Section } from '../common';

export default function ThreeDSection() {
  const p = usePrefs3D();
  const navigate = useNavigate();
  const avatars = useAvatars();
  const blender = useBlender();
  const jobs = useBlenderJobs(!!blender.data?.found);
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clips = useAvatarClips();
  const [importing, setImporting] = useState<false | { files?: File[]; inbox?: string }>(false);
  const inbox = useQuery({ queryKey: ['motion-inbox'], queryFn: () => get<Array<{ id: string; name: string; url: string }>>('/api/avatar-motions/inbox') });
  const packs = usePacks();
  const [packBusy, setPackBusy] = useState(false);
  return (
    <>
      <Section title="Avatars" description="3D models for your characters. Each character can show as 3D, Live2D or pictures (set on the character).">
        <Button variant="secondary" icon={Box} onClick={() => navigate('/characters/avatars')}>
          Open the avatar library{avatars.data ? ` (${avatars.data.length})` : ''}
        </Button>
      </Section>

      <Section
        title="Part packs"
        description="Catalogs of bodies, hair and clothes for the parts maker, in the CharacterStudio pack format (a zip with manifest.json). Only import packs you have the rights to use."
        action={
          <FileButton
            size="sm"
            variant="secondary"
            icon={Upload}
            accept=".zip"
            loading={packBusy}
            data-testid="pack-import"
            onFiles={async ([f]) => {
              if (!f) return;
              setPackBusy(true);
              try {
                await importPack(f);
              } catch (e) {
                toastError(e);
              } finally {
                setPackBusy(false);
              }
            }}
          >
            Import
          </FileButton>
        }
      >
        <div className="flex flex-col" data-testid="pack-list">
          {(packs.data ?? []).map((pk) => (
            <ListRow
              key={pk.id}
              title={pk.name}
              subtitle={
                <span className="flex flex-col gap-0.5">
                  <span>
                    {pk.parts} parts{pk.builtin ? ' · built in' : ''} · License: {pk.license}
                  </span>
                  {pk.credits ? <span className="line-clamp-2">{pk.credits}</span> : null}
                </span>
              }
              trailing={
                <span className="flex items-center gap-1">
                  <Switch label={`Use ${pk.name}`} checked={pk.enabled} onChange={(v) => void setPackEnabled(pk.id, v).catch(toastError)} />
                  {!pk.builtin ? (
                    <IconButton
                      icon={Trash2}
                      label={`Delete ${pk.name}`}
                      onClick={async () => {
                        if (await confirm({ title: `Delete “${pk.name}”?`, description: 'Its parts leave the maker. Characters already made with them keep them.', confirmLabel: 'Delete', danger: true })) await deletePack(pk.id).catch(toastError);
                      }}
                    />
                  ) : null}
                </span>
              }
            />
          ))}
        </div>
        <Button variant="secondary" icon={Shirt} className="mt-2 self-start" onClick={() => navigate('/characters/maker')}>
          Open the parts maker
        </Button>
      </Section>

      <Section
        title="Motion clips"
        description="Your own emotes, from GLB, VRMA, FBX, BVH or VMD files. They join the built-in ones everywhere: the picker, /emote, and the story."
        action={
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => setImporting({})} data-testid="clip-import">
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
      {inbox.data?.length ? (
        <Section title="From Blender" description="Animations the Blender add-on sent. Import each one to name it and choose how it plays.">
          <div className="flex flex-col" data-testid="motion-inbox">
            {inbox.data.map((m) => (
              <ListRow
                key={m.id}
                title={m.name}
                trailing={
                  <span className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        const blob = await (await fetch(m.url)).blob();
                        setImporting({ files: [new File([blob], `${m.name}.glb`, { type: 'model/gltf-binary' })], inbox: m.id });
                      }}
                    >
                      Import
                    </Button>
                    <IconButton icon={Trash2} label={`Discard ${m.name}`} onClick={async () => (await del(`/api/media/${m.id}`).catch(toastError), void inbox.refetch())} />
                  </span>
                }
              />
            ))}
          </div>
        </Section>
      ) : null}
      <Sheet open={!!importing} onOpenChange={(o) => !o && setImporting(false)} title="Import a motion" size="lg">
        {importing ? (
          <Suspense fallback={<Spinner />}>
            <ClipImporter
              initial={importing.files}
              onDone={() => {
                // Imported from the inbox: it leaves the inbox.
                if (importing.inbox) void del(`/api/media/${importing.inbox}`).then(() => inbox.refetch());
                setImporting(false);
              }}
            />
          </Suspense>
        ) : null}
      </Sheet>

      <Section title="On this device" description="Saved in this browser only, so a phone and a computer can differ.">
        <ToggleRow label="Show pictures instead of 3D" description="For slow or battery-tight devices. Nothing 3D is downloaded while this is on." checked={p.spritesOnly} onChange={(v) => p.set({ spritesOnly: v })} />
        <ToggleRow label="Code-made figures for characters without a picture" description="Built from their description, with no file to download. Characters with a picture or Live2D keep it." checked={p.codeNpcs} onChange={(v) => p.set({ codeNpcs: v })} />
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
        {jobs.data?.length ? (
          <div className="mt-2" data-testid="blender-jobs">
            <p className="mb-1 text-sm font-medium">Recent jobs</p>
            {jobs.data.slice(0, 8).map((j) => (
              <details key={j.id} className="border-t border-line py-1.5 text-sm">
                <summary className="cursor-pointer">
                  {j.op} · {j.state === 'running' ? 'running…' : j.state === 'waiting' ? 'waiting' : j.state === 'failed' ? `failed: ${j.error}` : `done in ${((j.ms ?? 0) / 1000).toFixed(1)} s`}
                </summary>
                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-xs">{j.log || 'No output.'}</pre>
              </details>
            ))}
          </div>
        ) : null}
      </Section>
    </>
  );
}
