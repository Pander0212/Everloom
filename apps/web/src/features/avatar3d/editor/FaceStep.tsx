/** Step 3: which face shapes make each expression, mouth shape and blink. */
import { EMOTIONS, FACE_CONTROLS, VISEMES, type AvatarConfig, type CanonicalExpression, type MorphWeight } from '@everloom/engine';
import { Eye, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AvatarDetail } from '@/features/avatars/api';
import { Button, IconButton, SectionTitle, Select } from '@/ui';
import type { PreviewHandle } from '../Preview3D';

const GROUPS: Array<{ label: string; items: readonly CanonicalExpression[] }> = [
  { label: 'Expressions', items: EMOTIONS },
  { label: 'Mouth shapes (lip-sync)', items: [...VISEMES, 'jawOpen'] },
  { label: 'Eyes', items: FACE_CONTROLS.filter((f) => f !== 'jawOpen') },
];
const NAMES: Partial<Record<CanonicalExpression, string>> = { aa: 'A (ah)', ih: 'I (ee)', ou: 'U (oo)', ee: 'E (eh)', oh: 'O (oh)', jawOpen: 'Jaw open', blink: 'Blink', blinkLeft: 'Blink left', blinkRight: 'Blink right' };
const nice = (e: CanonicalExpression) => NAMES[e] ?? e.charAt(0).toUpperCase() + e.slice(1);

export function FaceStep({ avatar, config, set, handle }: { avatar: AvatarDetail; config: AvatarConfig; set: (p: Partial<AvatarConfig>) => void; handle: PreviewHandle | null }) {
  const morphs = [...(avatar.info.vrmExpressions ?? []).map((e) => `vrm:${e}`), ...(avatar.info.morphs ?? [])];
  const [showing, setShowing] = useState<CanonicalExpression | null>(null);

  // Preview: hold the chosen expression's weights on the face.
  useEffect(() => {
    if (!handle) return;
    if (!showing) {
      handle.avatar.faceOverride = null;
      return;
    }
    const w: Record<string, number> = {};
    for (const m of config.expressionMap[showing] ?? []) w[m.morph] = m.weight;
    handle.avatar.faceOverride = w;
    handle.stage.setFraming('portrait');
    handle.stage.kick();
  }, [handle, showing, config.expressionMap]);
  useEffect(() => () => void (handle && (handle.avatar.faceOverride = null)), [handle]);

  const update = (e: CanonicalExpression, list: MorphWeight[]) => {
    const next = { ...config.expressionMap };
    if (list.length) next[e] = list;
    else delete next[e];
    set({ expressionMap: next });
  };

  if (!morphs.length) {
    return <p className="text-sm text-fg-2">This model has no face shapes (morph targets or VRM expressions), so its face stays still. The body still moves and talks with gestures.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-fg-2">Tap the eye to see an expression on the model. Expressions without a shape fall back to a similar one.</p>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => set({ expressionMap: avatar.info.expressionMap ?? {} })}>
          Automatic
        </Button>
      </div>
      {GROUPS.map((g) => (
        <section key={g.label}>
          <SectionTitle>{g.label}</SectionTitle>
          <div className="flex flex-col gap-2">
            {g.items.map((e) => {
              const list = config.expressionMap[e] ?? [];
              return (
                <div key={e} className="rounded-md border border-line p-2">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-sm font-medium">{nice(e)}</span>
                    <IconButton size="sm" icon={Eye} label={`Show ${nice(e)}`} active={showing === e} onClick={() => setShowing(showing === e ? null : e)} />
                    <IconButton size="sm" icon={Plus} label={`Add a shape to ${nice(e)}`} onClick={() => update(e, [...list, { morph: morphs[0]!, weight: 1 }])} disabled={list.length >= 6} />
                  </div>
                  {list.map((m, i) => (
                    <div key={i} className="mt-1.5 grid grid-cols-[1fr_4.5rem_auto] items-center gap-2">
                      <Select aria-label={`${nice(e)} shape ${i + 1}`} value={m.morph} onChange={(ev) => update(e, list.map((x, j) => (j === i ? { ...x, morph: ev.target.value } : x)))} className="h-9 py-0 text-sm">
                        {!morphs.includes(m.morph) ? <option value={m.morph}>{m.morph} (missing)</option> : null}
                        {morphs.map((n) => (
                          <option key={n} value={n}>
                            {n.startsWith('vrm:') ? `VRM: ${n.slice(4)}` : n}
                          </option>
                        ))}
                      </Select>
                      <input
                        type="number"
                        aria-label={`${nice(e)} shape ${i + 1} strength`}
                        className="field h-9 py-0 text-sm"
                        min={0}
                        max={1.5}
                        step={0.05}
                        value={m.weight}
                        onChange={(ev) => update(e, list.map((x, j) => (j === i ? { ...x, weight: Math.max(-1, Math.min(2, Number(ev.target.value) || 0)) } : x)))}
                      />
                      <IconButton size="sm" icon={X} label="Remove" onClick={() => update(e, list.filter((_, j) => j !== i))} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
