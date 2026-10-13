/**
 * Importing from Unity without Unity: a .unitypackage (a BOOTH or Gumroad avatar or outfit), a zip of
 * an extracted folder, or the loose files. Lists what's inside, shows the package's own license,
 * then builds the avatar (or the outfit for one of your avatars) and saves the import report.
 */
import { AlertTriangle, FileText, Package, Shirt, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import type { AvatarConfig } from '@everloom/engine';
import { api, get, upload } from '@/lib/api';
import { cx } from '@/lib/format';
import { toastError } from '@/lib/store';
import { Button, Field, Icon, Select, Sheet } from '@/ui';
import { addOutfitModel, saveAvatar, saveClip, useAvatars, type AvatarDetail, type AvatarSummary } from './api';
import { ImportReportView } from './ImportReportView';
import type { PackageSummary, UnityBuild } from '@/features/avatar3d/runtime/unity/build';
import type { UnityProject } from '@everloom/engine/unity';
import ClipImporter from '@/features/avatar3d/ClipImporter';

type Pick = { guid: string; as: 'avatar' | 'outfit' };
type Pending = Pick & { id: string; name: string; target: string | null; variantGuid: string };


async function waitReady(id: string): Promise<AvatarDetail> {
  for (let i = 0; i < 600; i++) {
    const a = await get<AvatarDetail>(`/api/avatars/${id}`);
    if (a.status === 'failed') throw new Error(a.error ?? 'The server could not prepare the model.');
    if (a.status !== 'processing' && !a.processingStage) return a;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('The server is still preparing the model. Open it from the list in a moment.');
}

type NewGarment = AvatarConfig['garments'][number];
type NewOutfit = AvatarConfig['outfits'][number];

/**
 * `target` + `onOutfit`: opened from an avatar's wardrobe; the outfit is added to the editor's draft
 * (saved with the avatar's other changes) instead of being saved here.
 */
export function UnityImport({ files, onClose, target: fixed, onOutfit }: { files: File[] | null; onClose: () => void; target?: string; onOutfit?: (g: NewGarment[], o: NewOutfit[]) => void }) {
  const navigate = useNavigate();
  const reading = useRef<AbortController | null>(null);
  const avatars = useAvatars();
  const [project, setProject] = useState<UnityProject | null>(null);
  const [summary, setSummary] = useState<PackageSummary | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const pick = picks[0] ?? null;
  const [variantChoice, setVariantChoice] = useState<Record<string, string>>({});
  const [target, setTarget] = useState(fixed ?? '');
  const [step, setStep] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ build: UnityBuild; id: string } | null>(null);
  const [links, setLinks] = useState<{ from: string; to: string; how: string; kind: string; key: string }[]>([]);
  const [linkRev, setLinkRev] = useState(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const autoProject = useRef<UnityProject | null>(null);
  const [motion, setMotion] = useState<{ guid: string; file: File } | null>(null);
  // Without .meta files: preview the guessed links so the owner can fix them before importing.
  useEffect(() => {
    if (!project || !pick || project.exact) {
      setLinks([]);
      return;
    }
    void import('@everloom/engine/unity').then(({ planImport }) => {
      try {
        planImport(project, pick.guid);
        setLinks([...project.guessed]);
      } catch {
        setLinks([]);
      }
    });
  }, [project, pick, linkRev]);

  useEffect(() => {
    if (!files) return;
    let live = true;
    const abort = new AbortController();
    reading.current = abort;
    setProject(null);
    setSummary(null);
    setPicks([]);
    setDone(null);
    setMotion(null);
    setError(null);
    setBusy(true);
    void (async () => {
      try {
        const { summarize } = await import('@/features/avatar3d/runtime/unity/build');
        const { readUnityLibrary } = await import('@/features/avatar3d/runtime/unity/library');
        const p = await readUnityLibrary(files, (s) => live && setStep(s), abort.signal);
        const queued = await get<Pending[]>('/api/unity/pending');
        if (!live) return;
        setPending(queued);
        const s = summarize(p);
        const { dependencyAssets, licenseFiles } = await import('@everloom/engine/unity');
        const touched = (c: PackageSummary['avatars'][number]) => queued.some(item => item.guid === c.guid) || [c.guid, ...(c.variants ?? []).map(v => v.guid)].some(guid => p.recent.has(guid) || dependencyAssets(p, guid).assets.some(asset => p.recent.has(asset)));
        // The retained library supplies dependencies; Import all applies to this upload,
        // not every product the owner has ever indexed.
        s.avatars = s.avatars.filter(touched);
        s.outfits = s.outfits.filter(touched);
        const relevantPaths = [...s.avatars, ...s.outfits].flatMap(c => dependencyAssets(p, c.guid).assets.map(guid => p.get(guid)!.path));
        relevantPaths.push(...p.all().filter(a => p.recent.has(a.guid)).map(a => a.path));
        s.license = licenseFiles(p, relevantPaths);
        setProject(p);
        setSummary(s);
        // From a wardrobe: an outfit first (a bare FBX or prefab without a descriptor counts as one).
        const recent = (c: PackageSummary['avatars'][number]) => p.recent.has(c.guid) || c.variants?.some(v => p.recent.has(v.guid));
        const firstAvatar = s.avatars.find(recent) ?? s.avatars[0];
        const firstOutfit = s.outfits.find(recent) ?? s.outfits[0];
        const outfitFirst = fixed || (!s.avatars.some(recent) && s.outfits.some(recent)) ? (firstOutfit ?? firstAvatar) : null;
        const first = outfitFirst ? { guid: outfitFirst.guid, as: 'outfit' as const } : firstAvatar ? { guid: firstAvatar.guid, as: 'avatar' as const } : firstOutfit ? { guid: firstOutfit.guid, as: 'outfit' as const } : null;
        setPicks(first ? [first] : []);
        if (!first && !p.all('anim').length) setError('No model or animation was found. The files are retained in your library; add the product’s base package to resolve pending references.');
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) {
          setBusy(false);
          setStep('');
          reading.current = null;
        }
      }
    })();
    return () => {
      live = false;
      abort.abort();
    };
  }, [files]);

  const own = useMemo(() => (avatars.data ?? []).filter((a: AvatarSummary) => a.status === 'ready' && a.kind !== 'code'), [avatars.data]);
  useEffect(() => {
    if (!target && own[0]) setTarget(own[0].id);
  }, [own, target]);

  const removePending = async (id: string) => {
    await api(`/api/unity/pending/${id}`, { method: 'DELETE' });
    setPending(items => items.filter(p => p.id !== id));
  };
  const run = async (queued?: Pending[]) => {
    const selection: Array<Pick & Partial<Pending>> = queued ?? picks;
    if (!project || !selection.length) return;
    const defaultTarget = target;
    setBusy(true);
    setError(null);
    const addedGarments: NewGarment[] = [], addedOutfits: NewOutfit[] = [];
    try {
      const { buildUnity } = await import('@/features/avatar3d/runtime/unity/build');
      const stamp = new Date().toISOString();
      const { planImport } = await import('@everloom/engine/unity');
      for (const pick of selection) {
      const target = pick.target === undefined ? defaultTarget : pick.target ?? '';
      const complete = async () => {
        for (const item of pending.filter(p => p.guid === pick.guid && p.as === pick.as && (p.as === 'avatar' || p.target === target))) await removePending(item.id);
      };
      const candidate = [...(summary?.avatars ?? []), ...(summary?.outfits ?? [])].find(c => c.guid === pick.guid);
      const chosen = pick.variantGuid ?? variantChoice[pick.guid] ?? pick.guid;
      if ((candidate?.variants?.length ?? 0) > 16) throw new Error('This item has more than 16 variants. Split its variants into smaller groups before importing.');
      if (!planImport(project, chosen).models.length) {
        const item = await api<Pending>('/api/unity/pending', { body: { guid: pick.guid, variantGuid: chosen, name: (candidate?.name ?? project.get(chosen)?.path ?? 'Unity item').slice(0, 120), as: pick.as, target: pick.as === 'outfit' ? target : null } });
        setPending(items => [...items.filter(p => p.id !== item.id), item]);
        continue;
      }
      if (pick.as === 'avatar') {
        const build = await buildUnity(project, chosen, { as: 'avatar' }, setStep);
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
        if ((candidate?.variants?.length ?? 0) > 1) {
          const presets: NewOutfit[] = [];
          for (const [index, v] of candidate!.variants!.entries()) {
            const vb = v.guid === chosen ? build : await buildUnity(project, v.guid, { as: 'avatar' }, setStep);
            const vs = await addOutfitModel(a.id, vb.file);
            presets.push({ id: `unity_variant_${index}`, name: v.name.slice(0, 60), model: vs.model, modelLow: vs.modelLow ?? null, parts: [], garments: [], items: [] });
          }
          next.outfits = [...next.outfits, ...presets].slice(0, 32);
        }
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
        const build = await buildUnity(project, chosen, { as: 'outfit', avatarBones: bones }, setStep);
        setStep('Uploading the outfit…');
        const saved = await addOutfitModel(target, build.file);
        const fresh = await get<AvatarDetail>(`/api/avatars/${target}`);
        const id = `g_${Date.now().toString(36)}`.slice(0, 40);
        const name = build.plan.name.slice(0, 60);
        const cfg = fresh.config;
        const variants: NewGarment['variants'] = [];
        for (const v of (candidate?.variants ?? []).slice(0, 16)) {
          const vb = v.guid === chosen ? build : await buildUnity(project, v.guid, { as: 'outfit', avatarBones: bones }, setStep);
          const vs = v.guid === chosen ? saved : await addOutfitModel(target, vb.file);
          variants.push({ id: `v_${variants.length}`, name: v.name.slice(0, 60), model: vs.model, modelLow: vs.modelLow ?? null, tint: null, texture: null, repeat: 1 });
        }
        const garment: NewGarment = { id, name, model: saved.model, modelLow: saved.modelLow ?? null, slot: 'full', layer: 2, hides: [], hidesSlots: [], variants: variants.length > 1 ? variants : [], variant: variants.length > 1 ? variants.find(v => v.model === saved.model)!.id : null, springs: true, family: cfg.family, on: true, items: [name] };
        const outfit: NewOutfit = { id: `o_${id}`.slice(0, 40), name, model: null, modelLow: null, parts: [], garments: [{ id, variant: null }], items: [name] };
        if (onOutfit && target === fixed) {
          addedGarments.push(garment); addedOutfits.push(outfit);
          setDone({ build, id: target });
          await complete();
          continue;
        }
        await saveAvatar(target, {
          config: {
            ...cfg,
            garments: [...cfg.garments, garment],
            // An outfit is also an outfit preset, so the story and the inventory can put it on.
            outfits: [...cfg.outfits, outfit].slice(0, 32),
            importReport: cfg.importReport ? { ...cfg.importReport, imported: [...cfg.importReport.imported, { what: 'Outfit', detail: `${name} (${build.report.source})` }].slice(0, 60) } : { ...build.report, at: stamp },
          } as AvatarConfig,
        });
        setDone({ build, id: target });
      }
      await complete();
      }

    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (onOutfit && addedGarments.length) onOutfit(addedGarments, addedOutfits);
      setBusy(false);
      setStep('');
    }
  };

  useEffect(() => {
    if (!project || busy || autoProject.current === project) return;
    autoProject.current = project;
    void import('@everloom/engine/unity').then(({ planImport }) => {
      const ready = pending.filter(p => {
        try { return planImport(project, p.variantGuid).models.length > 0; } catch { return false; }
      });
      if (ready.length) void run(ready);
    });
  }, [project, busy, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const fit = async () => {
    if (!project || !pick || !target) return;
    setBusy(true); setError(null);
    try {
      const { buildUnity } = await import('@/features/avatar3d/runtime/unity/build');
      const build = await buildUnity(project, variantChoice[pick.guid] ?? pick.guid, { as: 'outfit' }, setStep);
      const { queueUnityFit } = await import('@/features/avatar3d/editor/pending-fit');
      queueUnityFit(target, build.file);
      onClose();
      navigate(`/characters/avatars/${target}?step=wardrobe`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setStep(''); }
  };

  const option = (c: PackageSummary['avatars'][number], as: 'avatar' | 'outfit') => (
    <li key={c.guid}>
      <button
        type="button"
        role="checkbox"
        aria-checked={picks.some(p => p.guid === c.guid)}
        onClick={() => setPicks(old => old.some(p => p.guid === c.guid) ? old.filter(p => p.guid !== c.guid) : [...old, { guid: c.guid, as: fixed ? 'outfit' : as }])}
        className={cx('pressable flex w-full items-start gap-3 rounded-md border p-3 text-left', picks.some(p => p.guid === c.guid) ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong')}
      >
        <Icon icon={as === 'avatar' ? UserRound : Shirt} className="mt-0.5 text-fg-2" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{c.name}</span>
          <span className="block truncate text-xs text-fg-3">{c.path}</span>
          <span className="block text-xs text-fg-2">{c.reason}</span>
          {c.dependencies ? <span className="block text-xs text-fg-2">{c.dependencies.models} model(s) + {c.dependencies.textures} textures + {c.dependencies.materials} materials</span> : null}
          {c.missing?.length ? <span className="block text-xs text-warning">Missing references: {c.missing.join(", ")}. Add the source package or link a replacement below. Missing textures use a placeholder.</span> : null}
        </span>
      </button>
      {!fixed && c.dependencies?.models === 0 && picks.some(p => p.guid === c.guid) ? <Field label={`Import ${c.name} as`}><Select aria-label={`Import ${c.name} as`} value={picks.find(p => p.guid === c.guid)!.as} onChange={e => setPicks(items => items.map(p => p.guid === c.guid ? { ...p, as: e.target.value as Pick['as'] } : p))}><option value="avatar">New avatar</option><option value="outfit">Outfit for an existing avatar</option></Select><span className="text-xs text-fg-2">The missing model prevents automatic classification. Choose how to finish this import when it arrives.</span></Field> : null}
      {(c.variants?.length ?? 0) > 1 ? <Field label={`Variant for ${c.name}`}><Select value={variantChoice[c.guid] ?? c.guid} onChange={e => setVariantChoice(old => ({ ...old, [c.guid]: e.target.value }))}>{c.variants!.map(v => <option key={v.guid} value={v.guid}>{v.name}</option>)}</Select><span className="text-xs text-fg-2">All {c.variants!.length} variants are imported together.</span></Field> : null}
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
          <Button variant="primary" onClick={() => (onOutfit ? onClose() : navigate(`/characters/avatars/${done.id}`))}>
            {onOutfit ? 'Done' : 'Open the avatar'}
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
          {busy && reading.current ? <Button onClick={() => reading.current?.abort()}>Cancel upload</Button> : null}
          {pick?.as === 'outfit' && target ? <Button disabled={busy} onClick={() => void fit()}>Fit to this avatar</Button> : null}
          <Button variant="primary" loading={busy} disabled={!picks.length || busy || (picks.some(p => p.as === 'outfit') && !target)} onClick={() => void run()}>
            {picks.length > 1 ? `Import ${picks.length} items` : pick?.as === 'outfit' ? 'Import the outfit' : 'Import the avatar'}
          </Button></div>
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
        {pending.length ? <section aria-label="Pending imports" className="rounded-md border border-line p-3">
          <p className="text-sm">Waiting for model files. These imports finish automatically when you add the missing package.</p>
          {pending.map(item => <div key={item.id} className="flex items-center justify-between gap-2 text-sm"><span>{item.name}</span><Button variant="ghost" disabled={busy} onClick={() => void removePending(item.id).catch(toastError)}>Cancel pending import</Button></div>)}
        </section> : null}
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
            <Button variant="secondary" onClick={() => setPicks([...summary.avatars.map(c => ({ guid: c.guid, as: fixed ? 'outfit' as const : 'avatar' as const })), ...summary.outfits.map(c => ({ guid: c.guid, as: 'outfit' as const }))])}>Import all</Button>
            {project && [...new Set([...summary.avatars, ...summary.outfits].flatMap(c => c.missing ?? []))].length ? <details>
              <summary>Link missing references</summary>
              <p className="text-xs text-fg-2">Choose a file from your library for each missing GUID. You can also close this sheet and add another package.</p>
              {[...new Set([...summary.avatars, ...summary.outfits].flatMap(c => c.missing ?? []))].map(guid => <Field key={guid} label={`Missing GUID ${guid}`}><Select value={project.links.get(guid) ?? ''} onChange={e => { project.links.set(guid, e.target.value); setLinkRev(r => r + 1); }}><option value="">Unresolved</option>{project.all().filter(a => ['model', 'material', 'texture', 'prefab'].includes(a.kind)).map(a => <option key={a.guid} value={a.guid}>{a.path}</option>)}</Select></Field>)}
            </details> : null}
            {summary.other?.length ? <details><summary>Other files ({summary.other.length})</summary><p className="text-xs text-fg-2">Required files come along automatically.</p>{summary.other.map(a => <p className="text-xs" key={a.guid}>{a.path}</p>)}</details> : null}
            {project?.all('anim').length ? <section aria-label="Animations">
              <h3 className="mb-2 text-sm font-medium">Animations</h3>
              <p className="text-xs text-fg-2">Preview each clip, choose its name and loop setting, then save it to the motion library.</p>
              <div className="mt-2 flex flex-wrap gap-2">{project.all('anim').map(a => <Button key={a.guid} onClick={() => setMotion({ guid: a.guid, file: new File([new TextDecoder().decode(a.data)], a.path.split('/').pop() ?? 'motion.anim') })}>{a.path.split('/').pop()}</Button>)}</div>
              {motion ? <ClipImporter key={motion.guid} initial={[motion.file]} onDone={() => setMotion(null)} /> : null}
            </section> : null}
            {summary.avatars.length ? (
              <section aria-label="Avatars">
                <h3 className="mb-2 text-sm font-medium">Avatars</h3>
                <ul role="group" aria-label="Avatars" className="flex flex-col gap-2">{summary.avatars.map((c) => option(c, 'avatar'))}</ul>
              </section>
            ) : null}
            {summary.outfits.length ? (
              <section aria-label="Outfits">
                <h3 className="mb-2 text-sm font-medium">Outfits and accessories</h3>
                <ul role="group" aria-label="Outfits" className="flex flex-col gap-2">{summary.outfits.map((c) => option(c, 'outfit'))}</ul>
              </section>
            ) : null}
            {links.length ? (
              <details className="rounded-md border border-line p-3" data-testid="link-files">
                <summary className="cursor-pointer text-sm font-medium">Link missing files ({links.length})</summary>
                <p className="mt-1 text-xs text-fg-2">These links were guessed by name and folder. Pick another file where a guess is wrong.</p>
                <ul className="mt-2 flex flex-col gap-2">
                  {links.map((l) => (
                    <li key={l.key} className="flex flex-col gap-1">
                      <label className="text-xs text-fg-2" htmlFor={`link-${l.key}`}>
                        {l.from.split('/').pop()} → {l.kind}
                      </label>
                      <Select
                        id={`link-${l.key}`}
                        value={project?.all(l.kind as never).find((a) => a.path === l.to)?.guid ?? ''}
                        onChange={(e) => {
                          project?.choices.set(l.key, e.target.value);
                          setLinkRev((r) => r + 1);
                        }}
                      >
                        <option value="">None</option>
                        {(project?.all(l.kind as never) ?? []).map((a) => (
                          <option key={a.guid} value={a.guid}>
                            {a.path}
                          </option>
                        ))}
                      </Select>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {picks.some(p => p.as === 'outfit') && !fixed ? (
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
