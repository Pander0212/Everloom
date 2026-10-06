/** Step 1: does it move right? Check poses, a few emotes, talking, and what the import found. */
import { BUILTIN_EMOTES, EMOTIONS, type Emotion } from '@everloom/engine';
import { AlertTriangle, Info, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { fmtBytes, type AvatarDetail } from '@/features/avatars/api';
import { cx } from '@/lib/format';
import { Button, Field, Icon, SectionTitle, Select, Switch } from '@/ui';
import type { PreviewHandle } from '../Preview3D';
import { CHECK_POSES, type CheckPose } from '../runtime/poses';

const POSES: Array<{ id: CheckPose | 'idle'; label: string }> = [
  { id: 'idle', label: 'Idle' },
  { id: 'tpose', label: 'T-pose' },
  { id: 'armsUp', label: 'Arms up' },
  { id: 'squat', label: 'Squat' },
  { id: 'wave', label: 'Right hand up' },
];

export function CheckStep({ avatar, handle }: { avatar: AvatarDetail; handle: PreviewHandle | null }) {
  const [pose, setPose] = useState<CheckPose | 'idle'>('idle');
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [talk, setTalk] = useState(false);
  const info = avatar.info;

  useEffect(() => {
    if (!handle) return;
    handle.avatar.override = pose === 'idle' ? null : CHECK_POSES[pose]();
    handle.stage.kick();
  }, [handle, pose]);
  useEffect(() => {
    if (!handle) return;
    handle.avatar.emotion = emotion;
    handle.avatar.setSpeaking(talk);
    // Without a voice, cycle mouth shapes so lip-sync can be checked.
    if (!talk) return;
    const shapes = ['aa', 'ih', 'ou', 'ee', 'oh'] as const;
    let i = 0;
    const t = setInterval(() => {
      handle.avatar.visemes = { [shapes[i++ % shapes.length]!]: 0.6 + Math.random() * 0.4 };
    }, 120);
    return () => {
      clearInterval(t);
      handle.avatar.visemes = {};
    };
  }, [handle, emotion, talk]);
  // Leave the model animating normally when this step closes.
  useEffect(() => () => void (handle && (handle.avatar.override = null)), [handle]);

  const problems = (info.warnings ?? []).filter((w) => w.level === 'problem');
  const heavy = (info.warnings ?? []).filter((w) => w.level === 'heavy');
  const notes = (info.warnings ?? []).filter((w) => w.level === 'info');
  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionTitle>Pose check</SectionTitle>
        <p className="mb-2 text-sm text-fg-2">If the bones are mapped right, the arms go straight out in the T-pose, straight up with "Arms up", and only the right hand rises in the last one. If not, fix it on the Bones step.</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Check pose">
          {POSES.map((p) => (
            <Button key={p.id} size="sm" variant={pose === p.id ? 'primary' : 'secondary'} role="radio" aria-checked={pose === p.id} onClick={() => setPose(p.id)}>
              {p.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Emote">
          <Select
            aria-label="Emote"
            defaultValue=""
            onChange={(e) => {
              setPose('idle');
              void handle?.avatar.emote(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="" disabled>
              Play…
            </option>
            {BUILTIN_EMOTES.filter((x) => x.source === 'bundled').map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Expression">
          <Select aria-label="Expression" value={emotion} onChange={(e) => setEmotion(e.target.value as Emotion)}>
            {EMOTIONS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Talk (mouth shapes and gestures)</span>
        <Switch checked={talk} onChange={setTalk} label="Talk" />
      </label>

      {problems.length || heavy.length || notes.length ? (
        <div className="flex flex-col gap-2" data-testid="avatar-warnings">
          <SectionTitle>What the import found</SectionTitle>
          {[...problems, ...heavy, ...notes].map((w) => (
            <p key={w.code} className={cx('flex gap-2 rounded-md p-2 text-sm', w.level === 'problem' ? 'bg-danger-soft text-danger' : w.level === 'heavy' ? 'bg-warning-soft' : 'bg-surface-2 text-fg-2')}>
              <Icon icon={w.level === 'problem' ? AlertTriangle : w.level === 'heavy' ? Zap : Info} size={16} className="mt-0.5 flex-none" />
              {w.message}
            </p>
          ))}
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        <Stat label="Triangles" value={info.triangles?.toLocaleString() ?? '—'} />
        <Stat label="Bones" value={String(info.joints ?? '—')} />
        <Stat label="Materials" value={String(info.materials ?? '—')} />
        <Stat label="Textures" value={info.textures ? `${info.textures.length}${info.textures.length ? ` (up to ${Math.max(...info.textures.map((t) => t.width))}px)` : ''}` : '—'} />
        <Stat label="Face shapes" value={String((info.morphs?.length ?? 0) + (info.vrmExpressions?.length ?? 0))} />
        <Stat label="File" value={`${fmtBytes(info.report?.before)} → ${fmtBytes(info.report?.after)}`} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
