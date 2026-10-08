/**
 * Skin: skin tone, hair and eye colours (they change at once), and skin layers: makeup, body paint,
 * tattoos, tight underwear and swimwear, stockings and scars, painted onto the skin texture. A layer
 * is a whole image in the body's UV layout, or an image placed by tapping the body (a tattoo).
 * Clothing layers are wardrobe items: outfits and equipped inventory items put them on.
 */
import { AppearanceSchema, CLOTHING_LAYER_KINDS, GARMENT_SLOTS, SKIN_LAYER_KINDS, type AvatarConfig, type SkinLayer, type SkinLayerKind } from '@everloom/engine';
import { Crosshair, ImagePlus, Paintbrush, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { upload } from '@/lib/api';
import { useSettings } from '@/lib/queries';
import { cx } from '@/lib/format';
import { Badge, Button, Checkbox, Field, FileButton, IconButton, Input, SectionTitle, Select, Slider, Switch } from '@/ui';
import type { PreviewHandle } from '../Preview3D';
import { adultContentAllowed } from '../Preview3D';
import { pickSkin } from '../runtime/decal';

const KIND_LABEL: Record<SkinLayerKind, string> = { makeup: 'Makeup', paint: 'Body paint', tattoo: 'Tattoo', underwear: 'Underwear', swimwear: 'Swimwear', stockings: 'Stockings', scar: 'Scar' };
const newId = (prefix: string, taken: string[]) => { for (let i = 1; ; i++) if (!taken.includes(`${prefix}${i}`)) return `${prefix}${i}`; };
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 16);

function ColourField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={label} className="h-9 w-12 cursor-pointer rounded border border-line bg-transparent" value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} />
        {value ? <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Original</Button> : <span className="text-xs text-fg-2">Original</span>}
      </div>
    </Field>
  );
}

export function SkinStep({ config, set, handle }: { config: AvatarConfig; set: (p: Partial<AvatarConfig>) => void; handle: PreviewHandle | null }) {
  const settings = useSettings();
  const adultAllowed = adultContentAllowed(config.content, settings.data?.library.nsfw === true);
  const appearance = config.appearance ?? AppearanceSchema.parse({});
  const setAppearance = (p: Partial<typeof appearance>) => set({ appearance: { ...appearance, ...p } });
  const [open, setOpen] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const layers = config.skinLayers;
  const setLayer = (id: string, p: Partial<SkinLayer>) => set({ skinLayers: layers.map((l) => (l.id === id ? { ...l, ...p } : l)) });
  const latest = useRef({ layers, set }); latest.current = { layers, set };

  // Tap (or click) the body to place the decal; drag to move it.
  useEffect(() => {
    if (!placing || !handle) return;
    const canvas = handle.stage.canvas;
    handle.stage.setOrbitEnabled(false);
    let down = false, last = 0;
    const place = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const hit = pickSkin(handle.stage.camera, handle.model.scene, ndc, appearance.skinMeshes.length ? appearance.skinMeshes : config.body);
      if (!hit) return;
      const { layers, set } = latest.current;
      set({ skinLayers: layers.map((l) => (l.id === placing ? { ...l, decal: { size: 8, rotation: 0, ...l.decal, ...hit.decal } } : l)) });
    };
    const onDown = (e: PointerEvent) => { down = true; e.preventDefault(); place(e); };
    const onMove = (e: PointerEvent) => { if (!down || performance.now() - last < 90) return; last = performance.now(); place(e); };
    const onUp = () => { down = false; };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); handle.stage.setOrbitEnabled(true); };
  }, [placing, handle]); // eslint-disable-line react-hooks/exhaustive-deps

  const addLayer = async (files: File[], kind: SkinLayerKind) => {
    const file = files[0];
    if (!file) return;
    setBusy(true); setError(null);
    try {
      if (file.size > 20 * 1024 * 1024 || !/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error('Choose a PNG, JPEG or WebP image smaller than 20 MB (PNG keeps transparency).');
      const media = await upload<{ id: string }>('/api/media', file, { kind: 'model-texture' });
      const id = newId('layer', layers.map((l) => l.id));
      const decal = kind === 'tattoo' || kind === 'scar' || kind === 'makeup';
      set({ skinLayers: [...layers, { id, name: file.name.replace(/\.[^.]+$/, '').slice(0, 60) || KIND_LABEL[kind], kind, image: media.id, normal: null, roughness: null, tint: null, opacity: 1, decal: null, on: true, slot: CLOTHING_LAYER_KINDS.includes(kind) ? (kind === 'stockings' ? 'socks' as const : 'underwear' as const) : null, items: [], adult: false }].slice(0, 32) });
      setOpen(id);
      if (decal) setPlacing(id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const [newKind, setNewKind] = useState<SkinLayerKind>('tattoo');

  return (
    <div className="flex flex-col gap-4" data-testid="skin-step">
      <SectionTitle>Colours</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <ColourField label="Skin tone" value={appearance.skinTone} onChange={(v) => setAppearance({ skinTone: v })} />
        <ColourField label="Eyes" value={appearance.eyes.color} onChange={(v) => setAppearance({ eyes: { ...appearance.eyes, color: v } })} />
        <ColourField label="Hair" value={appearance.hair.color} onChange={(v) => setAppearance({ hair: { ...appearance.hair, color: v } })} />
        <ColourField label="Hair tips (gradient)" value={appearance.hair.tip} onChange={(v) => setAppearance({ hair: { ...appearance.hair, tip: v } })} />
        <ColourField label="Hair highlight" value={appearance.hair.highlight} onChange={(v) => setAppearance({ hair: { ...appearance.hair, highlight: v } })} />
      </div>
      <p className="text-xs text-fg-2">Hair is found by name (hair, ponytail, braid) and includes hair garments; garment colours are in the Wardrobe.</p>

      <SectionTitle>Skin layers</SectionTitle>
      <p className="text-sm text-fg-2">Painted onto the skin texture once, so they cost nothing while playing. Whole images use the body's UV layout (the template that came with the base); tattoos, scars and makeup are placed by tapping the body. Underwear, swimwear and stockings act as clothing: outfits and equipped items put them on.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Kind"><Select aria-label="New layer kind" value={newKind} onChange={(e) => setNewKind(e.target.value as SkinLayerKind)}>{SKIN_LAYER_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></Field>
        <FileButton icon={ImagePlus} loading={busy} disabled={!handle} onFiles={(f) => void addLayer(f, newKind)} data-testid="layer-add">Add an image</FileButton>
        <Button variant="secondary" icon={Paintbrush} onClick={() => { const id = newId('layer', layers.map((l) => l.id)); set({ skinLayers: [...layers, { id, name: 'Body paint', kind: 'paint', image: null, normal: null, roughness: null, tint: '#3a6ea5', opacity: 0.35, decal: null, on: true, slot: null, items: [], adult: false }] }); setOpen(id); }}>Plain colour wash</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
      {layers.map((l) => (
        <details key={l.id} open={open === l.id} onToggle={(e) => (e.currentTarget.open ? setOpen(l.id) : open === l.id && setOpen(null))} className="rounded-md border border-line" data-testid="skin-layer">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
            <span className="flex-1">{l.name}</span>
            <Badge>{KIND_LABEL[l.kind]}</Badge>
            {l.adult ? <Badge tone="warning">Adults</Badge> : null}
            <Switch checked={l.on} onChange={(v) => setLayer(l.id, { on: v })} label={`${l.name} shown`} />
          </summary>
          <div className="flex flex-col gap-3 border-t border-line p-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name"><Input aria-label="Layer name" value={l.name} maxLength={60} onChange={(e) => setLayer(l.id, { name: e.target.value || KIND_LABEL[l.kind] })} /></Field>
              <Field label="Kind"><Select aria-label="Layer kind" value={l.kind} onChange={(e) => setLayer(l.id, { kind: e.target.value as SkinLayerKind })}>{SKIN_LAYER_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ColourField label="Tint" value={l.tint} onChange={(v) => setLayer(l.id, { tint: v })} />
              <Field label={`Opacity (${Math.round(l.opacity * 100)}%)`}><Slider label={`${l.name} opacity`} min={0} max={1} step={0.01} value={l.opacity} onChange={(v) => setLayer(l.id, { opacity: v })} /></Field>
            </div>
            {l.image ? (
              <Field label="Placement">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={!l.decal ? 'primary' : 'secondary'} onClick={() => { setLayer(l.id, { decal: null }); setPlacing(null); }}>Whole body texture</Button>
                  <Button size="sm" icon={Crosshair} variant={placing === l.id ? 'primary' : 'secondary'} onClick={() => setPlacing(placing === l.id ? null : l.id)} data-testid="layer-place">{placing === l.id ? 'Done placing' : l.decal ? 'Move by tapping' : 'Place by tapping the body'}</Button>
                </div>
              </Field>
            ) : null}
            {placing === l.id ? <p role="status" className={cx('rounded-md bg-accent/10 p-2 text-sm')}>Tap or click the body in the preview to put it there; drag to move it.</p> : null}
            {l.decal ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label={`Size (${l.decal.size.toFixed(1)} cm)`}><Slider label={`${l.name} size`} min={1} max={60} step={0.5} value={l.decal.size} onChange={(v) => setLayer(l.id, { decal: { ...l.decal!, size: v } })} /></Field>
                <Field label={`Rotation (${Math.round(l.decal.rotation)}°)`}><Slider label={`${l.name} rotation`} min={-180} max={180} step={1} value={l.decal.rotation} onChange={(v) => setLayer(l.id, { decal: { ...l.decal!, rotation: v } })} /></Field>
              </div>
            ) : null}
            {CLOTHING_LAYER_KINDS.includes(l.kind) ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Stands for"><Select aria-label="Layer slot" value={l.slot ?? ''} onChange={(e) => setLayer(l.id, { slot: (e.target.value || null) as SkinLayer['slot'] })}><option value="">No slot</option>{GARMENT_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
                <Field label="Put on by these items"><Input aria-label="Layer items" defaultValue={l.items.join(', ')} onBlur={(e) => setLayer(l.id, { items: list(e.target.value) })} /></Field>
              </div>
            ) : null}
            {config.content.adult ? <Checkbox label="Adult-rated image (shown only in adult mode)" checked={l.adult} onChange={(v) => setLayer(l.id, { adult: v })} /> : null}
            {l.adult && !adultAllowed ? <p className="text-xs text-fg-2">Hidden here: adult mode is off or this character isn't confirmed as an adult.</p> : null}
            <div className="flex justify-end"><IconButton icon={Trash2} label={`Delete ${l.name}`} tone="danger" onClick={() => { if (placing === l.id) setPlacing(null); set({ skinLayers: layers.filter((x) => x.id !== l.id), outfits: config.outfits.map((o) => ({ ...o, layers: o.layers?.filter((x) => x !== l.id) })) }); }} /></div>
          </div>
        </details>
      ))}
    </div>
  );
}
