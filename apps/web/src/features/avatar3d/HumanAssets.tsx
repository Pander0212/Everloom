import { useState } from 'react';
import { zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import { Button, Field, FileButton, Input, Select, Switch } from '@/ui';
import type { HumanLibrary, HumanProfile } from './runtime/makehuman';
import type { AvatarConfig } from '@everloom/engine';

export function HumanAssets({ library, profile, set, content }: { library: HumanLibrary; profile: HumanProfile; set: (profile: HumanProfile) => void; content?: AvatarConfig['content'] }) {
  const [kind, setKind] = useState('clothes'), [rights, setRights] = useState(false), [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [search, setSearch] = useState('');
  const install = async (files: File[]) => {
    if (!files.length) return; setBusy(true); setError(null);
    try {
      if (!rights) throw new Error('Confirm that you may use these asset files first.');
      if (files.reduce((n, file) => n + file.size, 0) > 100 * 1024 * 1024) throw new Error('Asset packs must be smaller than 100 MB.');
      const bytes = files.length === 1 && /\.zip$/i.test(files[0].name) ? await files[0].arrayBuffer() : zipSync(Object.fromEntries(await Promise.all(files.map(async file => [file.webkitRelativePath || file.name, new Uint8Array(await file.arrayBuffer())]))));
      const result = await api<HumanLibrary>('/api/makehuman/assets', { raw: bytes, query: { kind, label: files[0].name.slice(0, 80), adult: String(adult), rightsConfirmed: 'true' } });
      queryClient.setQueryData(['makehuman'], result);
      void queryClient.invalidateQueries({ queryKey: ['makehuman'] });
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const files = { ...library.core.files, ...library.system.files };
  const choices = Object.keys(files).filter(path => path.includes('/owner-') && /\.(mhclo|mhmat|target|mhskel)$|\/rig\.[^/]+\.json$/.test(path) && path.toLowerCase().includes(search.toLowerCase()));
  const apply = (path: string) => {
    if (path.endsWith('.target')) set({ ...profile, targets: { ...profile.targets, [path]: 0.5 } });
    else if (path.startsWith('rigs/')) set({ ...profile, rig: path });
    else if (path.startsWith('skins/')) set({ ...profile, skin: path });
    else { const prefix = path.split('/')[0] + '/'; set({ ...profile, proxies: [...profile.proxies.filter(p => prefix === 'clothes/' ? !/casualsuit|sportsuit|worksuit|elegantsuit/.test(path) || !p.startsWith(prefix) : !p.startsWith(prefix)), path] }); }
  };
  return <div className="flex flex-col gap-3 rounded-lg border border-line p-3" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) void install(Array.from(event.dataTransfer.files)); }}>
    <p className="text-sm font-medium">Your MakeHuman assets</p>
    <p className="text-sm text-fg-2">Drop a ZIP, or select the .mhclo, OBJ, material and textures together. Companion files keep their relative paths. Installed files stay in your Vault and can be reused.</p>
    <Field label="Asset kind"><Select aria-label="MakeHuman asset kind" value={kind} onChange={event => setKind(event.target.value)}>{['clothes', 'hair', 'targets', 'rigs', 'skins', 'eyes', 'eyebrows', 'eyelashes', 'teeth', 'tongue'].map(value => <option key={value}>{value}</option>)}</Select></Field>
    <label className="flex items-center justify-between gap-3 text-sm">I have permission to use these assets<Switch label="Asset use permission" checked={rights} onChange={setRights} /></label>
    {library.adultEnabled ? <label className="flex items-center justify-between gap-3 text-sm">Tag this pack 18+<Switch label="Adult asset pack" checked={adult} onChange={setAdult} /></label> : null}
    <FileButton multiple loading={busy} onFiles={files => void install(files)}>Install from files</FileButton>
    {error ? <div role="alert"><p className="text-sm text-danger">{error}</p><Button variant="ghost" onClick={() => void navigator.clipboard.writeText(error)}>Copy details</Button></div> : null}
    {choices.length ? <><Input aria-label="Search your MakeHuman assets" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search installed assets" />{choices.slice(0, 30).map(path => <Button key={path} variant="secondary" onClick={() => apply(path)}>{path.split('/').pop()}</Button>)}</> : null}
    {adult && !content?.adult ? <p className="text-sm text-fg-2">18+ assets can only be saved on a confirmed adult character.</p> : null}
  </div>;
}
