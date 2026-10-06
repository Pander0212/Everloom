/**
 * The dressing room: which meshes are skin, which can be shown or hidden (parts, with the body
 * regions they cover and the items that put them on), named outfits (a set of parts, or a whole
 * other model with the same skeleton), and accessories attached to bones. Tap an outfit to try it on.
 */
import { BODY_REGIONS, HUMANOID_BONES, type AvatarAccessory, type AvatarConfig, type AvatarOutfit, type AvatarPart } from '@everloom/engine';
import { Plus, Shirt, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { addOutfitModel, type AvatarDetail } from '@/features/avatars/api';
import { cx } from '@/lib/format';
import { toastError } from '@/lib/store';
import { Badge, Button, Checkbox, Field, FileButton, IconButton, Input, SectionTitle, Select, Slider, Switch } from '@/ui';

const newId = (prefix: string, taken: string[]) => {
  for (let i = 1; ; i++) if (!taken.includes(`${prefix}${i}`)) return `${prefix}${i}`;
};
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 16);
const REGION_LABEL: Record<string, string> = { head: 'Head', neck: 'Neck', chest: 'Chest', belly: 'Belly', hips: 'Hips', upperArms: 'Upper arms', forearms: 'Forearms', hands: 'Hands', thighs: 'Thighs', knees: 'Knees', calves: 'Calves', feet: 'Feet' };

export function WardrobeStep({ avatar, config, set, tryOn, setTryOn }: { avatar: AvatarDetail; config: AvatarConfig; set: (p: Partial<AvatarConfig>) => void; tryOn: string | null; setTryOn: (id: string | null) => void }) {
  const meshes = avatar.info.meshNames ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const setPart = (id: string, p: Partial<AvatarPart>) => set({ parts: config.parts.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const setOutfit = (id: string, p: Partial<AvatarOutfit>) => set({ outfits: config.outfits.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const setAcc = (id: string, p: Partial<AvatarAccessory>) => set({ accessories: config.accessories.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const upload = async (key: string, f: File) => {
    setUploading(key);
    try {
      return await addOutfitModel(avatar.id, f);
    } catch (e) {
      toastError(e);
      return null;
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="wardrobe">
      <SectionTitle>Outfits</SectionTitle>
      <p className="text-sm text-fg-2">Tap one to try it on. The story can change outfits (it rolls back with swipes), and equipped items can pick one.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={tryOn === null ? 'primary' : 'secondary'} onClick={() => setTryOn(null)}>
          As set
        </Button>
        {config.outfits.map((o) => (
          <Button key={o.id} size="sm" icon={Shirt} variant={tryOn === o.id ? 'primary' : 'secondary'} onClick={() => setTryOn(o.id)}>
            {o.name}
          </Button>
        ))}
      </div>
      {config.outfits.map((o) => (
        <details key={o.id} open={open === o.id} onToggle={(e) => (e.currentTarget.open ? setOpen(o.id) : open === o.id && setOpen(null))} className="rounded-md border border-line">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
            {o.name}
            {config.outfit === o.id ? <Badge tone="accent">Default</Badge> : null}
            {o.model ? <Badge>Own model</Badge> : null}
          </summary>
          <div className="flex flex-col gap-3 border-t border-line p-3">
            <Field label="Name">
              <Input aria-label="Outfit name" value={o.name} maxLength={60} onChange={(e) => setOutfit(o.id, { name: e.target.value || 'Outfit' })} />
            </Field>
            {config.parts.length ? (
              <Field label="Parts it wears">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {config.parts.map((p) => (
                    <Checkbox key={p.id} label={p.name} checked={o.parts.includes(p.id)} onChange={(v) => setOutfit(o.id, { parts: v ? [...o.parts, p.id] : o.parts.filter((x) => x !== p.id) })} />
                  ))}
                </div>
              </Field>
            ) : null}
            <Field label="Whole-outfit model" hint="A different model file with the same skeleton (a ballgown, armour). Optional.">
              <div className="flex items-center gap-2">
                <FileButton
                  size="sm"
                  variant="secondary"
                  icon={Upload}
                  accept=".glb,.vrm"
                  loading={uploading === o.id}
                  onFiles={async ([f]) => {
                    const r = f && (await upload(o.id, f));
                    if (r) setOutfit(o.id, { model: r.model, modelLow: r.modelLow });
                  }}
                >
                  {o.model ? 'Replace' : 'Add model'}
                </FileButton>
                {o.model ? <Button size="sm" variant="ghost" onClick={() => setOutfit(o.id, { model: null, modelLow: null })}>Remove</Button> : null}
              </div>
            </Field>
            <Field label="Put on by these items" hint="Inventory item names, separated by commas.">
              <Input aria-label="Outfit items" defaultValue={o.items.join(', ')} onBlur={(e) => setOutfit(o.id, { items: list(e.target.value) })} />
            </Field>
            <div className="flex items-center justify-between">
              <Checkbox label="Default outfit" checked={config.outfit === o.id} onChange={(v) => set({ outfit: v ? o.id : null })} />
              <IconButton icon={Trash2} label={`Delete ${o.name}`} tone="danger" onClick={() => set({ outfits: config.outfits.filter((x) => x.id !== o.id), outfit: config.outfit === o.id ? null : config.outfit })} />
            </div>
          </div>
        </details>
      ))}
      <Button size="sm" variant="ghost" icon={Plus} onClick={() => {
        const id = newId('outfit', config.outfits.map((o) => o.id));
        set({ outfits: [...config.outfits, { id, name: `Outfit ${config.outfits.length + 1}`, model: null, modelLow: null, parts: config.parts.filter((p) => p.on).map((p) => p.id), garments: [], items: [] }] });
        setOpen(id);
      }}>
        New outfit
      </Button>

      <SectionTitle>Parts</SectionTitle>
      <p className="text-sm text-fg-2">Pieces that can be shown or hidden: hair, a jacket, a hat. Parts in the same group replace each other.</p>
      {config.parts.map((p) => (
        <details key={p.id} open={open === p.id} onToggle={(e) => (e.currentTarget.open ? setOpen(p.id) : open === p.id && setOpen(null))} className="rounded-md border border-line">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
            <span className="flex-1">{p.name}</span>
            {p.group ? <Badge>{p.group}</Badge> : null}
            <Switch checked={p.on} onChange={(v) => setPart(p.id, { on: v })} label={`${p.name} shown`} />
          </summary>
          <div className="flex flex-col gap-3 border-t border-line p-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name">
                <Input aria-label="Part name" value={p.name} maxLength={60} onChange={(e) => setPart(p.id, { name: e.target.value || 'Part' })} />
              </Field>
              <Field label="Group">
                <Input aria-label="Part group" value={p.group ?? ''} placeholder="hair" maxLength={40} onChange={(e) => setPart(p.id, { group: e.target.value.trim() || undefined })} />
              </Field>
            </div>
            <Field label="Meshes">
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {meshes.map((m) => (
                  <Checkbox key={m} label={m} checked={p.meshes.includes(m)} onChange={(v) => setPart(p.id, { meshes: v ? [...p.meshes, m] : p.meshes.filter((x) => x !== m).length ? p.meshes.filter((x) => x !== m) : p.meshes })} />
                ))}
              </div>
            </Field>
            <Field label="Covers (skin there is hidden)">
              <div className="flex flex-wrap gap-1">
                {BODY_REGIONS.map((r) => (
                  <button key={r} type="button" aria-pressed={p.hides.includes(r)} onClick={() => setPart(p.id, { hides: p.hides.includes(r) ? p.hides.filter((x) => x !== r) : [...p.hides, r] })} className={cx('pressable rounded-full px-2.5 py-1 text-xs', p.hides.includes(r) ? 'bg-accent text-accent-fg' : 'bg-surface-2')}>
                    {REGION_LABEL[r]}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Put on by these items">
              <Input aria-label="Part items" defaultValue={p.items.join(', ')} onBlur={(e) => setPart(p.id, { items: list(e.target.value) })} />
            </Field>
            <div className="flex justify-end">
              <IconButton icon={Trash2} label={`Delete ${p.name}`} tone="danger" onClick={() => set({ parts: config.parts.filter((x) => x.id !== p.id), outfits: config.outfits.map((o) => ({ ...o, parts: o.parts.filter((x) => x !== p.id) })) })} />
            </div>
          </div>
        </details>
      ))}
      <Button size="sm" variant="ghost" icon={Plus} disabled={!meshes.length} onClick={() => {
        const id = newId('part', config.parts.map((p) => p.id));
        set({ parts: [...config.parts, { id, name: `Part ${config.parts.length + 1}`, meshes: [meshes[0]!], hides: [], on: true, items: [] }] });
        setOpen(id);
      }}>
        New part
      </Button>

      <SectionTitle>Body</SectionTitle>
      <Field label="Skin meshes" hint="The body itself. Regions covered by parts that are on are hidden on these.">
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {meshes.map((m) => (
            <Checkbox key={m} label={m} checked={config.body.includes(m)} onChange={(v) => set({ body: v ? [...config.body, m] : config.body.filter((x) => x !== m) })} />
          ))}
        </div>
      </Field>

      <SectionTitle>Accessories</SectionTitle>
      <p className="text-sm text-fg-2">Small models held or worn on a bone: a sword in the right hand, glasses on the head.</p>
      {config.accessories.map((a) => (
        <details key={a.id} open={open === a.id} onToggle={(e) => (e.currentTarget.open ? setOpen(a.id) : open === a.id && setOpen(null))} className="rounded-md border border-line">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
            <span className="flex-1">{a.name}</span>
            <Badge>{a.bone}</Badge>
            <Switch checked={a.on} onChange={(v) => setAcc(a.id, { on: v })} label={`${a.name} shown`} />
          </summary>
          <div className="flex flex-col gap-3 border-t border-line p-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name">
                <Input aria-label="Accessory name" value={a.name} maxLength={60} onChange={(e) => setAcc(a.id, { name: e.target.value || 'Accessory' })} />
              </Field>
              <Field label="Bone">
                <Select aria-label="Accessory bone" value={a.bone} onChange={(e) => setAcc(a.id, { bone: e.target.value as AvatarAccessory['bone'] })}>
                  {HUMANOID_BONES.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {(['x', 'y', 'z'] as const).map((axis, i) => (
              <Field key={axis} label={`Move ${axis} (${Math.round(a.position[i]! * 100)} cm)`}>
                <Slider label={`Move ${axis}`} min={-0.5} max={0.5} step={0.005} value={a.position[i]!} onChange={(v) => setAcc(a.id, { position: a.position.map((x, j) => (j === i ? v : x)) as AvatarAccessory['position'] })} />
              </Field>
            ))}
            {(['x', 'y', 'z'] as const).map((axis, i) => (
              <Field key={axis} label={`Turn ${axis} (${Math.round(a.rotation[i]!)}°)`}>
                <Slider label={`Turn ${axis}`} min={-180} max={180} step={5} value={a.rotation[i]!} onChange={(v) => setAcc(a.id, { rotation: a.rotation.map((x, j) => (j === i ? v : x)) as AvatarAccessory['rotation'] })} />
              </Field>
            ))}
            <Field label={`Size (${a.scale.toFixed(2)}×)`}>
              <Slider label="Size" min={0.1} max={3} step={0.05} value={a.scale} onChange={(v) => setAcc(a.id, { scale: v })} />
            </Field>
            <Field label="Shown only with these items" hint="Leave empty to follow the switch above.">
              <Input aria-label="Accessory items" defaultValue={a.items.join(', ')} onBlur={(e) => setAcc(a.id, { items: list(e.target.value) })} />
            </Field>
            <div className="flex justify-end">
              <IconButton icon={Trash2} label={`Delete ${a.name}`} tone="danger" onClick={() => set({ accessories: config.accessories.filter((x) => x.id !== a.id) })} />
            </div>
          </div>
        </details>
      ))}
      <FileButton size="sm" variant="ghost" icon={Plus} accept=".glb" loading={uploading === 'acc'} onFiles={async ([f]) => {
        const r = f && (await upload('acc', f));
        if (!r) return;
        const id = newId('acc', config.accessories.map((a) => a.id));
        set({ accessories: [...config.accessories, { id, name: f!.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'Accessory', model: r.model, bone: 'rightHand', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1, on: true, items: [] }] });
        setOpen(id);
      }}>
        Add an accessory (GLB)
      </FileButton>
    </div>
  );
}
