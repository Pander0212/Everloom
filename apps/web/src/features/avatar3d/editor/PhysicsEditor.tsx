/**
 * Hair, cloth and chest physics: how springy, how fast motion dies down, wind, the chest's strength
 * and off switch, extra bone chains to swing, and the body colliders (shown over the model while
 * editing; each can be made bigger or smaller, or switched off).
 */
import { CHAIN_KINDS, type AvatarConfig, type ChainKind, type ColliderEdit, type HumanBone } from '@everloom/engine';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Checkbox, Field, SectionTitle, Select, Slider, Switch } from '@/ui';
import type { PreviewHandle } from '../Preview3D';
import { ColliderOverlay } from '../runtime/physics/colliders';

const COLLIDER_LABEL: Partial<Record<HumanBone, string>> = { head: 'Head', spine: 'Back and belly', upperChest: 'Shoulders', hips: 'Hips', leftUpperLeg: 'Left thigh', rightUpperLeg: 'Right thigh', leftLowerLeg: 'Left shin', rightLowerLeg: 'Right shin', leftUpperArm: 'Left upper arm', rightUpperArm: 'Right upper arm' };
const CHAIN_LABEL: Record<ChainKind, string> = { hair: 'Hair', tail: 'Tail', cloth: 'Cloth', chest: 'Chest', accessory: 'Accessory' };

export function PhysicsEditor({ config, set, handle }: { config: AvatarConfig; set: (p: Partial<AvatarConfig>) => void; handle: PreviewHandle | null }) {
  const physics = config.physics;
  const patch = (p: Partial<AvatarConfig['physics']>) => set({ physics: { ...physics, ...p } });
  const [show, setShow] = useState(false);

  // The collider overlay, following the body every frame while it's shown.
  useEffect(() => {
    if (!show || !handle) return;
    const overlay = new ColliderOverlay(handle.avatar.colliders());
    handle.stage.scene.add(overlay.group);
    const tick = () => overlay.update();
    handle.stage.tickers.add(tick);
    handle.stage.kick();
    return () => { handle.stage.tickers.delete(tick); overlay.dispose(); handle.stage.kick(); };
  }, [show, handle]);

  // Bones that could swing: outside the humanoid, with a child to point at.
  const candidates = useMemo(() => {
    if (!handle) return [];
    const mapped = new Set(Object.values(handle.model.bones).map((b) => b?.name));
    const auto = new Set(handle.model.secondaryChains.map((c) => c[0]!.name));
    const out: Array<{ name: string; auto: boolean }> = [];
    handle.model.scene.traverse((o) => {
      if (!(o as { isBone?: boolean }).isBone || mapped.has(o.name) || /^EvSwing/.test(o.name)) return;
      if (!o.children.some((c) => (c as { isBone?: boolean }).isBone) && !auto.has(o.name)) return;
      // Only chain starts: a parent that is itself a candidate makes this one part of its chain.
      if (o.parent && !mapped.has(o.parent.name) && (o.parent as { isBone?: boolean }).isBone) return;
      out.push({ name: o.name, auto: auto.has(o.name) });
    });
    return out.slice(0, 40);
  }, [handle]);

  const colliders = handle?.avatar.colliders() ?? [];
  const edit = (bone: HumanBone, p: Partial<ColliderEdit>) => {
    const rest = physics.colliders.filter((c) => c.bone !== bone);
    const current = physics.colliders.find((c) => c.bone === bone) ?? { bone, radius: 1, offset: [0, 0, 0] as [number, number, number], on: true };
    patch({ colliders: [...rest, { ...current, ...p }] });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="physics-editor">
      <Field label={`Motion dies down (${Math.round(physics.damping * 100)}%)`} hint="Low: hair and cloth keep swinging; high: they settle at once.">
        <Slider label="Damping" min={0} max={1} step={0.05} value={physics.damping} onChange={(v) => patch({ damping: v })} />
      </Field>
      <Field label={`Wind (${physics.wind.toFixed(1)})`} hint="A gentle, gusting breeze on hair and loose cloth.">
        <Slider label="Wind" min={0} max={2} step={0.1} value={physics.wind} onChange={(v) => patch({ wind: v })} />
      </Field>

      <SectionTitle>Chest</SectionTitle>
      {handle && !handle.avatar.hasChestBones ? <p className="text-sm text-fg-2">This model has no chest (breast) bones, so there's nothing to swing. A base exported with breast bones gets chest motion.</p> : (
        <>
          <label className="flex items-center justify-between gap-3 text-sm"><span>Chest motion</span><Switch checked={physics.chest.enabled} onChange={(v) => patch({ chest: { ...physics.chest, enabled: v } })} label="Chest motion" /></label>
          {physics.chest.enabled ? <Field label={`Strength (${Math.round(physics.chest.strength * 100)}%)`}><Slider label="Chest strength" min={0} max={2} step={0.05} value={physics.chest.strength} onChange={(v) => patch({ chest: { ...physics.chest, strength: v } })} /></Field> : null}
        </>
      )}

      <SectionTitle>Swinging bones</SectionTitle>
      {!candidates.length ? <p className="text-sm text-fg-2">No extra bone chains in this model. Hair and skirts fitted in the Wardrobe get their own chains.</p> : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-fg-2">Bones outside the body's skeleton that can swing: hair, tails, ribbons, skirt bones. The ones found by name already swing.</p>
          {candidates.map((c) => {
            const pick = physics.chains.find((p) => p.bone === c.name);
            return (
              <div key={c.name} className="flex flex-wrap items-center gap-2">
                <Checkbox label={c.name} checked={c.auto || !!pick?.on} disabled={c.auto} onChange={(v) => patch({ chains: v ? [...physics.chains.filter((p) => p.bone !== c.name), { bone: c.name, kind: pick?.kind ?? 'hair', on: true, settings: {} }] : physics.chains.filter((p) => p.bone !== c.name) })} />
                {c.auto ? <Badge>Found by name</Badge> : null}
                {pick ? <Select aria-label={`Kind of ${c.name}`} value={pick.kind} className="h-8 w-auto py-0 text-xs" onChange={(e) => patch({ chains: physics.chains.map((p) => (p.bone === c.name ? { ...p, kind: e.target.value as ChainKind } : p)) })}>{CHAIN_KINDS.map((k) => <option key={k} value={k}>{CHAIN_LABEL[k]}</option>)}</Select> : null}
              </div>
            );
          })}
          <p className="text-xs text-fg-2">Changes to chains apply when the model loads again (Save, then reopen).</p>
        </div>
      )}

      <SectionTitle>Colliders</SectionTitle>
      <p className="text-sm text-fg-2">Spheres and capsules on the body that hair and cloth slide around. They're measured from this body; make one bigger if hair passes into the shoulders, smaller if a skirt floats.</p>
      <label className="flex items-center justify-between gap-3 text-sm"><span>Show colliders</span><Switch checked={show} onChange={setShow} label="Show colliders" /></label>
      <div className="flex flex-col gap-2" data-testid="collider-list">
        {colliders.map((c) => {
          const bone = c.label as HumanBone;
          const e = physics.colliders.find((x) => x.bone === bone);
          return (
            <div key={bone} className="grid grid-cols-[1fr_auto] items-center gap-2">
              <Field label={`${COLLIDER_LABEL[bone] ?? bone} (${Math.round(c.radius * 100)} cm${(e?.radius ?? 1) !== 1 ? `, ${Math.round((e?.radius ?? 1) * 100)}%` : ''})`}>
                <Slider label={`${COLLIDER_LABEL[bone] ?? bone} size`} min={0.3} max={2} step={0.05} value={e?.radius ?? 1} onChange={(v) => edit(bone, { radius: v })} />
              </Field>
              <Switch checked={e?.on ?? true} onChange={(v) => edit(bone, { on: v })} label={`${COLLIDER_LABEL[bone] ?? bone} collider on`} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
