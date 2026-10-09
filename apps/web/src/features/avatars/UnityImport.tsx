/**
 * Importing from Unity without Unity: a .unitypackage (a BOOTH or Gumroad avatar or outfit), a zip of
 * an extracted folder, or the loose files. Lists what's inside, shows the package's own license,
 * then builds the avatar (or the outfit for one of your avatars) and saves the import report.
 */
import { AlertTriangle, FileText, Package, Shirt, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { AvatarConfig } from '@everloom/engine';
import { get, upload } from '@/lib/api';
import { cx } from '@/lib/format';
import { toastError } from '@/lib/store';
import { Button, Field, Icon, Select, Sheet } from '@/ui';
import { addOutfitModel, saveAvatar, saveClip, useAvatars, type AvatarDetail, type AvatarSummary } from './api';
import { ImportReportView } from './ImportReportView';
import type { PackageSummary, UnityBuild } from '@/features/avatar3d/runtime/unity/build';
import type { UnityProject } from '@everloom/engine/unity';

type Pick = { guid: string; as: 'avatar' | 'outfit' };

async function waitReady(id: string): Promise<AvatarDetail> {
  for (let i = 0; i < 600; i++) {
    const a = await get<AvatarDetail>(`/api/avatars/${id}`);
    if (a.status !== 'processing' && !a.processingStage) return a;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('The server is still preparing the model. Open it from the list in a moment.');
}

export function UnityImport({ files, onClose }: { files: File[] | null; onClose: () => void }) {
  const navigate = useNavigate();
  const avatars = useAvatars();
  const [project, setProject] = useState<UnityProject | null>(null);
  const [summary, setSummary] = useState<PackageSummary | null>(null);
  const [pick, setPick] = useState<Pick | null>(null);
  const [target, setTarget] = useState('');
  const [step, setStep] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ build: UnityBuild; id: string } | null>(null);

  useEffect(() => {
    if (!files) return;
    let live = true;
    setProject(null);
    setSummary(null);
    setPick(null);
    setDone(null);
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        const { readUnity, summarize } = await import('@/features/avatar3d/runtime/unity/build');
        const p = await readUnity(files, (s) => live && setStep(s));
        if (!live) return;
        const s = summarize(p);
        setProject(p);
        setSummary(s);
        const first = s.avatars[0] ? { guid: s.avatars[0].guid, as: 'avatar' as const } : s.outfits[0] ? { guid: s.outfits[0].guid, as: 'outfit' as const } : null;
        setPick(first);
        if (!first) setError('Nothing to import was found: no prefab with a model, and no FBX.');
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) {
          setBusy(false);
          setStep('');
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [files]);

  const own = useMemo(() => (avatars.data ?? []).filter((a: AvatarSummary) => a.status === 'ready' && a.kind === 'imported'), [avatars.data]);
  useEffect(() => {
    if (!target && own[0]) setTarget(own[0].id);
  }, [own, target]);

  const run = async () => {
    if (!project || !pick) return;
    setBusy(true);
    setError(null);
    try {
      const { buildUnity } = await import('@/features/avatar3d/runtime/unity/build');
      const stamp = new Date().toISOString();
      if (pick.as === 'avatar') {
        const build = await buildUnity(project, pick.guid, { as: 'avatar' }, setStep);
        setStep('Uploading to your server…');
        const a = await upload<AvatarSummary>('/api/avatars', new Blob([build.file], { type: 'application/octet-stream' }), { filename: build.file.name, name: build.plan.name });
        setStep('The server is preparing the model…');
        const detail = await waitReady(a.id);
        const cfg = detail.config;
        // The prefab's blendshape presets drive the body sliders, so outfits with the same shapes follow.
        const values = { ...(cfg.morphs?.values ?? {}) };
        for (const sl of cfg.morphs?.sliders ?? []) {
          for (const [morph, w] of Object.entries(build.presets)) {
            if (sl.plus.includes(morph)) values[sl.id] = w;
            else if (sl.minus.includes(morph)) values[sl.id] = -w;
          }
        }
        const next: AvatarConfig = {
          ...cfg,
          ...build.config,
          // Unity's own mapping wins over the automatic one; anything it doesn't name stays automatic.
          boneMap: { ...cfg.boneMap, ...build.config.boneMap },
          expressionMap: { ...cfg.expressionMap, ...build.config.expressionMap },
          parts: [...cfg.parts, ...(build.config.parts ?? [])].slice(0, 64),
          physics: build.config.physics ? { ...cfg.physics, chains: build.config.physics.chains } : cfg.physics,
          ...(cfg.morphs ? { morphs: { ...cfg.morphs, values } } : {}),
          importReport: { ...build.report, at: stamp },
        } as AvatarConfig;
        await saveAvatar(a.id, { config: next });
        // Body animations go to the motion library (Settings › 3D characters › Motion clips).
        for (const c of build.clips) {
          try {
            await saveClip(c.clip.id, { label: c.label, category: c.loop ? 'idle' : 'social', clip: c.clip, source: c.clip.source });
          } catch (e) {
            build.report.skipped.push({ what: 'Animation', detail: `${c.label}: ${(e as Error).message}` });
          }
        }
        setDone({ build, id: a.id });
      } else {
        if (!target) throw new Error('Choose the avatar this outfit is for.');
        const avatar = await get<AvatarDetail>(`/api/avatars/${target}`);
        const bones = (avatar.info.bones ?? []).map((b: { name: string }) => b.name);
        const build = await buildUnity(project, pick.guid, { as: 'outfit', avatarBones: bones }, setStep);
        setStep('Uploading the outfit…');
        const saved = await addOutfitModel(target, build.file);
        const fresh = await get<AvatarDetail>(`/api/avatars/${target}`);
        const id = `g_${Date.now().toString(36)}`.slice(0, 40);
        const name = build.plan.name.slice(0, 60);
        const cfg = fresh.config;
        await saveAvatar(target, {
          config: {
            ...cfg,
            garments: [...cfg.garments, { id, name, model: saved.model, modelLow: saved.modelLow ?? null, slot: 'full', layer: 2, hides: [], hidesSlots: [], variants: [], variant: null, springs: true, family: cfg.family, on: true, items: [name] }],
            // An outfit is also an outfit preset, so the story and the inventory can put it on.
            outfits: [...cfg.outfits, { id: `o_${id}`.slice(0, 40), name, model: null, modelLow: null, parts: [], garments: [{ id, variant: null }], items: [name] }].slice(0, 32),
            importReport: cfg.importReport ? { ...cfg.importReport, imported: [...cfg.importReport.imported, { what: 'Outfit', detail: `${name} (${build.report.source})` }].slice(0, 60) } : { ...build.report, at: stamp },
          } as AvatarConfig,
        });
        setDone({ build, id: target });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setStep('');
    }
  };

  const option = (c: PackageSummary['avatars'][number], as: 'avatar' | 'outfit') => (
    <li key={c.guid}>
      <button
        type="button"
        role="radio"
        aria-checked={pick?.guid === c.guid}
        onClick={() => setPick({ guid: c.guid, as })}
        className={cx('pressable flex w-full items-start gap-3 rounded-md border p-3 text-left', pick?.guid === c.guid ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong')}
      >
        <Icon icon={as === 'avatar' ? UserRound : Shirt} className="mt-0.5 text-fg-2" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{c.name}</span>
          <span className="block truncate text-xs text-fg-3">{c.path}</span>
          <span className="block text-xs text-fg-2">{c.reason}</span>
        </span>
      </button>
    </li>
  );

  return (
    <Sheet
      open={!!files}
      onOpenChange={(o) => !o && !busy && onClose()}
      title="Import from Unity"
      size="lg"
      help="Unity packages (.unitypackage) from BOOTH or Gumroad, a zip of an extracted folder, or the files themselves. Everloom reads them without Unity: models, materials, textures, blendshape presets, PhysBones, visemes and outfits. Scripts and shaders can't run outside Unity; the report lists them."
      footer={
        done ? (
          <Button variant="primary" onClick={() => navigate(`/characters/avatars/${done.id}`)}>
            Open the avatar
          </Button>
        ) : (
          <Button variant="primary" loading={busy} disabled={!pick || busy || (pick.as === 'outfit' && !target)} onClick={() => void run()}>
            {pick?.as === 'outfit' ? 'Import the outfit' : 'Import the avatar'}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {busy && step ? <p role="status" className="text-sm text-fg-2">{step}</p> : null}
        {error ? (
          <p role="alert" className="flex items-start gap-2 text-sm text-danger">
            <Icon icon={AlertTriangle} className="mt-0.5" /> {error}
          </p>
        ) : null}
        {done ? (
          <ImportReportView report={done.build.report} />
        ) : summary ? (
          <>
            <p className="text-sm text-fg-2">
              <Icon icon={Package} className="mr-1 inline" />
              {Object.entries(summary.counts)
                .filter(([k]) => k !== 'folder')
                .map(([k, n]) => `${n} ${k}`)
                .join(' · ')}
            </p>
            {!summary.exact ? <p className="text-sm text-warning">Some .meta files are missing: materials and textures are matched by name, and the report lists every guess.</p> : null}
            {summary.avatars.length ? (
              <section aria-label="Avatars">
                <h3 className="mb-2 text-sm font-medium">Avatars</h3>
                <ul role="radiogroup" aria-label="Avatars" className="flex flex-col gap-2">{summary.avatars.map((c) => option(c, 'avatar'))}</ul>
              </section>
            ) : null}
            {summary.outfits.length ? (
              <section aria-label="Outfits">
                <h3 className="mb-2 text-sm font-medium">Outfits and accessories</h3>
                <ul role="radiogroup" aria-label="Outfits" className="flex flex-col gap-2">{summary.outfits.map((c) => option(c, 'outfit'))}</ul>
              </section>
            ) : null}
            {pick?.as === 'outfit' ? (
              <Field label="For which avatar" htmlFor="unity-target" hint="Its bones are matched to the avatar's by name (Modular Avatar's Merge Armature, or the same names).">
                <Select id="unity-target" value={target} onChange={(e) => setTarget(e.target.value)}>
                  {own.length ? own.map((a) => <option key={a.id} value={a.id}>{a.name}</option>) : <option value="">Import the avatar first</option>}
                </Select>
              </Field>
            ) : null}
            {summary.license.length ? (
              <details className="rounded-md border border-line p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  <Icon icon={FileText} className="mr-1 inline" />
                  The package’s license and readme
                </summary>
                {summary.license.slice(0, 3).map((l) => (
                  <div key={l.path} className="mt-2">
                    <p className="text-xs text-fg-3">{l.path}</p>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-fg-2">{l.text.slice(0, 4000)}</pre>
                  </div>
                ))}
              </details>
            ) : null}
            <p className="text-xs text-fg-3">Bought or downloaded avatars and outfits are for your own use. Everloom marks them as third-party and leaves them out of exports, bundles, packs and shares unless you confirm you have the right.</p>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
