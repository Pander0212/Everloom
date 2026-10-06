/** Step 5: how hard to compress (texture size, KTX2, how simple the phone copy is), and the result. */
import { useState } from 'react';
import { fmtBytes, reprocessAvatar, type AvatarDetail } from '@/features/avatars/api';
import { toastError } from '@/lib/store';
import { Button, Field, SectionTitle, Select, Slider, Switch } from '@/ui';

export function OptimizeStep({ avatar }: { avatar: AvatarDetail }) {
  const prev = avatar.info.optimize ?? {};
  const [maxTexture, setMaxTexture] = useState(prev.maxTexture ?? 2048);
  const [ktx2, setKtx2] = useState(prev.ktx2 ?? true);
  const [lowRatio, setLowRatio] = useState(prev.lowRatio ?? 0.5);
  const [busy, setBusy] = useState(false);
  const r = avatar.info.report;
  return (
    <div className="flex flex-col gap-4">
      {r ? (
        <dl className="grid grid-cols-3 gap-2 rounded-md bg-surface-2 p-3 text-sm" data-testid="avatar-report">
          <div>
            <dt className="text-xs text-fg-3">Original</dt>
            <dd className="tabular-nums">{fmtBytes(r.before)}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-3">Optimized</dt>
            <dd className="tabular-nums">{fmtBytes(r.after)}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-3">Phone copy</dt>
            <dd className="tabular-nums">{fmtBytes(r.low)}</dd>
          </div>
          <div className="col-span-3 text-xs text-fg-2">
            Textures: {r.textures}. {r.notes.join(' ')}
          </div>
        </dl>
      ) : null}
      <SectionTitle>Settings</SectionTitle>
      <Field label="Largest texture" hint="Smaller textures load faster and use less memory; 2048 suits most screens.">
        <Select aria-label="Largest texture" value={maxTexture} onChange={(e) => setMaxTexture(Number(e.target.value))}>
          {[512, 1024, 2048, 4096].map((n) => (
            <option key={n} value={n}>
              {n} px
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          GPU texture compression (KTX2)
          <span className="block text-xs text-fg-2">Stays compressed in graphics memory: far lighter on phones. Takes longer to prepare.</span>
        </span>
        <Switch checked={ktx2} onChange={setKtx2} label="KTX2" />
      </label>
      <Field label={`Phone copy detail (${Math.round(lowRatio * 100)}%)`} hint="How much of the geometry the lighter copy keeps.">
        <Slider label="Phone copy detail" min={0.1} max={1} step={0.05} value={lowRatio} onChange={setLowRatio} />
      </Field>
      <Button
        variant="secondary"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await reprocessAvatar(avatar.id, { maxTexture, ktx2, lowRatio });
          } catch (e) {
            toastError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        Optimize again
      </Button>
    </div>
  );
}
