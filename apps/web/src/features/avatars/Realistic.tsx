/**
 * Realistic characters: MPFB (the MakeHuman add-on) builds a human in Blender on the server from a
 * few sliders and MakeHuman's CC0 skins, hair and clothes. Needs Blender 4.2+ and MPFB; the setup
 * card installs MPFB and the assets from their official sources.
 */
import { adultAge, ageYears, MIN_ADULT_AGE, RealisticSpecSchema, type RealisticSpec } from '@everloom/engine';
import { Download, Trash2, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toastError } from '@/lib/store';
import { Button, confirm, Field, Input, Select, Sheet, Slider, StatBar } from '@/ui';
import { createRealisticAvatar, installMpfb, removeMpfb, useMpfb, type MpfbStatus } from './api';

const pretty = (s: string) => s.replace(/[_-]+/g, ' ').replace(/(\d+)/g, ' $1').replace(/\s+/g, ' ').trim();

/** Installing or removing MPFB (shown in the maker and in Settings › 3D characters). */
export function MpfbSetup({ status }: { status: MpfbStatus | undefined }) {
  const [busy, setBusy] = useState(false);
  if (!status) return null;
  if (!status.blender) return <p className="text-sm text-fg-2">Realistic characters are made in Blender on your server. Install Blender 4.2 or later (free from blender.org), then come back.</p>;
  if (!status.blenderRecent) return <p className="text-sm text-fg-2">MPFB needs Blender 4.2 or later; this server has Blender {status.blenderVersion ?? '(unknown version)'}.</p>;
  const i = status.install;
  if (i.state === 'running')
    return (
      <div className="flex flex-col gap-2" data-testid="mpfb-installing">
        <p className="text-sm">{i.stage}…</p>
        <StatBar value={i.progress} max={100} label="Installing" />
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      {status.installed ? (
        <p className="text-sm text-fg-2">{status.managed ? 'MPFB and the MakeHuman assets are installed for Everloom.' : 'Using the MPFB installed in your own Blender.'}</p>
      ) : (
        <p className="text-sm text-fg-2">
          Realistic characters use MPFB, the MakeHuman add-on for Blender (GPL-3.0), and MakeHuman's skins, hair and clothes (CC0, free for any use). Installing downloads about 330 MB from extensions.blender.org and makehumancommunity.org onto your server; your own Blender isn't changed.
        </p>
      )}
      {i.state === 'failed' ? <p className="text-sm text-danger">Installing didn't work: {i.error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {!status.installed || status.managed ? (
          <Button
            icon={Download}
            variant={status.installed ? 'secondary' : 'primary'}
            loading={busy}
            data-testid="mpfb-install"
            onClick={async () => {
              setBusy(true);
              await installMpfb().catch(toastError);
              setBusy(false);
            }}
          >
            {status.installed ? 'Reinstall' : 'Install MPFB'}
          </Button>
        ) : null}
        {status.managed ? (
          <Button
            icon={Trash2}
            variant="ghost"
            onClick={async () => {
              if (await confirm({ title: 'Remove MPFB?', description: "Realistic characters you made stay. You can't make new ones until it's installed again.", confirmLabel: 'Remove', danger: true })) await removeMpfb().catch(toastError);
            }}
          >
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function pick(list: string[], ...prefer: string[]): string | null {
  for (const p of prefer) if (list.includes(p)) return p;
  return list[0] ?? null;
}

export function RealisticMaker({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const mpfb = useMpfb(open);
  const assets = mpfb.data?.assets;
  const [name, setName] = useState('');
  const [spec, setSpec] = useState<RealisticSpec>(() => RealisticSpecSchema.parse({}));
  const [busy, setBusy] = useState(false);

  // First sensible choices once the asset lists are known.
  useEffect(() => {
    if (!assets) return;
    setSpec((s) =>
      s.skin
        ? s
        : {
            ...s,
            skin: pick(assets.skins, 'young_caucasian_female', 'default'),
            eyes: pick(assets.eyes, 'low-poly', 'brown'),
            eyebrows: pick(assets.eyebrows, 'eyebrow001'),
            eyelashes: pick(assets.eyelashes, 'eyelashes01'),
            hair: pick(assets.hair, 'bob01'),
            clothes: ['female_casualsuit01', 'shoes01'].filter((c) => assets.clothes.includes(c)),
          },
    );
  }, [assets]);

  const macro = (k: keyof Omit<RealisticSpec['macro'], 'race'>, v: number) => setSpec((s) => ({ ...s, macro: { ...s.macro, [k]: v } }));
  const make = async () => {
    setBusy(true);
    try {
      const a = await createRealisticAvatar(name.trim() || 'Realistic character', { ...spec, macro: { ...spec.macro, age: adultAge(spec.macro.age) } });
      onOpenChange(false);
      navigate(`/characters/avatars/${a.id}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const choose = (label: string, key: 'skin' | 'eyes' | 'eyebrows' | 'eyelashes' | 'hair', list: string[], none?: string) => (
    <Field label={label}>
      <Select aria-label={label} value={spec[key] ?? ''} onChange={(e) => setSpec((s) => ({ ...s, [key]: e.target.value || null }))}>
        {none ? <option value="">{none}</option> : null}
        {list.map((n) => (
          <option key={n} value={n}>
            {pretty(n)}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Realistic character" description="Made with MPFB (MakeHuman) in Blender on your server.">
      {mpfb.isLoading ? (
        <p className="text-sm text-fg-2">Checking Blender and MPFB…</p>
      ) : !mpfb.data?.installed || !assets ? (
        <MpfbSetup status={mpfb.data} />
      ) : (
        <div className="flex flex-col gap-4" data-testid="realistic-maker">
          <Field label="Name">
            <Input aria-label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Realistic character" />
          </Field>
          <Field label="Body" hint={`Age about ${Math.round(ageYears(adultAge(spec.macro.age)))} (characters are adults).`}>
            <div className="grid grid-cols-[6rem_1fr] items-center gap-x-3">
              <span className="text-sm text-fg-2">Feminine ↔ masculine</span>
              <Slider label="Feminine to masculine" value={spec.macro.gender} min={0} max={1} step={0.01} onChange={(v) => macro('gender', v)} />
              <span className="text-sm text-fg-2">Age</span>
              <Slider label="Age" value={Math.max(MIN_ADULT_AGE, spec.macro.age)} min={MIN_ADULT_AGE} max={1} step={0.01} onChange={(v) => macro('age', v)} />
              <span className="text-sm text-fg-2">Weight</span>
              <Slider label="Weight" value={spec.macro.weight} min={0} max={1} step={0.01} onChange={(v) => macro('weight', v)} />
              <span className="text-sm text-fg-2">Muscle</span>
              <Slider label="Muscle" value={spec.macro.muscle} min={0} max={1} step={0.01} onChange={(v) => macro('muscle', v)} />
              <span className="text-sm text-fg-2">Height</span>
              <Slider label="Height" value={spec.macro.height} min={0} max={1} step={0.01} onChange={(v) => macro('height', v)} />
            </div>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            {choose('Skin', 'skin', assets.skins)}
            {choose('Hair', 'hair', assets.hair, 'No hair')}
            {choose('Eyes', 'eyes', assets.eyes)}
            {choose('Eyebrows', 'eyebrows', assets.eyebrows, 'None')}
            {choose('Eyelashes', 'eyelashes', assets.eyelashes, 'None')}
          </div>
          <Field label="Clothes" hint="Clothes are part of the model; add more later in the wardrobe.">
            <div className="flex flex-wrap gap-1.5">
              {assets.clothes.map((c) => {
                const on = spec.clothes.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    disabled={!on && spec.clothes.length >= 8}
                    onClick={() => setSpec((s) => ({ ...s, clothes: on ? s.clothes.filter((x) => x !== c) : [...s.clothes, c] }))}
                    className={`pressable min-h-9 rounded-md border px-2.5 text-sm ${on ? 'border-accent bg-accent/10 text-fg' : 'border-line bg-surface text-fg-2'}`}
                  >
                    {pretty(c)}
                  </button>
                );
              })}
            </div>
          </Field>
          <Button icon={UserRound} loading={busy} onClick={make} data-testid="realistic-make">
            {busy ? 'Making it in Blender…' : 'Make'}
          </Button>
          <p className="text-xs text-fg-2">Takes about half a minute. MakeHuman assets are CC0; MPFB is GPL-3.0 and only runs on your server.</p>
        </div>
      )}
    </Sheet>
  );
}
