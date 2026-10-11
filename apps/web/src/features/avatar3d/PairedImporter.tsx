/**
 * Import a paired or group animation: one motion per participant (separate files, or several
 * animations in one file), retargeted like single emotes, then placed: how far apart they stand,
 * which way they face, and which hands meet. Saved for the story, the emote picker and scripts.
 */
import { BUILTIN_EMOTES, BUILTIN_PAIRED, PAIRED_ID, type PairedClip } from '@everloom/engine';
import { Plus, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { put } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Button, Field, FileButton, IconButton, Input, Select, Switch } from '@/ui';
import { load, type Loaded } from './ClipImporter';
import type { ClipJSON } from './runtime/clip';
import { convertMotion } from './runtime/convert';

interface Part {
  /** Its own file, or another participant's file (several rigs in one file). */
  loaded: Loaded | null;
  from: number;
  anim: number;
  name: string;
}

const HANDS = {
  none: { label: 'Nothing meets', contacts: [] },
  right: { label: 'Right hands (handshake)', contacts: [['rightHand', 'rightHand']] },
  mirror: { label: 'Right meets left (high five)', contacts: [['rightHand', 'leftHand']] },
  both: { label: 'Both hands held', contacts: [['rightHand', 'leftHand'], ['leftHand', 'rightHand']] },
  hug: { label: 'Arms round each other (hug)', contacts: [['leftHand', 'upperChest'], ['rightHand', 'upperChest']] },
} as const;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'p$1').slice(0, 40);

export default function PairedImporter({ onDone }: { onDone: () => void }) {
  const adultMode = true;
  const [parts, setParts] = useState<Part[]>([{ loaded: null, from: 0, anim: 0, name: 'Lead' }, { loaded: null, from: 1, anim: 0, name: 'Partner' }]);
  const [label, setLabel] = useState('');
  const [id, setId] = useState('');
  const [loop, setLoop] = useState(false);
  const [adult, setAdult] = useState(false);
  const [distance, setDistance] = useState(0.7);
  const [hands, setHands] = useState<keyof typeof HANDS>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (i: number, p: Partial<Part>) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const source = (i: number) => parts[parts[i]!.from]?.loaded ?? null;

  const pick = async (i: number, files: File[]) => {
    setBusy(true);
    setError(null);
    try {
      const l = await load(files);
      set(i, { loaded: l, from: i, anim: Math.min(i, l.names.length - 1) });
      // A file with one animation per participant fills the others in.
      if (l.names.length >= parts.length) setParts((ps) => ps.map((x, j) => (x.loaded || j === i ? (j === i ? { ...x, loaded: l, from: i, anim: j } : x) : { ...x, from: i, anim: j })));
      if (!label) { const n = files[0]!.name.replace(/\.[^.]+$/, ''); setLabel(n.slice(0, 60)); setId(slug(n)); }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const idError = !PAIRED_ID.test(id) ? 'Lowercase letters, digits and _ (starting with a letter)' : BUILTIN_PAIRED.some((p) => p.id === id) || BUILTIN_EMOTES.some((e) => e.id === id) ? 'That name is built in; choose another' : null;
  const ready = parts.every((_, i) => source(i)) && !idError && label.trim();

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const n = parts.length;
      const clips: ClipJSON[] = [];
      for (let i = 0; i < n; i++) {
        const l = source(i)!;
        const src = await l.read();
        const anim = src.animations[parts[i]!.anim] ?? src.animations[0]!;
        clips.push(convertMotion(src, anim, { id: `${id}_${i}`.slice(0, 40), loop, inPlace: true, source: l.files.map((f) => f.name).join(' + ').slice(0, 200), maxSeconds: 120 }));
      }
      const seconds = Math.max(...clips.map((c) => c.frames / c.fps));
      // Facing each other across a line (two), or round a circle (three or four), `distance` apart.
      const roles = parts.map((p, i) => {
        const angle = n === 2 ? (i === 0 ? Math.PI : 0) : Math.PI + (i * 2 * Math.PI) / n;
        const r = n === 2 ? distance / 2 : distance / (2 * Math.sin(Math.PI / n));
        const x = Math.cos(angle) * r, z = Math.sin(angle) * r * 0.5;
        const yaw = (Math.atan2(-x, -z) * 180) / Math.PI;
        return { name: p.name.trim() || `Participant ${i + 1}`, clip: clips[i]!, offset: [Math.round(x * 100) / 100, Math.round(z * 100) / 100] as [number, number], yaw: Math.round(yaw) };
      });
      const contacts = HANDS[hands].contacts.flatMap(([a, b]) => [{ a: { role: 0, bone: a }, b: { role: 1, bone: b }, from: 0, to: seconds }, ...(hands === 'hug' ? [{ a: { role: 1, bone: a }, b: { role: 0, bone: 'spine' }, from: 0, to: seconds }] : [])]);
      const body: Omit<PairedClip, 'id'> = { v: 1, label: label.trim(), aliases: [], roles, contacts: contacts as PairedClip['contacts'], loop, adult: adult && adultMode, source: roles.map((r) => r.clip.source).join(' / ').slice(0, 200) };
      await put(`/api/avatar-paired/${id}`, body);
      void queryClient.invalidateQueries({ queryKey: ['avatar-paired'] });
      toast({ title: `Saved “${label.trim()}”`, lines: ['Play it from the emote picker with two characters on the stage, or let the story use it.'], tone: 'success' });
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="paired-importer">
      <p className="text-sm text-fg-2">One motion per participant: separate files, or one file holding an animation for each. GLB, VRMA, FBX and BVH are read here.</p>
      {parts.map((p, i) => {
        const l = source(i);
        return (
          <div key={i} className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3">
            <div className="flex items-center gap-2">
              <Input aria-label={`Participant ${i + 1} name`} value={p.name} maxLength={30} onChange={(e) => set(i, { name: e.target.value })} className="flex-1" />
              {parts.length > 2 ? <IconButton icon={Trash2} label={`Remove ${p.name || `participant ${i + 1}`}`} onClick={() => setParts((ps) => ps.filter((_, j) => j !== i).map((x) => ({ ...x, from: Math.min(x.from, ps.length - 2) })))} /> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FileButton size="sm" variant="secondary" icon={Upload} multiple onFiles={(f) => void pick(i, f)} loading={busy && !l}>
                {p.loaded ? 'Another file' : 'Choose a motion'}
              </FileButton>
              {parts.some((x, j) => j !== i && x.loaded) && !p.loaded ? (
                <Select aria-label={`File for participant ${i + 1}`} value={p.from} onChange={(e) => set(i, { from: Number(e.target.value) })}>
                  {parts.map((x, j) => (x.loaded && j !== i ? <option key={j} value={j}>{`Same file as ${x.name || `participant ${j + 1}`}`}</option> : null))}
                </Select>
              ) : null}
            </div>
            {l ? (
              <Field label="Animation">
                <Select aria-label={`Animation for participant ${i + 1}`} value={p.anim} onChange={(e) => set(i, { anim: Number(e.target.value) })}>
                  {l.names.map((n, j) => <option key={j} value={j}>{n}</option>)}
                </Select>
              </Field>
            ) : null}
          </div>
        );
      })}
      {parts.length < 4 ? (
        <Button variant="secondary" size="sm" icon={Plus} className="self-start" onClick={() => setParts((ps) => [...ps, { loaded: null, from: ps.length, anim: 0, name: `Participant ${ps.length + 1}` }])}>
          Add a participant
        </Button>
      ) : null}
      {error ? <p className="rounded-md bg-danger-soft p-2 text-sm text-danger" role="alert">{error}</p> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input aria-label="Paired name" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Id" error={id ? idError : null}>
          <Input aria-label="Paired id" value={id} maxLength={40} onChange={(e) => setId(e.target.value.toLowerCase())} />
        </Field>
      </div>
      <Field label={`How far apart (${distance.toFixed(2)} m at 1.7 m tall)`} hint="Taller or shorter characters are spaced to match, and step closer when their arms can't reach.">
        <input type="range" aria-label="How far apart" min={0.2} max={2} step={0.05} value={distance} onChange={(e) => setDistance(Number(e.target.value))} />
      </Field>
      <Field label="What meets" hint="Hands are pulled together with light inverse kinematics, so different heights still line up.">
        <Select aria-label="What meets" value={hands} onChange={(e) => setHands(e.target.value as keyof typeof HANDS)}>
          {Object.entries(HANDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </Field>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Loops (a dance, sitting together)</span>
        <Switch checked={loop} onChange={setLoop} label="Loops" />
      </label>
      {adultMode ? (
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Adults only (never plays for a character under 18)</span>
          <Switch checked={adult} onChange={setAdult} label="Adults only" />
        </label>
      ) : null}
      <Button onClick={save} loading={busy} disabled={!ready} data-testid="paired-save">
        Save paired animation
      </Button>
    </div>
  );
}
