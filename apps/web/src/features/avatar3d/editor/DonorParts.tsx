import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GARMENT_SLOTS, type AvatarConfig, type GarmentSlot } from '@everloom/engine';
import { addOutfitModel, type AvatarDetail } from '@/features/avatars/api';
import { Button, Checkbox, Field, FileButton, Select } from '@/ui';
import type { PreviewHandle } from '../Preview3D';
import { browserModel } from '../runtime/import';
import { disposeLoadedModel, loadModel, type LoadedModel } from '../runtime/loader';
import { copyDonorPart, donorParts, type DonorPart } from '../runtime/donor';

export function DonorParts({ avatar, config, set, handle }: { avatar: AvatarDetail; config: AvatarConfig; set: (patch: Partial<AvatarConfig>) => void; handle: PreviewHandle | null }) {
  const donor = useRef<LoadedModel | null>(null), [parts, setParts] = useState<DonorPart[]>([]), [selection, setSelection] = useState(''), [slot, setSlot] = useState<GarmentSlot>('hair');
  const [busy, setBusy] = useState(false), [rights, setRights] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState<string | null>(null);
  useEffect(() => () => { if (donor.current) disposeLoadedModel(donor.current); }, []);
  const open = async (files: File[]) => {
    if (!handle || !files.length) return; setBusy(true); setError(null);
    try {
      const file = await browserModel(files, setMessage), model = await loadModel(await file.arrayBuffer(), handle.stage.renderer);
      if (donor.current) disposeLoadedModel(donor.current); donor.current = model;
      const available = donorParts(model); setParts(available); setSelection(available.find(part => /hair|髪/i.test(part.label))?.id ?? available[0]?.id ?? '');
      setMessage('Choose a material part and its wardrobe slot. Donor parts may need clipping corrections on a different body.');
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  const copy = async () => {
    const part = parts.find(part => part.id === selection); if (!part || !donor.current || !handle || !rights) return;
    setBusy(true); setError(null); let body: LoadedModel | undefined, output: THREE.Object3D | undefined;
    try {
      setMessage('Rebinding the part to the character’s rest rig…');
      body = await loadModel(avatar.source ?? avatar.model!, handle.stage.renderer, config);
      output = copyDonorPart(body, donor.current, part);
      output.userData.everloom = { adult: config.content.adult, donorPart: part.label, donorLicense: donor.current.vrm?.meta ?? null };
      const bytes = await new GLTFExporter().parseAsync(output, { binary: true, onlyVisible: true });
      const saved = await addOutfitModel(avatar.id, new File([bytes as ArrayBuffer], 'donor-part.glb', { type: 'application/octet-stream' }));
      let number = 1; while (config.garments.some(garment => garment.id === `donor${number}`)) number++;
      const id = `donor${number}`;
      set({ garments: [...config.garments, { id, name: part.label.slice(0, 60), model: saved.model, modelLow: saved.modelLow, slot, layer: 1, hides: [], hidesSlots: slot === 'hair' ? ['hair'] : [], variants: [], variant: null, springs: true, family: config.family, on: true, items: [] }] });
      setMessage('Part copied. Its secondary bones and spring settings travel with it. Check the pose tester and hide any original parts it replaces.');
    } catch (error) { setError((error as Error).message); }
    finally {
      output?.traverse(object => { const mesh = object as THREE.SkinnedMesh; if (!mesh.isMesh) return; mesh.geometry.dispose(); mesh.skeleton?.dispose(); for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose(); });
      if (body) disposeLoadedModel(body); setBusy(false);
    }
  };
  return <div className="my-3 flex flex-col gap-3 rounded-md border border-line p-3" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) void open(Array.from(event.dataTransfer.files)); }}>
    <p className="text-sm font-medium">Copy hair or clothes from a donor model</p>
    <p className="text-sm text-fg-2">Drop an exported VRM or GLB here. Parts are separated by material and rebound through the humanoid rig. Different body proportions can clip; use the pose tester after copying.</p>
    <FileButton multiple loading={busy} disabled={!handle} onFiles={files => void open(files)}>Open donor model</FileButton>
    {parts.length ? <><Field label="Donor part"><Select aria-label="Donor part" value={selection} onChange={event => setSelection(event.target.value)}>{parts.map(part => <option key={part.id} value={part.id}>{part.label}</option>)}</Select></Field><Field label="Copy to slot"><Select aria-label="Donor wardrobe slot" value={slot} onChange={event => setSlot(event.target.value as GarmentSlot)}>{GARMENT_SLOTS.map(slot => <option key={slot}>{slot}</option>)}</Select></Field><Checkbox checked={rights} onChange={setRights} label="I have permission to use this donor part" /><Button disabled={!rights || busy} onClick={() => void copy()}>Copy selected part</Button></> : null}
    {message ? <p role="status" className="text-sm text-fg-2">{message}</p> : null}
    {error ? <div role="alert"><p className="text-sm text-danger">{error}</p><Button variant="ghost" onClick={() => void navigator.clipboard.writeText(error)}>Copy details</Button></div> : null}
  </div>;
}
