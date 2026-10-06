/**
 * A 3D stage for one avatar (the import wizard, the dressing room, the detail sheet). Loads the
 * model with its saved settings and reloads when settings that change the model itself change.
 */
import { AvatarConfigSchema, resolveWardrobe, type AvatarConfig, type AvatarRecipe } from '@everloom/engine';
import { useEffect, useRef, useState } from 'react';
import { usePrefs3D } from '@/features/avatars/prefs';
import { cx } from '@/lib/format';
import { Spinner } from '@/ui';
import type { Avatar } from './runtime/avatar';
import { PRESETS, type LightingPreset } from './runtime/lighting';
import { loadModel, type LoadedModel } from './runtime/loader';
import { loadCodeModel } from './runtime/codemade/build';
import { autoLook } from './runtime/materials';
import { canRender3D, Stage3D, type Framing } from './runtime/stage';
import { dress } from './runtime/wardrobe';

export interface PreviewHandle {
  stage: Stage3D;
  avatar: Avatar;
  model: LoadedModel;
}

export interface Preview3DProps {
  src: string | null;
  config?: Partial<AvatarConfig>;
  framing?: Framing;
  inspect?: boolean;
  lighting?: LightingPreset['id'];
  className?: string;
  onLoaded?: (h: PreviewHandle | null) => void;
  /** Rendered over the canvas (buttons, overlays). */
  children?: React.ReactNode;
  /** Dress the preview: an outfit to try on (id), and equipped item names. */
  tryOn?: { outfit?: string | null; equipped?: string[] };
  /** A code-made character: built from this recipe instead of a file. */
  recipe?: AvatarRecipe | null;
}

/** The parts of the settings that require loading the model again. */
const structural = (c?: Partial<AvatarConfig>) => JSON.stringify([c?.boneMap, c?.expressionMap, c?.scale, c?.facing, c?.floor, c?.physics?.stiffness, c?.physics?.gravity, c?.tints]);

export function lookFor(config: Partial<AvatarConfig> | undefined, model: LoadedModel) {
  return !config?.look || config.look === 'auto' ? autoLook(model.scene, !!model.vrm) : config.look;
}

export default function Preview3D({ src: baseSrc, config, framing = 'full', inspect = false, lighting = 'studio', className, onLoaded, children, tryOn, recipe }: Preview3DProps) {
  // A whole-outfit model replaces the base model while that outfit is on.
  const fullCfg = config ? AvatarConfigSchema.safeParse(config) : null;
  const wardrobe = fullCfg?.success ? resolveWardrobe(fullCfg.data, { story: tryOn?.outfit ?? null, equipped: tryOn?.equipped }) : null;
  const src = wardrobe?.outfit?.model ? `/media/${wardrobe.outfit.model}` : baseSrc;
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage3D | null>(null);
  const handle = useRef<PreviewHandle | null>(null);
  const prefs = usePrefs3D();
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unsupported'>('loading');
  const [error, setError] = useState<string | null>(null);
  const loadedCb = useRef(onLoaded);
  loadedCb.current = onLoaded;

  useEffect(() => {
    if (!canRender3D()) {
      setState('unsupported');
      return;
    }
    const s = new Stage3D(canvas.current!, { quality: prefs.quality, fpsCap: prefs.fpsCap, physics: prefs.physics, outlines: prefs.outlines });
    stage.current = s;
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

  const key = structural(config);
  const recipeKey = recipe ? JSON.stringify(recipe) : '';
  useEffect(() => {
    const s = stage.current;
    if (!s || (!src && !recipe)) return;
    let cancelled = false;
    // A recipe being edited rebuilds in place: keep showing the last one until the new one is ready.
    if (!recipe || !handle.current) setState('loading');
    setError(null);
    (recipe ? loadCodeModel(recipe) : loadModel(src!, s.renderer, { boneMap: config?.boneMap, expressionMap: config?.expressionMap, scale: config?.scale, facing: config?.facing, floor: config?.floor, tints: config?.tints }))
      .then((model) => {
        if (cancelled) return;
        const first = !handle.current;
        const avatar = s.add('preview', model, { look: lookFor(config, model), outlines: config?.outlines ?? true, physics: config?.physics?.enabled ?? true });
        avatar.options.stiffness = config?.physics?.stiffness;
        avatar.options.gravity = config?.physics?.gravity;
        if (first || !recipe) s.snapCamera();
        handle.current = { stage: s, avatar, model };
        if (!recipe && wardrobeRef.current && fullCfg?.success) dress(avatar, fullCfg.data, s.renderer, wardrobeRef.current);
        setState('ready');
        loadedCb.current?.(handle.current);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setState('error');
        loadedCb.current?.(null);
      });
    return () => {
      cancelled = true;
    };
    // Reload only for the model and settings that change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, key, recipeKey]);

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
    dress(h.avatar, fullCfg.data, h.stage.renderer, wardrobe);
    h.stage.kick();
  }, [wardrobeKey, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const bodyKey = useRef<string>('');

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
    <div className={cx('relative overflow-hidden rounded-lg bg-[radial-gradient(ellipse_at_50%_35%,var(--surface-2),var(--surface))]', className)}>
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
