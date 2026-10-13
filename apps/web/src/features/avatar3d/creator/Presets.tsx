import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CharacterSpec } from '@everloom/engine';
import { api, get } from '@/lib/api';
import { toastError } from '@/lib/store';
import { Button, Field, Input, Select } from '@/ui';
type Kind = 'character' | 'body' | 'face' | 'outfit';
type Preset = { id: string; name: string; kind: Kind; spec: CharacterSpec };
export function CreatorPresets({ spec, apply }: { spec: CharacterSpec; apply: (s: CharacterSpec) => void }) {
  const query = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['creator-presets'], queryFn: () => get<Preset[]>('/api/creator-presets') });
  const [name, setName] = useState(''), [kind, setKind] = useState<Kind>('character'), [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api('/api/creator-presets', { body: { name, kind, spec } }); await query.invalidateQueries({ queryKey: ['creator-presets'] }); setName(''); }
    catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const load = (p: Preset) => {
    const s = structuredClone(spec), from = structuredClone(p.spec);
    if (p.kind === 'character') apply(from);
    else if (p.kind === 'body') apply({ ...s, base: from.base, body: from.body });
    else if (p.kind === 'face') apply({ ...s, face: from.face, eyes: from.eyes, skin: from.skin });
    else apply({ ...s, clothes: from.clothes });
  };
  return <details className="mb-4 rounded-md border border-line p-3">
    <summary>Saved presets</summary>
    <div className="mt-3 flex flex-col gap-3">
      <Field label="Preset type"><Select aria-label="Preset type" value={kind} onChange={e => setKind(e.target.value as Kind)}>{(['character', 'body', 'face', 'outfit'] as const).map(k => <option key={k} value={k}>{k}</option>)}</Select></Field>
      <Field label="Preset name"><Input aria-label="Preset name" value={name} maxLength={60} onChange={e => setName(e.target.value)} /></Field>
      <Button disabled={!name.trim()} loading={busy} onClick={() => void save()}>Save preset</Button>
      <p className="text-xs text-fg-2">Presets keep colours and patterns. Pictures dropped onto clothing stay with the exported character.</p>
      {data.filter(p => p.kind === kind).map(p => <div key={p.id} className="flex gap-2"><Button className="flex-1" onClick={() => load(p)}>{p.name}</Button><Button variant="ghost" onClick={async () => { try { await api(`/api/creator-presets/${p.id}`, { method: 'DELETE' }); await query.invalidateQueries({ queryKey: ['creator-presets'] }); } catch (e) { toastError(e); } }}>Remove</Button></div>)}
    </div>
  </details>;
}
