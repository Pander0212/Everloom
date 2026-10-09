/**
 * A 3D stage for one avatar (the import wizard, the dressing room, the detail sheet). Loads the
 * model with its saved settings and reloads when settings that change the model itself change.
 */
import { AvatarConfigSchema, resolveWardrobe, type AvatarConfig, type AvatarRecipe } from '@everloom/engine';
import { useEffect, useRef, useState } from 'react';
import { usePrefs3D } from '@/features/avatars/prefs';
import { cx } from '@/lib/format';
import { Spinner } from '@/ui';
import { useSettings } from '@/lib/queries';
import type { Avatar } from './runtime/avatar';
import { PRESETS, type LightingPreset } from './runtime/lighting';
import { loadModel, disposeLoadedModel, type LoadedModel } from './runtime/loader';
import { loadCodeModel } from './runtime/codemade/build';
import { autoLook, configureMaterials } from './runtime/materials';
import { canRender3D, Stage3D, type Framing } from './runtime/stage';
import { dress, paintSkin, shapeBody } from './runtime/wardrobe';

/** Explicit content (sliders, layers, clips) shows only for a confirmed adult character in adult mode. */
export function adultContentAllowed(content: Partial<AvatarConfig['content']> | undefined, adultMode: boolean) {
  return adultMode && content?.adult === true && content.confirmedAdult === true && (content.age ?? 0) >= 18;
}

export interface PreviewHandle {
  stage: Stage3D;
  avatar: Avatar;
  model: LoadedModel;
}

export interface Preview3DProps {
  src: string | null;
  fallbackSrc?: string | null;
  config?: Partial<AvatarConfig>;
  framing?: Framing;
  inspect?: boolean;
  lighting?: LightingPreset['id'];
  className?: string;
  onLoaded?: (h: PreviewHandle | null) => void;
  onError?: (reason: string) => void;
  /** Rendered over the canvas (buttons, overlays). */
  children?: React.ReactNode;
  /** Dress the preview: an outfit to try on (id), and equipped item names. */
  tryOn?: { outfit?: string | null; equipped?: string[] };
  /** A code-made character: built from this recipe instead of a file. */
  recipe?: AvatarRecipe | null;
}

/** The parts of the settings that require loading the model again. */
const structural = (c?: Partial<AvatarConfig>) => JSON.stringify([c?.content, c?.makehuman, c?.boneMap, c?.expressionMap, c?.scale, c?.facing, c?.floor, c?.physics?.stiffness, c?.physics?.gravity, c?.tints]);

export function lookFor(config: Partial<AvatarConfig> | undefined, model: LoadedModel) {
  return !config?.look || config.look === 'auto' ? autoLook(model.scene, !!model.vrm) : config.look;
}

export default function Preview3D({ src: baseSrc, fallbackSrc, config, framing = 'full', inspect = false, lighting = 'studio', className, onLoaded, onError, children, tryOn, recipe }: Preview3DProps) {
  // A whole-outfit model replaces the base model while that outfit is on.
  const fullCfg = config ? AvatarConfigSchema.safeParse(config) : null;
  const wardrobe = fullCfg?.success ? resolveWardrobe(fullCfg.data, { story: tryOn?.outfit ?? null, equipped: tryOn?.equipped }) : null;
  const src = wardrobe?.outfit?.model ? `/media/${wardrobe.outfit.model}` : baseSrc;
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage3D | null>(null);
  const handle = useRef<PreviewHandle | null>(null);
  const modelLoading = useRef(false);
  const prefs = usePrefs3D();
  const settings = useSettings();
  // Adult content is never hidden (no setting; only the online character browser has an 18+ switch).
  const adultHidden = false;
  /** Explicit sliders and layers: an adult character, confirmed, in adult mode. */
  const adultAllowed = adultContentAllowed(config?.content, true);
  const adultRef = useRef(adultAllowed);
  adultRef.current = adultAllowed;
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
  const [error, setError] = useState<string | null>(null);
  const loadedCb = useRef(onLoaded);
  loadedCb.current = onLoaded;
  const errorCb = useRef(onError);
  errorCb.current = onError;

  useEffect(() => {
    if (!canRender3D()) {
      setState('unsupported');
      errorCb.current?.('WebGL 2 is unavailable on this device.');
      return;
    }
    let s: Stage3D;
    try { s = new Stage3D(canvas.current!, { quality: prefs.quality, fpsCap: prefs.fpsCap, physics: prefs.physics, outlines: prefs.outlines }); }
    catch (e) { const reason = (e as Error).message; setState('error'); setError(reason); errorCb.current?.(reason); return; }
    stage.current = s;
    s.onFrame = stats => { if (handle.current && !modelLoading.current && stats.drawCalls > 0) setState('ready'); };
    s.onError = reason => { s.remove('preview'); handle.current = null; modelLoading.current = false; setState('error'); setError(reason); loadedCb.current?.(null); errorCb.current?.(reason); };
    s.start();
    return () => {
      s.dispose();
      stage.current = null;
      handle.current = null;
    };
    // The stage lives as long as the component; preference changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stage.current?.setOptions({ quality: prefs.quality, fpsCap: prefs.fpsCap, physics: prefs.physics, outlines: prefs.outlines });
  }, [prefs.quality, prefs.fpsCap, prefs.physics, prefs.outlines]);

  const nativeProfile = config?.makehuman ? { ...config.makehuman, proxies: wardrobe?.outfit?.makehumanProxies ?? config.makehuman.proxies } : undefined;
  const key = structural({ ...config, makehuman: nativeProfile });
  const recipeKey = recipe ? JSON.stringify(recipe) : '';
  useEffect(() => {
    const s = stage.current;
    if (!s || (!src && !recipe)) return;
    if (adultHidden) { s.remove('preview'); handle.current = null; loadedCb.current?.(null); setState('error'); setError('Adult content is hidden.'); return; }
    let cancelled = false;
    modelLoading.current = true;
    loadedCb.current?.(null);
    // A recipe being edited rebuilds in place: keep showing the last one until the new one is ready.
    if (!recipe || !handle.current) setState('loading');
    setError(null);
    (recipe ? loadCodeModel(recipe) : loadModel(src!, s.renderer, { bodyEdits: inspect, bodyShape: config?.bodyShape, content: config?.content, makehuman: wardrobe?.outfit?.model ? undefined : nativeProfile, fallbackSource: fallbackSrc, boneMap: config?.boneMap, expressionMap: config?.expressionMap, scale: config?.scale, facing: config?.facing, floor: config?.floor, tints: config?.tints }))
      .then(async (model) => {
        try { await configureMaterials(model.scene, { ...config?.materialOverrides, ...wardrobeRef.current?.outfit?.materialOverrides }); }
        catch (error) { disposeLoadedModel(model); throw error; }
        if (cancelled) { disposeLoadedModel(model); return; }
        const first = !handle.current;
        const avatar = s.add('preview', model, { look: lookFor(config, model), outlines: config?.outlines ?? true, physics: config?.physics?.enabled ?? true, stiffness: config?.physics?.stiffness, gravity: config?.physics?.gravity, settings: config?.physics, rig: config?.rig });
        if (first || !recipe) s.snapCamera();
        handle.current = { stage: s, avatar, model };
        if (!recipe && wardrobeRef.current && fullCfg?.success) dress(avatar, fullCfg.data, s.renderer, wardrobeRef.current, { adultAllowed: adultRef.current });
        modelLoading.current = false;
        loadedCb.current?.(handle.current);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        s.remove('preview'); handle.current = null; modelLoading.current = false;
        setError(e.message);
        setState('error');
        errorCb.current?.(e.message);
        loadedCb.current?.(null);
      });
    return () => {
      cancelled = true;
    };
    // Reload only for the model and settings that change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, key, recipeKey, adultHidden]);

  // Parts, regions and accessories follow the settings and the outfit being tried on.
  const wardrobeRef = useRef(wardrobe);
  wardrobeRef.current = wardrobe;
  const wardrobeKey = JSON.stringify([wardrobe, config?.parts, config?.body]);
  useEffect(() => {
    const h = handle.current;
    if (!h || state !== 'ready' || !wardrobe || !fullCfg?.success || recipe) return;
    // The body list decides region data, made once per wardrobe: start over when it changes.
    if (h.avatar.wardrobe && JSON.stringify(config?.body) !== bodyKey.current) {
      h.avatar.wardrobe.dispose();
      h.avatar.wardrobe = null;
    }
    bodyKey.current = JSON.stringify(config?.body);
    dress(h.avatar, fullCfg.data, h.stage.renderer, wardrobe, { adultAllowed });
    h.stage.kick();
  }, [wardrobeKey, state, adultAllowed]); // eslint-disable-line react-hooks/exhaustive-deps
  const bodyKey = useRef<string>('');
  // Body sliders (the file's morphs and the generated adjusters), eased in the render loop.
  const shapeKey = JSON.stringify([config?.bodyShape, config?.morphs?.values, config?.morphs?.sliders]);
  useEffect(() => { const h = handle.current; if (h && fullCfg?.success && state === 'ready') { shapeBody(h.avatar, fullCfg.data, { adultAllowed }); h.stage.kick(); } }, [shapeKey, state, adultAllowed]); // eslint-disable-line react-hooks/exhaustive-deps
  // Skin tone, skin layers, hair and eye colours: repainted when they change.
  const skinKey = JSON.stringify([config?.skinLayers, config?.appearance, wardrobe?.layers]);
  useEffect(() => { const h = handle.current; if (h && wardrobe && fullCfg?.success && state === 'ready' && !recipe) { paintSkin(h.avatar, fullCfg.data, h.stage.renderer, wardrobe, { adultAllowed }); h.stage.kick(); } }, [skinKey, state, adultAllowed]); // eslint-disable-line react-hooks/exhaustive-deps
  // Physics: the chest switch and strength, wind and collider edits change live.
  const dampingRef = useRef<number | undefined>(undefined);
  const physicsKey = JSON.stringify([config?.physics?.chest, config?.physics?.wind, config?.physics?.colliders, config?.physics?.damping]);
  useEffect(() => {
    const h = handle.current; if (!h || state !== 'ready' || !config?.physics) return;
    h.avatar.setChest(config.physics.chest?.enabled ?? true, config.physics.chest?.strength ?? 1);
    h.avatar.physics.windStrength = config.physics.wind ?? 0;
    // Only an edit changes it live (garments keep their own damping when the model loads).
    if (config.physics.damping !== undefined && dampingRef.current !== undefined && dampingRef.current !== config.physics.damping) h.avatar.setDamping(config.physics.damping);
    dampingRef.current = config.physics.damping;
    if (config.physics.colliders) h.avatar.setColliderEdits(config.physics.colliders);
    h.stage.kick();
  }, [physicsKey, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const materialsKey = JSON.stringify([config?.materialOverrides, wardrobe?.outfit?.materialOverrides]);
  useEffect(() => {
    const h = handle.current; if (!h || state !== 'ready') return;
    void configureMaterials(h.model.scene, { ...config?.materialOverrides, ...wardrobe?.outfit?.materialOverrides }).then(() => h.stage.kick()).catch((e: Error) => { setError(e.message); errorCb.current?.(e.message); });
  }, [materialsKey, state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Look and outlines switch in place.
  useEffect(() => {
    const h = handle.current;
    if (!h || state !== 'ready') return;
    h.avatar.setLook(lookFor(config, h.model), { outlines: (config?.outlines ?? true) && prefs.outlines });
  }, [config?.look, config?.outlines, state, prefs.outlines]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    stage.current?.setFraming(framing);
  }, [framing]);
  useEffect(() => {
    stage.current?.setInspect(inspect);
  }, [inspect]);
  useEffect(() => {
    stage.current?.setLighting(PRESETS[lighting]);
  }, [lighting]);

  return (
    <div className={cx('relative overflow-hidden rounded-lg bg-surface-2', className)}>
      <canvas ref={canvas} data-testid="avatar-preview" data-state={state} className="block h-full w-full touch-none" />
      {state === 'loading' && (src || recipe) ? (
        <div className="absolute inset-0 grid place-items-center">
          <Spinner />
        </div>
      ) : null}
      {state === 'error' ? <p className="absolute inset-x-3 bottom-3 rounded-md bg-surface/90 p-2 text-sm text-danger">The model could not be shown: {error}</p> : null}
      {state === 'unsupported' ? <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-fg-2">This device can't show 3D (WebGL 2 is off or missing). Characters appear as pictures instead.</p> : null}
      {children}
    </div>
  );
}
