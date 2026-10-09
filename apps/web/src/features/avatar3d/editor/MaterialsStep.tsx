/** VRoid's exported clothing templates are material slots, changed with ordinary image files. */
import type { AvatarConfig } from '@everloom/engine';
import { useEffect, useState } from 'react';
import { upload } from '@/lib/api';
import { toastError } from '@/lib/store';
import { Button, Field, FileButton, Input, Select } from '@/ui';
import type { PreviewHandle } from '../Preview3D';

const slot = (name: string) => /hair/i.test(name) ? 'Hair' : /eye|iris/i.test(name) ? 'Eyes' : /skin|body/i.test(name) ? 'Skin / body template' : /shoe|boot/i.test(name) ? 'Shoes' : /pants|bottom|skirt/i.test(name) ? 'Bottoms' : /onepiece|dress/i.test(name) ? 'One-piece' : /cloth|top|shirt|coat/i.test(name) ? 'Clothing' : 'Choose manually';
export function MaterialsStep({ config, set, handle }: { config: AvatarConfig; set: (p: Partial<AvatarConfig>) => void; handle: PreviewHandle | null }) {
  const names = [...new Set((handle?.model.meshes ?? []).flatMap(m => (Array.isArray(m.material) ? m.material : [m.material]).filter(x => !(x as { isOutline?: boolean }).isOutline).map(x => x.name.replace(/ \((?:toon|pbr)\)$/, ''))))].filter(Boolean);
  const [material, setMaterial] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [variant, setVariant] = useState('Clothing variant'), [items, setItems] = useState('');
  useEffect(() => { if (names.length && !names.includes(material)) setMaterial(names.find(n => /cloth|top|shirt|coat/i.test(n)) ?? names[0]); }, [names.join('|'), material]);
  const value = config.materialOverrides[material] ?? {};
  const change = (patch: Partial<typeof value>) => set({ materialOverrides: { ...config.materialOverrides, [material]: { ...value, ...patch } } });
  /** A Unity material (.mat), with its texture dropped alongside: applied to the slot of the same name. */
  const unityMaterial = async (files: File[]) => {
    const { projectFromFiles, readMaterial, text } = await import('@everloom/engine/unity');
    const p = projectFromFiles(await Promise.all(files.map(async f => ({ path: f.name, data: new Uint8Array(await f.arrayBuffer()) }))));
    const asset = p.all('material')[0];
    const spec = asset ? readMaterial(text(asset.data)) : null;
    if (!asset || !spec) throw new Error('That .mat file could not be read.');
    const target = names.find(n => n.toLowerCase() === spec.name.toLowerCase()) ?? material;
    if (!target) throw new Error('Choose the material slot first.');
    const tex = spec.map ? p.get(spec.map.ref.guid) ?? p.guess(asset.path, 'texture', spec.name, '_MainTex') : undefined;
    let texture: string | undefined;
    if (tex?.data && /\.(png|jpe?g|webp)$/i.test(tex.path)) texture = (await upload<{ id: string }>('/api/media', new File([tex.data as BlobPart], tex.path.split('/').pop()!), { kind: 'model-texture' })).id;
    const hex = '#' + spec.color.slice(0, 3).map(c => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('');
    const prev = config.materialOverrides[target] ?? {};
    set({ materialOverrides: { ...config.materialOverrides, [target]: { ...prev, ...(texture ? { texture } : {}), color: hex, alpha: spec.alpha === 'cutout' ? 'mask' : spec.alpha === 'transparent' ? 'blend' : 'opaque' } } });
    setMaterial(target);
    if (spec.map && !texture) setError(`Applied ${spec.name}'s colour and transparency. Drop its texture (PNG, JPEG or WebP) together with the .mat to apply that too.`);
  };
  const image = async (files: File[], shade = false) => {
    if (files.some(f => /\.mat$/i.test(f.name))) {
      setBusy(true); setError(null);
      try { await unityMaterial(files); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      return;
    }
    const file = files[0]; if (!file || !material) return;
    setBusy(true); setError(null);
    try {
      if (file.size > 20 * 1024 * 1024 || !/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error('Choose a PNG, JPEG or WebP texture smaller than 20 MB. Export VRoid custom items as texture images first.');
      const media = await upload<{ id: string }>('/api/media', file, { kind: 'model-texture' });
      change(shade ? { shadeTexture: media.id } : { texture: media.id, alpha: 'mask' });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="flex flex-col gap-4" data-testid="material-editor">
    <p className="text-sm text-fg-2">VRoid clothes are usually texture images for a particular UV template. Choose that exported material below, then drop its texture here. Slot guesses are labels; select the actual matching template manually when needed. Geometry comes from a donor model or fitted garment.</p>
    <Field label="Material slot"><Select aria-label="Material slot" value={material} onChange={e => setMaterial(e.target.value)}>{names.map(n => <option key={n} value={n}>{slot(n)} · {n}</option>)}</Select></Field>
    <div className="rounded-md border border-dashed border-line p-3 text-sm text-fg-2" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) void image(Array.from(e.dataTransfer.files)); }}>Drop a texture for {material || 'the chosen slot'} here, or a Unity material (.mat) with its texture</div>
    <div className="flex flex-wrap gap-2"><FileButton loading={busy} disabled={!material} onFiles={files => void image(files)}>Color texture</FileButton><FileButton loading={busy} disabled={!material} variant="secondary" onFiles={files => void image(files, true)}>Shade texture</FileButton><Button variant="ghost" onClick={() => { const overrides = { ...config.materialOverrides }; delete overrides[material]; set({ materialOverrides: overrides }); }}>Reset material</Button></div>
    <Field label="Color"><Input aria-label="Material color" type="color" value={value.color ?? '#ffffff'} onChange={e => change({ color: e.target.value })} /></Field>
    <Field label="Transparency"><Select aria-label="Material transparency" value={value.alpha ?? ''} onChange={e => change({ alpha: (e.target.value || undefined) as typeof value.alpha })}><option value="">Original</option><option value="opaque">Opaque</option><option value="mask">Cutout (clothing alpha)</option><option value="blend">Soft transparency</option></Select></Field>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    <Field label="Variant name"><Input aria-label="Material variant name" value={variant} maxLength={60} onChange={e => setVariant(e.target.value)} /></Field>
    <Field label="Equipped inventory items" hint="Comma-separated names. This uses the normal outfit system and rolls back with story swipes."><Input aria-label="Material variant inventory items" value={items} onChange={e => setItems(e.target.value)} /></Field>
    <Button variant="secondary" disabled={!material || !variant.trim()} onClick={() => {
      const id = `texture${Date.now().toString(36)}`;
      set({ outfits: [...config.outfits, { id, name: variant.trim(), model: null, modelLow: null, parts: [], garments: [], items: items.split(',').map(s => s.trim()).filter(Boolean).slice(0, 16), materialOverrides: structuredClone(config.materialOverrides) }] });
    }}>Save as wardrobe variant</Button>
  </div>;
}
