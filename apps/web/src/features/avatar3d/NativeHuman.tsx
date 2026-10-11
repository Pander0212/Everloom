/** The native maker and body panel share the same persisted recipe and runtime. */
import { AvatarConfigSchema, RealisticSpecSchema, MIN_ADULT_AGE, ageYears, type AvatarConfig } from '@everloom/engine';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { api, get, post } from '@/lib/api';
import { toastError } from '@/lib/store';
import { Button, Field, Input, Select, Sheet, Slider } from '@/ui';
import { avatarKeys, type AvatarDetail } from '@/features/avatars/api';
import { queryClient } from '@/lib/queries';
import Preview3D from './Preview3D';
import { buildHuman, type HumanLibrary, type HumanProfile } from './runtime/makehuman';
import { HumanAssets } from './HumanAssets';

interface Library extends HumanLibrary {
  core: HumanLibrary['core'] & { downloadBytes: number; install: Install };
  system: HumanLibrary['system'] & { downloadBytes: number; install: Install };
}
interface Install { state: string; stage: string; received: number; files: number; error: string | null }
export function useHumanLibrary(enabled = true) {
  return useQuery({ queryKey: ['makehuman'], queryFn: () => get<Library>('/api/makehuman'), enabled, refetchInterval: q => [q.state.data?.core, q.state.data?.system].some(p => p?.install.state === 'running') ? 1500 : false });
}
const pretty = (path: string) => path.split('/').pop()!.replace(/\.(mhclo|mhmat|json|target)(\.gz)?$/, '').replace(/[_-]/g, ' ');
const first = (paths: string[], preferred: string) => paths.find(p => p.includes(preferred)) ?? paths[0];
function HumanSlider({ label, value, min = 0, onChange }: { label: string; value: number; min?: number; onChange: (value: number) => void }) {
  return <div className="flex items-center gap-3" onDoubleClick={() => onChange(Math.max(min, 0.5))}><Slider label={label} value={value} min={min} max={1} step={0.01} onChange={onChange} /><Input aria-label={`${label} value`} className="w-20 flex-none" type="number" value={value} min={min} max={1} step={0.01} onChange={event => { const next = Number(event.target.value); if (Number.isFinite(next)) onChange(Math.min(1, Math.max(min, next))); }} /></div>;
}
function starter(lib: Library): HumanProfile {
  const paths = Object.keys(lib.system.files);
  return { macro: RealisticSpecSchema.parse({}).macro, cupsize: 0.5, firmness: 0.5, targets: {}, rig: 'rigs/standard/rig.game_engine.json', skin: first(paths.filter(p => p.endsWith('.mhmat') && p.startsWith('skins/') && !p.includes('special_suit')), 'young_caucasian_female.mhmat'), proxies: [
    first(paths.filter(p => p.endsWith('.mhclo') && p.startsWith('clothes/')), 'female_casualsuit01'),
    first(paths.filter(p => p.endsWith('.mhclo') && p.startsWith('hair/')), 'bob01'),
    first(paths.filter(p => p.endsWith('.mhclo') && p.startsWith('eyes/')), 'low-poly'),
    first(paths.filter(p => p.endsWith('.mhclo') && p.startsWith('eyebrows/')), 'eyebrow001'),
    first(paths.filter(p => p.endsWith('.mhclo') && p.startsWith('eyelashes/')), 'eyelashes01'),
    first(paths.filter(p => p.endsWith('.mhclo') && p.startsWith('teeth/')), 'teeth_base'),
    first(paths.filter(p => p.endsWith('.mhclo') && p.startsWith('tongue/')), 'tongue01'),
    first(paths.filter(p => p.endsWith('.mhclo') && /^clothes\/shoes/.test(p)), 'shoes04'),
  ].filter(Boolean) };
}

export function HumanControls({ profile, set, library, content }: { profile: HumanProfile; set: (p: HumanProfile) => void; library: HumanLibrary; content?: AvatarConfig['content'] }) {
  const [search, setSearch] = useState('');
  const paths = Object.keys(library.system.files), core = Object.keys(library.core.files);
  const choose = (label: string, prefix: string, optional = false, pattern?: RegExp) => {
    const choices = paths.filter(p => p.startsWith(prefix) && p.endsWith('.mhclo') && (pattern ? pattern.test(p) : prefix !== 'clothes/' || /casualsuit|sportsuit|worksuit|elegantsuit/.test(p)));
    return <Field label={label}><Select aria-label={label} value={profile.proxies.find(p => choices.includes(p)) ?? ''} onChange={e => set({ ...profile, proxies: [...profile.proxies.filter(p => !choices.includes(p)), ...(e.target.value ? [e.target.value] : [])] })}>{optional ? <option value="">None</option> : null}{choices.map(p => <option key={p} value={p}>{pretty(p)}</option>)}</Select></Field>;
  };
  const locals = core.filter(p => /\.target(\.gz)?$/.test(p) && !/macrodetails|genital|penis|vagina|nipple|anus/.test(p) && !/\/(?:female|male)-/.test(p));
  const buttIncr = core.find(path => /buttocks-volume-incr\.target/.test(path)), buttDecr = core.find(path => /buttocks-volume-decr\.target/.test(path));
  return <div className="flex flex-col gap-4">
    <p className="text-sm text-fg-2">MakeHuman CC0 assets. Changes rebuild from the original mesh and refit the selected clothes. Age about {Math.round(ageYears(profile.macro.age))}.</p>
    {(['gender', 'age', 'weight', 'muscle', 'height', 'proportions'] as const).map(key => <Field key={key} label={key === 'gender' ? 'Feminine to masculine' : key}><HumanSlider label={key} value={profile.macro[key]} min={content?.adult ? key === 'age' ? MIN_ADULT_AGE : key === 'proportions' ? 0.25 : 0 : 0} onChange={value => set({ ...profile, macro: { ...profile.macro, [key]: value } })} /></Field>)}
    {(['african', 'asian', 'caucasian'] as const).map(key => <Field key={key} label={`${key} ancestry mix`}><HumanSlider label={`${key} ancestry`} value={profile.macro.race[key]} onChange={value => set({ ...profile, macro: { ...profile.macro, race: { ...profile.macro.race, [key]: value } } })} /></Field>)}
    <Field label="Breast size"><HumanSlider label="Breast size" value={profile.cupsize} onChange={cupsize => set({ ...profile, cupsize })} /></Field>
    <Field label="Breast firmness"><HumanSlider label="Breast firmness" value={profile.firmness} onChange={firmness => set({ ...profile, firmness })} /></Field>
    {buttIncr && buttDecr ? <Field label="Butt size"><HumanSlider label="Butt size" value={0.5 + ((profile.targets[buttIncr] ?? 0) - (profile.targets[buttDecr] ?? 0)) * 0.5} onChange={value => set({ ...profile, targets: { ...profile.targets, [buttIncr]: Math.max(0, value * 2 - 1), [buttDecr]: Math.max(0, 1 - value * 2) } })} /></Field> : null}
    <Button variant="ghost" onClick={() => set({ ...profile, macro: RealisticSpecSchema.parse({}).macro, cupsize: 0.5, firmness: 0.5, targets: {} })}>Reset body and face</Button>
    <Field label="Skin"><Select aria-label="Skin" value={profile.skin} onChange={e => set({ ...profile, skin: e.target.value })}>{paths.filter(p => p.startsWith('skins/') && p.endsWith('.mhmat')).map(p => <option key={p} value={p}>{pretty(p)}</option>)}</Select></Field>
    {choose('Clothes', 'clothes/', library.adultEnabled === true && !(content?.age != null && content.age < 18))}{choose('Shoes', 'clothes/', true, /\/shoes/)}{choose('Hair', 'hair/', true)}{choose('Eyes', 'eyes/')}{choose('Brows', 'eyebrows/', true)}{choose('Lashes', 'eyelashes/', true)}{choose('Teeth', 'teeth/', true)}{choose('Tongue', 'tongue/', true)}
    <Field label="Rig"><Select aria-label="Rig" value={profile.rig} onChange={e => set({ ...profile, rig: e.target.value })}>{core.filter(p => /\.mhskel$/.test(p) || /\/rig\.[^/]+\.json$/.test(p) && library.core.files[p.replace('/rig.', '/weights.')]).map(p => <option key={p} value={p}>{pretty(p)}</option>)}</Select></Field>
    <Field label="Local body and face targets" hint="Search a region such as buttocks, belly, nose or jaw. Each target is a delta; reset returns to the original shape."><Input aria-label="Find body target" placeholder="buttocks" value={search} onChange={e => setSearch(e.target.value)} /></Field>
    {locals.filter(p => search.trim() ? p.toLowerCase().includes(search.toLowerCase()) : !!profile.targets[p]).slice(0, 30).map(p => <Field key={p} label={pretty(p)}><Slider label={pretty(p)} value={profile.targets[p] ?? 0} min={0} max={1} step={0.01} onChange={value => set({ ...profile, targets: { ...profile.targets, [p]: value } })} /><Button variant="ghost" onClick={() => { const targets = { ...profile.targets }; delete targets[p]; set({ ...profile, targets }); }}>Reset</Button></Field>)}
    <HumanAssets library={library} profile={profile} set={set} content={content} />
  </div>;
}

export default function NativeHuman({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate(), query = useHumanLibrary(open);
  const [profile, setProfile] = useState<HumanProfile | null>(null), [preview, setPreview] = useState<HumanProfile | null>(null);
  const [name, setName] = useState('MakeHuman character'), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const lib = query.data, ready = lib?.core.installed && lib.system.installed;
  useEffect(() => { if (ready && lib && !profile) setProfile(starter(lib)); }, [ready, lib, profile]);
  useEffect(() => { const timer = setTimeout(() => setPreview(profile), 250); return () => clearTimeout(timer); }, [profile]);
  const create = async () => {
    if (!profile || !lib) return;
    setBusy(true); setError(null);
    let scene: Awaited<ReturnType<typeof buildHuman>> | null = null;
    try {
      scene = await buildHuman(profile, lib);
      scene.userData.everloom = { config: AvatarConfigSchema.parse({ makehuman: profile, look: 'pbr', content: { age: Math.round(ageYears(profile.macro.age)) } }) };
      const bytes = await new GLTFExporter().parseAsync(scene, { binary: true });
      const a = await api<AvatarDetail>('/api/avatars/native', { raw: bytes as ArrayBuffer, query: { name }, signal: AbortSignal.timeout(120000) });
      void queryClient.invalidateQueries({ queryKey: avatarKeys.list });
      onOpenChange(false); navigate(`/characters/avatars/${a.id}`);
    } catch (e) { setError((e as Error).message); }
    finally { scene?.traverse(o => { const m = o as import('three').Mesh; m.geometry?.dispose(); for (const material of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) material.dispose(); }); setBusy(false); }
  };
  return <Sheet open={open} onOpenChange={onOpenChange} title="MakeHuman character" description="Build and fit a character in your browser.">
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {!ready ? <div className="flex flex-col gap-4"><p className="text-sm text-fg-2">Install the official CC0 mesh, targets, rigs and starter clothing once. The body pack (39 MB) and optional skin, hair and clothing pack (93 MB) are included for local installation. Shipped skins keep facial detail and use a plain body texture. The Vault encrypts these assets when enabled.</p>{(['core', 'system'] as const).map(pack => { const p = lib?.[pack]; return <div key={pack}><p className="text-sm">{pack === 'core' ? 'Body, targets and rigs' : 'Skins, hair and clothes'}{p?.installed ? ' · Installed' : ''}</p>{p?.install.state === 'running' ? <p role="status" className="text-sm text-fg-2">{p.install.stage} · {Math.round(p.install.received / 1048576)} MB · {p.install.files} files</p> : !p?.installed ? <Button onClick={() => void post('/api/makehuman/install', { pack }).then(() => query.refetch()).catch(toastError)}>Install {pack}</Button> : null}{p?.install.error ? <p role="alert" className="text-sm text-danger">{p.install.error}</p> : null}</div>; })}{query.error ? <p role="alert">{query.error.message}</p> : null}</div> : profile && lib ? <div className="flex flex-col gap-4" data-testid="native-human-maker">
      {preview ? <Preview3D src="native:makehuman" config={{ makehuman: preview }} inspect className="sticky top-0 z-10 h-[32dvh]" onError={setError} /> : null}
      <Field label="Name"><Input aria-label="Name" value={name} maxLength={80} onChange={e => setName(e.target.value)} /></Field>
      <HumanControls profile={profile} set={setProfile} library={lib} />
      <Button loading={busy} onClick={() => void create()}>Create character</Button>
    </div> : null}
  </Sheet>;
}
