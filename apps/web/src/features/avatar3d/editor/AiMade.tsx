/**
 * Making a prop (or, experimentally, a garment) with the owner's image-to-3D connection: describe it
 * or give a picture, watch it being made, then put it on the character or throw it away. The
 * character preview above shows the result in every pose and emote.
 */
import type { GarmentSlot } from '@everloom/engine';
import { ImagePlus, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, del, get } from '@/lib/api';
import { useConnections, useSettings } from '@/lib/queries';
import { toastError } from '@/lib/store';
import { Badge, Button, Field, FileButton, Input, Segmented, Sheet, StatBar } from '@/ui';

export interface MadeModel {
  model: string;
  name: string;
  kind: 'prop' | 'garment';
}

interface Job {
  id: string;
  state: 'running' | 'done' | 'failed';
  progress: number;
  stage: string;
  error: string | null;
  model: string | null;
  triangles: number | null;
}

export function AiMade({ open, onOpenChange, onAccept }: { open: boolean; onOpenChange: (o: boolean) => void; onAccept: (m: MadeModel) => Promise<void> | void }) {
  const settings = useSettings();
  const conns = useConnections();
  const has3d = !!(settings.data?.roles as { model3d?: string | null } | undefined)?.model3d || (conns.data ?? []).some((c) => c.provider.startsWith('3d-'));
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<'prop' | 'garment'>('prop');
  const [picture, setPicture] = useState<File | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!job || job.state !== 'running') return;
    const t = setInterval(() => void get<Job>(`/api/avatars/generate/${job.id}`).then(setJob).catch(() => undefined), 2500);
    return () => clearInterval(t);
  }, [job?.id, job?.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true);
    try {
      const j = picture
        ? await api<Job>('/api/avatars/generate', { method: 'POST', raw: picture, contentType: 'application/octet-stream', query: { prompt, kind } })
        : await api<Job>('/api/avatars/generate', { method: 'POST', body: { prompt, kind } });
      setJob(j);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (job) await del(`/api/avatars/generate/${job.id}`).catch(() => undefined);
    setJob(null);
  };
  const accept = async () => {
    if (!job?.model) return;
    setBusy(true);
    try {
      await onAccept({ model: job.model, name: prompt.slice(0, 60) || 'AI-made', kind });
      setJob(null);
      setPrompt('');
      setPicture(null);
      onOpenChange(false);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Make with AI">
      {!has3d ? (
        <p className="text-sm text-fg-2">Add a 3D model connection first (Settings › Connections › 3D models): Meshy, or Hunyuan3D or TRELLIS on fal.ai.</p>
      ) : !job ? (
        <div className="flex flex-col gap-4">
          <Segmented label="What to make" value={kind} onChange={setKind} options={[{ value: 'prop', label: 'A prop' }, { value: 'garment', label: <span className="flex items-center gap-1">A garment <Badge tone="warning">Experimental</Badge></span> }]} />
          <Field label="Describe it" hint={kind === 'prop' ? 'Hats, weapons, bags, jewelry: rigid things come out best.' : 'Image-to-3D, then fitted to the body with Blender. Loose or layered clothes come out rough.'}>
            <Input aria-label="Describe it" value={prompt} maxLength={600} onChange={(e) => setPrompt(e.target.value)} placeholder={kind === 'prop' ? 'a brass lantern with green glass' : 'a short red jacket with gold buttons'} />
          </Field>
          <FileButton variant="secondary" icon={ImagePlus} accept="image/png,image/jpeg,image/webp" onFiles={([f]) => setPicture(f ?? null)}>
            {picture ? `Picture: ${picture.name}` : 'Use a picture (better results)'}
          </FileButton>
          <Button icon={Sparkles} loading={busy} disabled={prompt.trim().length < 2} onClick={start} data-testid="ai-make">
            Make it
          </Button>
          <p className="text-xs text-fg-2">This uses your 3D connection's credits. Making one takes a minute or a few.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4" data-testid="ai-job" data-state={job.state}>
          {job.state === 'running' ? (
            <>
              <p className="text-sm">{job.stage}…</p>
              <StatBar value={job.progress} max={100} label="Progress" />
            </>
          ) : job.state === 'failed' ? (
            <p className="text-sm text-danger">It didn't work: {job.error}</p>
          ) : (
            <p className="text-sm">Ready ({(job.triangles ?? 0).toLocaleString()} triangles). {kind === 'prop' ? 'Put it on to see it in the preview; move and size it under Accessories.' : 'Fitting it to the body takes a minute more.'}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {job.state === 'done' ? (
              <Button loading={busy} onClick={accept} data-testid="ai-accept">
                {kind === 'prop' ? 'Put it on' : 'Fit it to the body'}
              </Button>
            ) : null}
            {job.state !== 'running' ? (
              <Button variant="secondary" onClick={() => void discard().then(start)}>
                Try again
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => void discard()}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export type { GarmentSlot };
