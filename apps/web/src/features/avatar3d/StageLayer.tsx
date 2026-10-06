/**
 * The story stage's 3D characters: one transparent canvas over the scene picture. Each character's
 * emotion, speech, emotes and held pose come from the story; lighting comes from the time of day,
 * the weather and the kind of place. A character whose model can't load is reported so the stage
 * shows its picture instead.
 */
import { AvatarConfigSchema, resolveWardrobe, wearGarments, type AvatarRecipe, type Emotion, type GarmentRecipe } from '@everloom/engine';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { avatarKeys, type AvatarDetail } from '@/features/avatars/api';
import { usePrefs3D, wantsLowDetail } from '@/features/avatars/prefs';
import { speechVisemes } from '@/features/story/tts';
import { danceRate, musicBeat, onMusicBeat } from '@/lib/tempo';
import { get, post } from '@/lib/api';
import { lookFor } from './Preview3D';
import { lightingFor } from './runtime/lighting';
import { loadModel, type LoadedModel } from './runtime/loader';
import { loadCodeModel } from './runtime/codemade/build';
import { dress } from './runtime/wardrobe';
import { Stage3D, type Slot } from './runtime/stage';

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
}

export default function StageLayer({ cast, speakerId, scene, onFail, className, safeBottom = 0, inspect = false }: StageLayerProps & { className?: string; safeBottom?: number; inspect?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage3D | null>(null);
  const prefs = usePrefs3D();
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
    const s = new Stage3D(canvas.current!, { quality: prefs.quality, fpsCap: prefs.fpsCap, physics: prefs.physics, outlines: prefs.outlines, transparent: true });
    stage.current = s;
    s.setFraming('half');
    // Lip-sync: the speaker's mouth follows the voice (or a natural cycle while text types out).
    s.onFrame = () => {
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
  const dressed = new Map(cast.map((c) => [c.id, detailOf(c) ? resolveWardrobe(detailOf(c)!.config, { story: c.outfit, equipped: c.equipped }) : null]));
  const dressedRef = useRef(dressed);
  dressedRef.current = dressed;
  const castKey = cast.map((c) => `${c.id}:${c.avatarId ?? JSON.stringify(c.recipe)}:${detailOf(c)?.updatedAt ?? ''}:${dressed.get(c.id)?.outfit?.model ?? ''}:${(c.wearing ?? []).map((i) => (garmentOf.has(i.name) ? i.name : '')).join(',')}`).join('|');
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
      const stamp = recipe ? `code:${JSON.stringify(recipe)}:${low}` : `${d!.id}:${d!.updatedAt}:${low}:${outfitModel ?? ''}`;
      if (loaded.current.get(c.id) === stamp) continue;
      if (!recipe && (d!.status !== 'ready' || !d!.model)) {
        if (d!.status === 'failed') failRef.current(c.id, 'failed');
        continue;
      }
      loaded.current.set(c.id, stamp);
      const load: Promise<LoadedModel> = recipe ? loadCodeModel(recipe, { low }) : loadModel(outfitModel ?? ((low && d!.low) || d!.model!), s.renderer, { boneMap: cfg.boneMap, expressionMap: cfg.expressionMap, scale: cfg.scale, facing: cfg.facing, floor: cfg.floor });
      load
        .then((model) => {
          if (stage.current !== s || loaded.current.get(c.id) !== stamp) return;
          const a = s.add(c.id, model, { look: recipe ? 'toon' : lookFor(cfg, model), outlines: cfg.outlines, physics: cfg.physics.enabled });
          a.options.stiffness = cfg.physics.stiffness;
          a.options.gravity = cfg.physics.gravity;
          const now = dressedRef.current.get(c.id);
          if (now && !recipe) dress(a, cfg, s.renderer, now);
          s.snapCamera();
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
      if (a.basePoseId !== base) void a.setBase(base);
      if (c.emote && played.current!.get(c.id) !== c.emote.cue) {
        played.current!.set(c.id, c.emote.cue);
        if (c.auto) played.current!.set(`${c.id}:auto`, c.auto.cue);
        void a.emote(c.emote.id);
      } else if (c.auto && played.current!.get(`${c.id}:auto`) !== c.auto.cue) {
        played.current!.set(`${c.id}:auto`, c.auto.cue);
        void a.emote(c.auto.id);
      }
    }
    // Outfit changes that keep the same model file: parts, regions, accessories.
    for (const c of cast) {
      const a = s.get(c.id);
      const d = detailOf(c);
      const w = dressed.get(c.id);
      if (a && d && w && d.kind !== 'code') dress(a, d.config, s.renderer, w);
    }
    s.setSlots(slots, speakerId);
    s.setFraming(cast.length > 2 ? 'full' : 'half');
  });

  useEffect(() => {
    stage.current?.setSafeArea(safeBottom);
  }, [safeBottom]);

  // Dances follow the music's tempo while it plays.
  useEffect(() => {
    const apply = (b: { bpm: number } | null) => {
      const s = stage.current;
      if (!s) return;
      for (const id of s.ids()) {
        const a = s.get(id)!;
        const own = a.danceBpm;
        a.setDanceRate(b && own ? danceRate(own, b.bpm) : 1);
      }
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
      <canvas ref={canvas} data-testid="stage-3d" className={inspect ? 'pointer-events-auto block h-full w-full touch-none' : 'block h-full w-full'} />
    </div>
  );
}
