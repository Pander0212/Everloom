/**
 * The story stage's 3D characters: one transparent canvas over the scene picture. Each character's
 * emotion, speech, emotes and held pose come from the story; lighting comes from the time of day,
 * the weather and the kind of place. A character whose model can't load is reported so the stage
 * shows its picture instead.
 */
import type { Emotion } from '@everloom/engine';
import { useQueries } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { avatarKeys, type AvatarDetail } from '@/features/avatars/api';
import { usePrefs3D, wantsLowDetail } from '@/features/avatars/prefs';
import { speechVisemes } from '@/features/story/tts';
import { get } from '@/lib/api';
import { lookFor } from './Preview3D';
import { lightingFor } from './runtime/lighting';
import { loadModel } from './runtime/loader';
import { Stage3D, type Slot } from './runtime/stage';

export interface CastMember {
  id: string;
  avatarId: string;
  slot?: Slot;
  emotion: string;
  speaking: boolean;
  emote?: { id: string; cue: string } | null;
  pose?: string | null;
}

export interface StageLayerProps {
  cast: CastMember[];
  speakerId: string | null;
  scene: { hour?: number | null; weather?: string | null; locationKind?: string | null } | null;
  onFail: (id: string, reason: string) => void;
}

export default function StageLayer({ cast, speakerId, scene, onFail, className, safeBottom = 0 }: StageLayerProps & { className?: string; safeBottom?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Stage3D | null>(null);
  const prefs = usePrefs3D();
  const loaded = useRef(new Map<string, string>());
  // Emotes already in the story when the stage opened aren't replayed.
  const played = useRef<Map<string, string> | null>(null);
  played.current ??= new Map(cast.flatMap((c) => (c.emote ? [[c.id, c.emote.cue] as const] : [])));
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const speakingRef = useRef<string | null>(null);

  const ids = [...new Set(cast.map((c) => c.avatarId))];
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
  const castKey = cast.map((c) => `${c.id}:${c.avatarId}:${byId.get(c.avatarId)?.updatedAt ?? ''}`).join('|');
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    const wanted = new Set(cast.map((c) => c.id));
    for (const id of s.ids()) if (!wanted.has(id)) (s.remove(id), loaded.current.delete(id));
    const low = wantsLowDetail(prefs);
    for (const c of cast) {
      const d = byId.get(c.avatarId);
      if (!d) continue;
      const stamp = `${d.id}:${d.updatedAt}:${low}`;
      if (loaded.current.get(c.id) === stamp) continue;
      if (d.status !== 'ready' || !d.model) {
        if (d.status === 'failed') failRef.current(c.id, 'failed');
        continue;
      }
      loaded.current.set(c.id, stamp);
      const cfg = d.config;
      loadModel((low && d.low) || d.model, s.renderer, { boneMap: cfg.boneMap, expressionMap: cfg.expressionMap, scale: cfg.scale, facing: cfg.facing, floor: cfg.floor })
        .then((model) => {
          if (stage.current !== s || loaded.current.get(c.id) !== stamp) return;
          const a = s.add(c.id, model, { look: lookFor(cfg, model), outlines: cfg.outlines, physics: cfg.physics.enabled });
          a.options.stiffness = cfg.physics.stiffness;
          a.options.gravity = cfg.physics.gravity;
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
        void a.emote(c.emote.id);
      }
    }
    s.setSlots(slots, speakerId);
    s.setFraming(cast.length > 2 ? 'full' : 'half');
  });

  useEffect(() => {
    stage.current?.setSafeArea(safeBottom);
  }, [safeBottom]);

  useEffect(() => {
    stage.current?.setLighting(lightingFor(scene));
  }, [scene?.hour, scene?.weather, scene?.locationKind]); // eslint-disable-line react-hooks/exhaustive-deps

  // The box sets the size; the canvas fills it (a canvas sized by top/bottom alone keeps 300×150).
  return (
    <div className={className ?? 'pointer-events-none absolute inset-0'}>
      <canvas ref={canvas} data-testid="stage-3d" className="block h-full w-full" />
    </div>
  );
}
