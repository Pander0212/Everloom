import type { LineageMember, PersonaDTO } from '@everloom/engine';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { del, post, put, upload } from '@/lib/api';
import { toastError } from '@/lib/store';
import { Avatar, Button, confirm, Field, FileButton, Input, Select, Sheet, TabPanel, Tabs, Textarea, ToggleRow } from '@/ui';
import { LineageEditor } from './LineageEditor';

const AGE_STAGES = ['Child', 'Teen', 'Young adult', 'Adult', 'Middle-aged', 'Elder'];

export function PersonaStudio({ persona, open, onOpenChange }: { persona: PersonaDTO | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [d, setD] = useState<Partial<PersonaDTO>>({});
  const [tab, setTab] = useState('identity');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setD(persona ? structuredClone(persona) : { name: '', description: '', title: '', age: null, ageStage: 'Adult', phone: '', isDefault: false, data: {} });
      setTab('identity');
    }
  }, [open, persona]);
  const set = (p: Partial<PersonaDTO>) => setD((x) => ({ ...x, ...p }));
  const save = async (avatarId?: string) => {
    setBusy(true);
    try {
      const body = { name: d.name?.trim() || 'Me', description: d.description, title: d.title, age: d.age ?? null, ageStage: d.ageStage, phone: d.phone, isDefault: d.isDefault, data: d.data, ...(avatarId ? { avatar: avatarId } : {}) };
      const saved = persona ? await put<PersonaDTO>(`/api/personas/${persona.id}`, body) : await post<PersonaDTO>('/api/personas', body);
      await qc.invalidateQueries({ queryKey: ['personas'] });
      if (avatarId) setD((x) => ({ ...x, avatar: saved.avatar }));
      else onOpenChange(false);
      return saved;
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const setPortrait = async (f: File) => {
    try {
      const m = await upload('/api/media', f, { kind: 'persona' });
      if (persona) await save(m.id);
      else setD((x) => ({ ...x, avatar: m.url, _avatarId: m.id } as any));
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async () => {
    if (!persona || !(await confirm({ title: `Delete ${persona.name}?`, confirmLabel: 'Delete', danger: true }))) return;
    await del(`/api/personas/${persona.id}`);
    await qc.invalidateQueries({ queryKey: ['personas'] });
    onOpenChange(false);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={persona ? 'Persona studio' : 'New persona'}
      size="lg"
      footer={
        <>
          {persona ? <Button variant="quiet" icon={Trash2} onClick={remove} aria-label="Delete persona" /> : null}
          <Button variant="primary" size="lg" className="flex-1" loading={busy} onClick={() => save((d as any)._avatarId)}>
            Save persona
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-4 pb-2">
        <Avatar src={d.avatar} name={d.name || '?'} size="xl" shape="rounded" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{d.name || 'Unnamed'}</p>
          <p className="truncate text-sm text-fg-2">{d.title || 'No title'}</p>
          <FileButton accept="image/*" onFiles={(f) => setPortrait(f[0])} variant="secondary" size="sm" icon={ImagePlus} className="mt-2">
            Portrait
          </FileButton>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'identity', label: 'Identity' },
          { value: 'lineage', label: 'Lineage', count: d.data?.lineage?.length || undefined },
          { value: 'engine', label: 'Engine' },
        ]}
      >
        <TabPanel value="identity" className="flex flex-col gap-4 pt-5">
          <Field label="Name" htmlFor="pn">
            <Input id="pn" value={d.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Title" htmlFor="pt" hint="Optional, e.g. Human Paladin.">
            <Input id="pt" value={d.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Age" htmlFor="pa">
              <Input id="pa" type="number" min={0} value={d.age ?? ''} onChange={(e) => set({ age: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Age stage" htmlFor="ps" className="col-span-2">
              <Select id="ps" value={d.ageStage ?? ''} onChange={(e) => set({ ageStage: e.target.value })}>
                {AGE_STAGES.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Phone number" htmlFor="pp" hint="Shown in the in-game phone.">
            <Input id="pp" value={d.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} placeholder="Leave empty to generate one" />
          </Field>
          <Field label="Description" htmlFor="pd" hint="Appearance, background, what others would notice.">
            <Textarea id="pd" rows={5} value={d.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <ToggleRow label="Default persona" description="Used for new chats unless you pick another." checked={!!d.isDefault} onChange={(v) => set({ isDefault: v })} />
        </TabPanel>
        <TabPanel value="lineage" className="pt-5">
          <LineageEditor personaName={d.name || 'You'} members={d.data?.lineage ?? []} onChange={(lineage: LineageMember[]) => set({ data: { ...d.data, lineage } })} />
        </TabPanel>
        <TabPanel value="engine" className="flex flex-col gap-4 pt-5">
          <p className="text-sm text-fg-2">Defaults used when a new campaign starts with this persona.</p>
          <Field label="Class" htmlFor="pc">
            <Input id="pc" value={d.data?.engine?.className ?? ''} onChange={(e) => set({ data: { ...d.data, engine: { ...d.data?.engine, className: e.target.value } } })} placeholder="e.g. Bard" />
          </Field>
          <Field label="Resource profile" htmlFor="pr">
            <Select id="pr" value={d.data?.engine?.resourceProfile ?? 'hybrid'} onChange={(e) => set({ data: { ...d.data, engine: { ...d.data?.engine, resourceProfile: e.target.value as any } } })}>
              <option value="hybrid">Hybrid (AP and MP)</option>
              <option value="ap">AP only</option>
              <option value="mp">MP only</option>
            </Select>
          </Field>
          <Field label="Starting level" htmlFor="pl">
            <Input id="pl" type="number" min={1} max={99} value={d.data?.engine?.startingLevel ?? 1} onChange={(e) => set({ data: { ...d.data, engine: { ...d.data?.engine, startingLevel: Number(e.target.value) } } })} className="max-w-[120px]" />
          </Field>
        </TabPanel>
      </Tabs>
    </Sheet>
  );
}
