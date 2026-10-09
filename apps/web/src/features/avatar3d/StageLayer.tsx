/**
 * The story stage's 3D characters: one transparent canvas over the scene picture. Each character's
 * emotion, speech, emotes and held pose come from the story; lighting comes from the time of day,
 * the weather and the kind of place. A character whose model can't load is reported so the stage
 * shows its picture instead.
 */
import { AvatarConfigSchema, resolveWardrobe, wearGarments, type AvatarRecipe, type Emotion, type GarmentRecipe } from '@everloom/engine';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useReducer, useRef } from 'react';
import { avatarKeys, type AvatarDetail } from '@/features/avatars/api';
import { usePrefs3D, wantsLowDetail } from '@/features/avatars/prefs';
import { speechVisemes } from '@/features/story/tts';
import { danceRate, musicBeat, onMusicBeat } from '@/lib/tempo';
import { get, post } from '@/lib/api';
import { toastError } from '@/lib/store';
import { adultContentAllowed, lookFor } from './Preview3D';
import { useSettings } from '@/lib/queries';
import { configureMaterials } from './runtime/materials';
import { lightingFor } from './runtime/lighting';
import { loadModel, disposeLoadedModel, type LoadedModel } from './runtime/loader';
import { loadCodeModel } from './runtime/codemade/build';
import { dress } from './runtime/wardrobe';
import { usePacks } from '@/features/avatars/packs';
import { wearItems } from './parts';
import { Stage3D, type Slot } from './runtime/stage';
import { getPaired, PairedDirector } from './runtime/paired';

const debug3d = () => { try { return localStorage.getItem('everloom:debug3d') === '1'; } catch { return false; } };

export interface CastMember {
  id: string;
  /** A saved avatar; or none, with a recipe made from the character's description (code-made). */
  avatarId: string | null;
  recipe?: AvatarRecipe | null;
  slot?: Slot;
  emotion: string;
  speaking: boolean;
  emote?: { id: string; cue: string } | null;
  /** An emote the stage chose (a change of mood, a won battle); the story's own emote wins. */
  auto?: { id: string; cue: string } | null;
  pose?: string | null;
  /** The outfit the story put them in, and the names of what they have equipped. */
  outfit?: string | null;
  equipped?: string[];
  /** Equipped items in full (code-made characters wear them as generated garments). */
  wearing?: Array<{ name: string; desc?: string; category?: string; slot?: string | null; tags?: string[] }>;
}

export interface StageLayerProps {
  cast: CastMember[];
  speakerId: string | null;
  scene: { hour?: number | null; weather?: string | null; locationKind?: string | null } | null;
  onFail: (id: string, reason: string) => void;
  /** A paired animation the story started (cast ids in role order; `cue` changes each time). */
  paired?: { clip: string; who: string[]; cue: string } | null;
}

export default function StageLayer({ cast, speakerId, scene, onFail, paired = null, className, safeBottom = 0, inspect = false }: StageLayerProps & { className?: string; safeBottom?: number; inspect?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage3D | null>(null);
  const director = useRef<PairedDirector | null>(null);
  // A paired one-shot already in the story when the stage opened isn't replayed (loops are).
  const pairedPlayed = useRef<string | null>(null);
  const pairedAtOpen = useRef(paired?.cue ?? null);
  // Re-render when a model lands (a paired clip waits for all its participants).
  const [modelsLoaded, modelLoaded] = useReducer((n: number) => n + 1, 0);
  const prefs = usePrefs3D();
  const settings = useSettings();
  const adultMode = true;
  const adultModeRef = useRef(adultMode);
  adultModeRef.current = adultMode;
  const loaded = useRef(new Map<string, string>());
  // Emotes already in the story when the stage opened aren't replayed.
  const played = useRef<Map<string, string> | null>(null);
  played.current ??= new Map(cast.flatMap((c) => [...(c.emote ? [[c.id, c.emote.cue] as const] : []), ...(c.auto && c.auto.cue.startsWith('battle:') ? [[`${c.id}:auto`, c.auto.cue] as const] : [])]));
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const speakingRef = useRef<string | null>(null);

  const ids = [...new Set(cast.flatMap((c) => (c.avatarId ? [c.avatarId] : [])))];
  const details = useQueries({ queries: ids.map((id) => ({ queryKey: avatarKeys.one(id), queryFn: () => get<AvatarDetail>(`/api/avatars/${id}`), staleTime: 5 * 60_000 })) });
  const byId = new Map(details.flatMap((q) => (q.data ? [[q.data.id, q.data] as const] : [])));
  details.forEach((q, i) => {
    if (q.isError) for (const c of cast) if (c.avatarId === ids[i]) queueMicrotask(() => failRef.current(c.id, 'missing'));
  });

  useEffect(() => {
    let s: Stage3D;
    try { s = new Stage3D(canvas.current!, { quality: prefs.quality, fpsCap: prefs.fpsCap, physics: prefs.physics, outlines: prefs.outlines, transparent: true }); }
    catch (error) { for (const c of cast) failRef.current(c.id, (error as Error).message); return; }
    stage.current = s;
    director.current = new PairedDirector(s);
    director.current.onEnd = (id) => { if (canvas.current) canvas.current.dataset.paired = `done:${id}`; };
    // Development checks hold the clip at a moment to look at it; measuring runs (frame rates on a
    // production build) set `everloom:debug3d` in this browser to read the stage's stats.
    if (import.meta.env.DEV || debug3d()) Object.assign(window, { __everloomPaired: director.current, __everloomStage: s });
    s.onError = reason => { for (const id of s.ids()) failRef.current(id, reason); };
    s.setFraming('half');
    // Lip-sync: the speaker's mouth follows the voice (or a natural cycle while text types out).
    s.onFrame = () => {
      if (canvas.current) { canvas.current.dataset.state = s.ids().length ? 'ready' : 'loading'; canvas.current.dataset.avatars = s.ids().join('|'); }
      const sp = speakingRef.current;
      if (!sp) return;
      const a = s.get(sp);
      if (a?.speaking) a.visemes = speechVisemes();
    };
    const lost = (e: Event) => {
      e.preventDefault();
      for (const id of s.ids()) failRef.current(id, 'context lost');
    };
    canvas.current!.addEventListener('webglcontextlost', lost);
    s.start();
    const el = canvas.current!;
    return () => {
      el.removeEventListener('webglcontextlost', lost);
      director.current?.dispose();
      director.current = null;
      s.dispose();
      stage.current = null;
      loaded.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stage.current?.setOptions({ quality: prefs.quality, fpsCap: prefs.fpsCap, physics: prefs.physics, outlines: prefs.outlines });
  }, [prefs.quality, prefs.fpsCap, prefs.physics, prefs.outlines]);

  // Load, reload (settings changed) and remove characters.
  // What each character wears decides which model file loads (a whole-outfit model) and its parts.
  const detailOf = (c: CastMember) => (c.avatarId ? byId.get(c.avatarId) : undefined);

  // Code-made characters wear their equipped items as garments (looked up once per item name).
  const codeItems = [...new Map(cast.filter((c) => !c.avatarId || byId.get(c.avatarId)?.kind === 'code').flatMap((c) => c.wearing ?? []).map((i) => [i.name, i] as const)).values()].sort((a, b) => a.name.localeCompare(b.name));
  const garmentsQ = useQuery({
    queryKey: ['avatar-garments', codeItems.map((i) => i.name)],
    queryFn: () => post<Array<{ name: string; garment: GarmentRecipe | null }>>('/api/avatars/garments', { items: codeItems.slice(0, 12) }),
    enabled: codeItems.length > 0,
    staleTime: Infinity,
  });
  const garmentOf = new Map((garmentsQ.data ?? []).map((g) => [g.name, g.garment]));
  /** The recipe a code-made cast member is built from, wearing what they have equipped. */
  const recipeOf = (c: CastMember, base: AvatarRecipe | null | undefined): AvatarRecipe | null => {
    if (!base) return null;
    const worn = (c.wearing ?? []).flatMap((i) => (garmentOf.get(i.name) ? [garmentOf.get(i.name)!] : []));
    return worn.length ? wearGarments(base, worn) : base;
  };
  // Parts-made characters: equipped items put on matching parts of their pack.
  const packs = usePacks(cast.some((c) => detailOf(c)?.kind === 'parts'));
  const configOf = (c: CastMember) => {
    const d = detailOf(c);
    if (!d) return null;
    return d.kind === 'parts' ? wearItems(d.config, packs.data?.find((p) => p.id === d.config.maker?.pack), c.wearing ?? []) : d.config;
  };
  const dressed = new Map(cast.map((c) => [c.id, configOf(c) ? resolveWardrobe(configOf(c)!, { story: c.outfit, equipped: c.equipped }) : null]));
  const dressedRef = useRef(dressed);
  const configOfRef = useRef(configOf);
  configOfRef.current = configOf;
  dressedRef.current = dressed;
  const castKey = cast.map((c) => `${c.id}:${c.avatarId ?? JSON.stringify(c.recipe)}:${detailOf(c)?.updatedAt ?? ''}:${dressed.get(c.id)?.outfit?.model ?? JSON.stringify(dressed.get(c.id)?.outfit?.makehumanProxies ?? [])}:${(c.wearing ?? []).map((i) => (garmentOf.has(i.name) ? i.name : '')).join(',')}`).join('|');
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    const wanted = new Set(cast.map((c) => c.id));
    for (const id of s.ids()) if (!wanted.has(id)) (s.remove(id), loaded.current.delete(id));
    const low = wantsLowDetail(prefs);
    for (const c of cast) {
      const d = detailOf(c);
      // Code-made: an avatar of kind "code", or a recipe from the description (no saved avatar).
      const recipe = recipeOf(c, d ? (d.kind === 'code' ? d.config.recipe : null) : c.recipe);
      if (!d && !recipe) continue;
      const cfg = d?.config ?? AvatarConfigSchema.parse({ look: 'toon' });
      const w = dressed.get(c.id);
      const outfitModel = !recipe && w?.outfit?.model ? `/media/${(low && w.outfit.modelLow) || w.outfit.model}` : null;
      const stamp = recipe ? `code:${JSON.stringify(recipe)}:${low}` : `${d!.id}:${d!.updatedAt}:${low}:${outfitModel ?? JSON.stringify(w?.outfit?.makehumanProxies ?? [])}`;
      if (loaded.current.get(c.id) === stamp) continue;
      if (!recipe && (d!.status !== 'ready' || !d!.model)) {
        if (d!.status === 'failed') failRef.current(c.id, 'failed');
        continue;
      }
      loaded.current.set(c.id, stamp);
      const load: Promise<LoadedModel> = recipe ? loadCodeModel(recipe, { low }) : loadModel(outfitModel ?? ((low && d!.low) || d!.model!), s.renderer, { bodyShape: cfg.bodyShape, content: cfg.content, makehuman: outfitModel || !cfg.makehuman ? undefined : { ...cfg.makehuman, proxies: w?.outfit?.makehumanProxies ?? cfg.makehuman.proxies }, fallbackSource: outfitModel ? null : d!.info.conversion ? d!.model : d!.source, boneMap: cfg.boneMap, expressionMap: cfg.expressionMap, scale: cfg.scale, facing: cfg.facing, floor: cfg.floor, tints: cfg.tints });
      load
        .then(async (model) => {
          try { await configureMaterials(model.scene, { ...cfg.materialOverrides, ...dressedRef.current.get(c.id)?.outfit?.materialOverrides }); }
          catch (error) { disposeLoadedModel(model); throw error; }
          if (stage.current !== s || loaded.current.get(c.id) !== stamp) { disposeLoadedModel(model); return; }
          const a = s.add(c.id, model, { look: recipe ? 'toon' : lookFor(cfg, model), outlines: cfg.outlines, physics: cfg.physics.enabled, stiffness: cfg.physics.stiffness, gravity: cfg.physics.gravity, settings: cfg.physics, rig: cfg.rig });
          const now = dressedRef.current.get(c.id);
          if (now && !recipe) dress(a, configOfRef.current(c) ?? cfg, s.renderer, now, { low, adultAllowed: adultContentAllowed(cfg.content, adultModeRef.current) });
          s.snapCamera();
          modelLoaded();
        })
        .catch((e: Error) => {
          loaded.current.delete(c.id);
          failRef.current(c.id, e.message);
        });
    }
  }, [castKey, prefs.quality]); // eslint-disable-line react-hooks/exhaustive-deps

  // What each character is doing.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    speakingRef.current = speakerId;
    const slots: Record<string, Slot | undefined> = {};
    for (const c of cast) {
      slots[c.id] = c.slot;
      const a = s.get(c.id);
      if (!a) continue;
      a.emotion = c.emotion as Emotion;
      a.setSpeaking(c.speaking);
      const base = c.pose ?? 'idle';
      if (a.basePoseId !== base && !director.current?.has(c.id)) void a.setBase(base);
      if (c.emote && played.current!.get(c.id) !== c.emote.cue) {
        played.current!.set(c.id, c.emote.cue);
        if (c.auto) played.current!.set(`${c.id}:auto`, c.auto.cue);
        const emote = c.emote.id;
        void a.emote(emote).then(played => { if (played && canvas.current) canvas.current.dataset.emote = `${c.id}:${emote}`; if (!played) throw new Error(`The emote clip could not be loaded: ${emote}`); }).catch(toastError);
      } else if (c.auto && played.current!.get(`${c.id}:auto`) !== c.auto.cue) {
        played.current!.set(`${c.id}:auto`, c.auto.cue);
        void a.emote(c.auto.id).catch(toastError);
      }
    }
    // Outfit changes that keep the same model file: parts, regions, accessories.
    for (const c of cast) {
      const a = s.get(c.id);
      const d = detailOf(c);
      const w = dressed.get(c.id);
      if (a && d && w && d.kind !== 'code') {
        dress(a, configOf(c)!, s.renderer, w, { low: wantsLowDetail(prefs), adultAllowed: adultContentAllowed(configOf(c)!.content, adultMode) });
        void configureMaterials(a.model.scene, { ...configOf(c)!.materialOverrides, ...w.outfit?.materialOverrides }).then(() => s.kick()).catch((e: Error) => failRef.current(c.id, e.message));
      }
    }
    s.setSlots(slots, speakerId);
    s.setFraming(cast.length > 2 ? 'full' : 'half');
  });

  // Paired animations: start when every participant is on the stage; stop when the story stops it.
  useEffect(() => {
    const s = stage.current, d = director.current;
    if (!s || !d) return;
    if (!paired) {
      d.stop();
      pairedPlayed.current = null;
      return;
    }
    if (pairedPlayed.current === paired.cue || !paired.who.every((id) => s.get(id))) return;
    pairedPlayed.current = paired.cue;
    const who = paired.who;
    void getPaired(paired.clip)
      .then((def) => {
        if (!def) throw new Error(`The paired animation could not be loaded: ${paired.clip}`);
        // A one-shot from before the stage opened is over; a loop is still going.
        if (!def.loop && paired.cue === pairedAtOpen.current) return;
        if (def.adult && !who.every((id) => { const c = cast.find((x) => x.id === id); const cfg = c && configOfRef.current(c); return !!cfg && adultContentAllowed(cfg.content, adultModeRef.current); })) throw new Error(`${def.label} is for adult characters, with adult content on`);
        return d.play(def.id, who).then((ok) => { if (ok && canvas.current) canvas.current.dataset.paired = `playing:${def.id}`; });
      })
      .catch(toastError);
  }, [paired?.cue, paired?.clip, paired?.who.join('|'), modelsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    stage.current?.setSafeArea(safeBottom);
  }, [safeBottom]);

  // Dances follow the music's tempo while it plays.
  useEffect(() => {
    const apply = (b: { bpm: number } | null) => {
      const s = stage.current;
      if (!s) return;
      const rates: string[] = [];
      for (const id of s.ids()) {
        const a = s.get(id)!;
        const own = a.danceBpm;
        const r = b && own ? danceRate(own, b.bpm) : 1;
        a.setDanceRate(r);
        if (own) rates.push(`${id}:${r.toFixed(2)}`);
      }
      // What each dancer is doing, for tests and the inspector.
      if (canvas.current) canvas.current.dataset.dance = `${b?.bpm ?? ''}|${rates.join(',')}`;
    };
    apply(musicBeat());
    const t = setInterval(() => apply(musicBeat()), 2000);
    const off = onMusicBeat(apply);
    return () => {
      clearInterval(t);
      off();
    };
  }, []);

  // Look around: drag to orbit, pinch to zoom; off returns to the directed camera.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.setInspect(inspect);
    if (!inspect) s.snapCamera();
  }, [inspect]);

  useEffect(() => {
    stage.current?.setLighting(lightingFor(scene));
  }, [scene?.hour, scene?.weather, scene?.locationKind]); // eslint-disable-line react-hooks/exhaustive-deps

  // The box sets the size; the canvas fills it (a canvas sized by top/bottom alone keeps 300×150).
  return (
    <div className={className ?? 'pointer-events-none absolute inset-0'}>
      <canvas ref={canvas} data-testid="stage-3d" data-outfit={cast.map((c) => `${c.id}:${dressed.get(c.id)?.outfit?.id ?? ''}`).join('|')} data-worn={cast.map((c) => `${c.id}:${(dressed.get(c.id)?.garments ?? []).map((g) => g.garment.id).join(',')}`).join('|')} className={inspect ? 'pointer-events-auto block h-full w-full touch-none' : 'block h-full w-full'} />
    </div>
  );
}
