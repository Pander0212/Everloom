/**
 * Full-body puppets (Puppets v2) on the story stage. The cast comes from the stage: each character's
 * slot, and the avatar ops of the current message (emote, pose, outfit). Everything is derived from
 * that state, so a swipe or a rollback puts the puppets back as they were; only a new emote cue plays
 * a gesture. A character who changes slot walks there (in profile when the puppet has a side view).
 */
import { emoteCue, expressionIndex, hiddenParts, poseMotion, type Model } from '@everloom/engine/puppet2';
import { useEffect, useRef } from 'react';
import { get } from '@/lib/api';
import { Puppet2Stage, type View2, type ViewSource } from './stage';

export interface PuppetCast {
  id: string;
  puppet: string;
  slot?: string;
  emote: { id: string; cue: string } | null;
  pose: string | null;
  outfit: string | null;
  speaking?: boolean;
  emotion?: string | null;
}

interface Meta { id: string; views: View2[]; parts: Partial<Record<View2, Array<{ id: string; outfit?: string; adult?: boolean }>>> }

const X: Record<string, number> = { left: 0.18, center: 0.5, right: 0.82 };
const loads = new Map<string, Promise<{ meta: Meta; views: Partial<Record<View2, ViewSource>> }>>();

/** Loads a puppet's views once per page (models and pictures). */
export function loadPuppet(id: string) {
  let p = loads.get(id);
  if (!p) {
    p = (async () => {
      const list = await get<Meta[]>('/api/puppets2');
      const meta = list.find((m) => m.id === id);
      if (!meta) throw new Error('Puppet not found');
      const views: Partial<Record<View2, ViewSource>> = {};
      await Promise.all(meta.views.map(async (v) => {
        const model = (await (await fetch(`/api/puppets2/${id}/${v}.r2d.json`, { credentials: 'same-origin' })).json()) as Model;
        const images: Record<string, TexImageSource> = {};
        await Promise.all(model.textures.map(async (t) => {
          const blob = await (await fetch(`/api/puppets2/${id}/${t.path}`, { credentials: 'same-origin' })).blob();
          images[t.id] = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
        }));
        views[v] = { model, images };
      }));
      return { meta, views };
    })();
    p.catch(() => loads.delete(id));
    loads.set(id, p);
  }
  return p;
}

/** `safeBottom`: the fraction of the stage's height the dialog covers; the floor sits just above it. */
export default function StageLayerPuppets2({ cast, className, onFail, safeBottom = 0.3 }: { cast: PuppetCast[]; className?: string; onFail?: (id: string, reason: string) => void; safeBottom?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Puppet2Stage | null>(null);
  const seen = useRef(new Map<string, string>());
  const metas = useRef(new Map<string, Meta>());
  const fail = useRef(onFail);
  fail.current = onFail;
  // The stage hands a new array every render: apply the cast only when its content changes.
  const key = JSON.stringify(cast);

  useEffect(() => {
    try { stage.current = new Puppet2Stage(canvas.current!); }
    catch (e) { for (const c of cast) fail.current?.(c.id, (e as Error).message); return; }
    // What each puppet is doing, for the tests: id:view:base:gesture:hidden parts.
    let tick = 0;
    stage.current.onFrame = () => {
      const s = stage.current;
      if (!s || ++tick % 10) return;
      canvas.current?.setAttribute('data-state', s.ids().map((id) => { const p = s.get(id)!; return `${id}:${p.view}:${p.base.id}:${p.gesture?.id ?? ''}:${[...p.hidden].sort().join(',')}`; }).join('|'));
    };
    return () => { stage.current?.dispose(); stage.current = null; };
    // The stage lives as long as the layer; the cast is applied below.
  }, []);

  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    const cast = JSON.parse(key) as PuppetCast[];
    let live = true;
    const present = new Set(cast.filter((c) => c.slot !== 'off').map((c) => c.id));
    for (const id of s.ids()) if (!present.has(id)) { s.remove(id); seen.current.delete(id); }
    const shown = cast.filter((c) => c.slot !== 'off');
    shown.forEach((c, i) => {
      const x = c.slot && X[c.slot] !== undefined ? X[c.slot]! : (i + 1) / (shown.length + 1);
      const apply = () => {
        const p = s.get(c.id);
        if (!p) return;
        if (Math.abs(p.x - x) > 0.01 && p.walkTo === null) s.walkTo(c.id, x);
        else if (p.walkTo !== null && Math.abs(p.walkTo - x) > 0.01) s.walkTo(c.id, x);
        s.setBase(c.id, poseMotion(c.pose));
        p.speaking = !!c.speaking;
        p.expression = expressionIndex(c.emotion);
        const meta = metas.current.get(c.id);
        p.hidden = hiddenParts(meta?.parts[p.view] ?? meta?.parts.front ?? [], c.outfit);
        // A new emote cue plays once; an old one (already seen, or restored by a rollback) does not.
        const cue = c.emote ? `${c.emote.id}:${c.emote.cue}` : '';
        if (cue && seen.current.get(c.id) !== cue) {
          const k = emoteCue(c.emote!.id);
          if (k?.kind === 'gesture') s.gesture(c.id, k.motion);
          else if (k?.kind === 'base') s.setBase(c.id, k.motion);
          else if (k?.kind === 'walk') { if (k.to === 'out') s.walkTo(c.id, x < 0.5 ? 0.05 : 0.95); else { p.x = x < 0.5 ? 0.05 : 0.95; s.walkTo(c.id, x); } }
        }
        seen.current.set(c.id, cue);
      };
      if (s.get(c.id)) { apply(); return; }
      loadPuppet(c.puppet).then(({ meta, views }) => {
        if (!live || !stage.current || s.get(c.id)) return;
        metas.current.set(c.id, meta);
        s.add(c.id, views, { x, height: (1 - safeBottom) * 0.86, floor: 1 - safeBottom + 0.03 });
        // Cues present when the puppet appears belong to the past: remember, don't replay.
        seen.current.set(c.id, c.emote ? `${c.emote.id}:${c.emote.cue}` : '');
        apply();
      }).catch((e: Error) => fail.current?.(c.id, e.message));
    });
    return () => { live = false; };
  }, [key]);

  return <canvas ref={canvas} data-testid="stage-puppets2" className={className} />;
}
