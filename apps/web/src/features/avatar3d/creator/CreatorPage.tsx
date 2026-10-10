/**
 * Characters › 3D avatars › Make › Character creator: build an anime character on Everloom's own
 * bases (body and face sliders, eyes, skin and makeup, hair from the hair system, clothing
 * templates), then save it as a 3D avatar (and export VRM from the avatar's Export step). Opening
 * /characters/creator/<avatar id> edits a saved one again.
 */
import { CHARACTER_BASES, CHARACTER_SLIDERS, CharacterSpecSchema, CLOTH_PATTERNS, CLOTHING_TEMPLATES, HAIR_PARTS, HAIR_PRESETS, type CharacterSpec, type ClothingItem } from '@everloom/engine';
import { ArrowLeft, Download, Plus, Save, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Page } from '@/app/Shell';
import { api, get, upload } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Button, Field, FileButton, IconButton, Input, Segmented, Select, Slider, Spinner, Switch, TabPanel, Tabs, useDesktop } from '@/ui';
import type { AvatarDetail } from '@/features/avatars/api';
import { applyLook } from '../runtime/materials';
import { webTexture } from '../runtime/textures';
import { createCharacter, type CharacterModel } from './build';
import { uvTemplate } from './clothes';

const TABS = [
  { value: 'base', label: 'Base' },
  { value: 'body', label: 'Body' },
  { value: 'face', label: 'Face' },
  { value: 'eyes', label: 'Eyes' },
  { value: 'hair', label: 'Hair' },
  { value: 'skin', label: 'Skin & makeup' },
  { value: 'clothes', label: 'Clothes' },
  { value: 'anatomy', label: 'Anatomy' },
];

function Colour({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <input type="color" aria-label={label} className="h-9 w-12 cursor-pointer rounded border border-line bg-transparent" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Range({ label, value, onChange, min = -1, max = 1, step = 0.01 }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <Field label={<span className="flex justify-between gap-2"><span>{label}</span><span className="tabular-nums text-fg-3">{value.toFixed(2)}</span></span>}>
      <Slider label={label} value={value} min={min} max={max} step={step} onChange={onChange} />
    </Field>
  );
}

/** The live preview: the character in a small three.js scene with the app's toon look. */
function Viewer({ model, toon, framing, version }: { model: CharacterModel | null; toon: boolean; framing: 'full' | 'face'; version: number }) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; view: THREE.Group | null } | null>(null);
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#ece8e2');
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8078, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(1.2, 2.4, 2.2);
    scene.add(key);
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 50);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    state.current = { renderer, scene, camera, controls, view: null };
    const size = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(size);
    ro.observe(el);
    size();
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
    loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); state.current = null; };
  }, []);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    if (s.view) s.scene.remove(s.view);
    s.view = null;
    if (!model) return;
    // A fresh wrapper each time, so the look starts from the built materials (single-material
    // meshes: the look's outline groups are cleared first).
    for (const [mesh, m] of model.sourceMaterials) { mesh.material = m; mesh.geometry.clearGroups(); }
    const view = new THREE.Group();
    view.add(model.root);
    applyLook(view, toon ? 'toon' : 'pbr', { outlines: toon, outlineWidth: 0.0026 });
    s.scene.add(view);
    s.view = view;
  }, [model, toon, version]);
  useEffect(() => {
    const s = state.current;
    if (!s || !model) return;
    const box = new THREE.Box3().setFromObject(model.body);
    const h = box.max.y;
    const target = framing === 'face' ? new THREE.Vector3(0, h * 0.93, 0) : new THREE.Vector3(0, h * 0.52, 0);
    s.camera.position.set(0, target.y, framing === 'face' ? h * 0.42 + 0.35 : h * 2.4);
    s.controls.target.copy(target);
    s.controls.update();
  }, [framing, model]);
  return <div ref={host} className="h-full w-full overflow-hidden rounded-lg" data-testid="creator-preview" data-state={model ? 'ready' : 'loading'} />;
}

export default function CreatorPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const desktop = useDesktop();
  const [spec, setSpec] = useState<CharacterSpec>(() => CharacterSpecSchema.parse({}));
  const [name, setName] = useState('New character');
  const [tab, setTab] = useState('base');
  const [framing, setFraming] = useState<'full' | 'face'>('full');
  const [model, setModel] = useState<CharacterModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<AvatarDetail | null>(null);
  const [anatomyPack, setAnatomyPack] = useState<boolean | null>(null);
  const textures = useRef(new Map<string, THREE.Texture>());
  const [version, bump] = useState(0);

  // Editing a saved character: its recipe and name.
  useEffect(() => {
    if (!id) return;
    void get<AvatarDetail>(`/api/avatars/${id}`).then((a) => {
      setExisting(a);
      setName(a.name);
      if (a.config.character) setSpec(CharacterSpecSchema.parse(a.config.character));
    }).catch(toastError);
  }, [id]);
  useEffect(() => { void get<{ installed: boolean }>('/api/anatomy-pack').then((r) => setAnatomyPack(r.installed)).catch(() => setAnatomyPack(false)); }, []);

  // A new model when the base changes; otherwise the live one is updated in place.
  const baseRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (model && baseRef.current === spec.base) {
      try { model.apply(spec); bump((n) => n + 1); } catch (e) { setError((e as Error).message); }
      return;
    }
    baseRef.current = spec.base;
    setModel(null);
    void createCharacter(spec, textures.current).then((m) => { if (cancelled) m.dispose(); else { setModel(m); setError(null); } }).catch((e: Error) => setError(e.message));
    return () => { cancelled = true; };
  }, [spec]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: (s: CharacterSpec) => CharacterSpec) => setSpec((s) => CharacterSpecSchema.parse(patch(structuredClone(s))));
  const slider = (group: 'body' | 'face', sid: string, v: number) => set((s) => { s[group].sliders[sid] = v; return s; });
  const sliders = (groups: string[]) => CHARACTER_SLIDERS.filter((s) => groups.includes(s.group) && (!s.base || s.base === spec.base));

  const save = async () => {
    if (!model) return;
    setBusy(true);
    setError(null);
    try {
      const config = { ...(existing?.config ?? {}), character: spec, look: spec.skin.toon ? 'toon' as const : 'pbr' as const, content: { ...(existing?.config.content ?? { adult: false, confirmedAdult: false, description: '' }), age: spec.body.age } };
      const glb = await model.exportGlb(config);
      const a = existing
        ? await api<AvatarDetail>(`/api/avatars/${existing.id}/native-model`, { method: 'PUT', raw: glb, signal: AbortSignal.timeout(180000) })
        : await api<AvatarDetail>('/api/avatars/native', { raw: glb, query: { name: name.trim() || 'New character' }, signal: AbortSignal.timeout(180000) });
      toast({ title: existing ? 'Character updated' : 'Character saved', lines: ['Open it to set its motions, check it on the stage, or export it as VRM.'] });
      navigate(`/characters/avatars/${a.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dropTexture = async (index: number, files: File[]) => {
    const f = files[0];
    if (!f) return;
    try {
      const web = await webTexture(f);
      const media = await upload<{ id: string }>('/api/media', web, { kind: 'model-texture' });
      const tex = new THREE.TextureLoader().load(URL.createObjectURL(web));
      tex.flipY = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      textures.current.set(media.id, tex);
      set((s) => { s.clothes[index]!.texture = media.id; return s; });
    } catch (e) { toastError(e); }
  };
  const saveUvTemplate = () => {
    if (!model) return;
    uvTemplate(model.body).toBlob((b) => { if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'everloom-body-uv-template.png'; a.click(); URL.revokeObjectURL(a.href); });
  };

  const preview = (
    <div className={desktop ? 'flex h-[calc(100dvh-140px)] flex-col gap-2' : 'flex h-[44dvh] flex-col gap-2'}>
      <div className="relative min-h-0 flex-1">
        <Viewer model={model} toon={spec.skin.toon} framing={framing} version={version} />
        {!model && !error ? <div className="absolute inset-0 grid place-items-center"><Spinner /></div> : null}
      </div>
      <Segmented label="Framing" value={framing} onChange={(v) => setFraming(v)} options={[{ value: 'full', label: 'Full' }, { value: 'face', label: 'Face' }]} size="sm" />
    </div>
  );

  const parts = useMemo(() => ({ front: HAIR_PARTS.filter((p) => p.kind === 'front'), back: HAIR_PARTS.filter((p) => p.kind === 'back'), side: HAIR_PARTS.filter((p) => p.kind === 'side') }), []);

  return (
    <Page
      title={existing ? `Edit ${existing.name}` : 'Character creator'}
      back={<IconButton icon={ArrowLeft} label="3D avatars" onClick={() => navigate('/characters/avatars')} />}
      actions={<Button icon={Save} onClick={() => void save()} loading={busy} disabled={!model} data-testid="creator-save">{existing ? 'Save changes' : 'Save character'}</Button>}
    >
      {error ? <p role="alert" className="mb-3 text-sm text-danger">{error}</p> : null}
      <div className={desktop ? 'grid grid-cols-[minmax(0,1.1fr)_minmax(340px,1fr)] gap-6' : 'flex flex-col gap-3'}>
        <div className={desktop ? 'sticky top-[68px] self-start' : 'sticky top-[60px] z-10 -mx-4 bg-bg px-4 pb-1'}>{preview}</div>
        <Tabs tabs={TABS} value={tab} onChange={setTab}>
          <div className="flex flex-col gap-4 pt-4">
            <TabPanel value="base">
              <div className="flex flex-col gap-4">
                <Field label="Name"><Input aria-label="Character name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Base body">
                  <Segmented label="Base body" value={spec.base} onChange={(v) => setSpec(CharacterSpecSchema.parse({ ...spec, base: v, body: { ...spec.body, height: CHARACTER_BASES.find((b) => b.id === v)!.height } }))} options={CHARACTER_BASES.map((b) => ({ value: b.id, label: b.label }))} />
                </Field>
                <p className="text-sm text-fg-2">Everloom's own bases (CC0, made from MakeHuman's open data), anime-proportioned, with a standard skeleton, breast and butt bones and physics. Everything here can be exported and shared.</p>
                <Range label="Age" value={spec.body.age} min={18} max={90} step={1} onChange={(v) => set((s) => { s.body.age = v; return s; })} />
                <Range label="Height (m)" value={spec.body.height} min={1.4} max={2.1} onChange={(v) => set((s) => { s.body.height = v; return s; })} />
                <Range label="Head size" value={spec.body.head} min={0.85} max={1.3} onChange={(v) => set((s) => { s.body.head = v; return s; })} />
                <label className="flex items-center justify-between gap-3 text-sm">Toon shading<Switch label="Toon shading" checked={spec.skin.toon} onChange={(v) => set((s) => { s.skin.toon = v; return s; })} /></label>
              </div>
            </TabPanel>
            <TabPanel value="body">
              <div className="flex flex-col gap-3">
                {sliders(['body', 'breast']).map((sl) => <Range key={sl.id} label={sl.label} min={sl.min ?? -1} max={sl.max ?? 1} value={spec.body.sliders[sl.id] ?? 0} onChange={(v) => slider('body', sl.id, v)} />)}
              </div>
            </TabPanel>
            <TabPanel value="face">
              <div className="flex flex-col gap-3">
                {sliders(['face', 'nose', 'mouth']).map((sl) => <Range key={sl.id} label={sl.label} min={sl.min ?? -1} max={sl.max ?? 1} value={spec.face.sliders[sl.id] ?? 0} onChange={(v) => slider('face', sl.id, v)} />)}
              </div>
            </TabPanel>
            <TabPanel value="eyes">
              <div className="flex flex-col gap-3">
                <Field label="Eye style"><Segmented label="Eye style" value={spec.eyes.style} onChange={(v) => set((s) => { s.eyes.style = v; return s; })} options={[{ value: 'round', label: 'Round' }, { value: 'sharp', label: 'Sharp' }, { value: 'soft', label: 'Soft' }]} /></Field>
                <Colour label="Iris" value={spec.eyes.iris} onChange={(v) => set((s) => { s.eyes.iris = v; return s; })} />
                <Colour label="Iris (lower)" value={spec.eyes.iris2} onChange={(v) => set((s) => { s.eyes.iris2 = v; return s; })} />
                <Range label="Iris size" value={spec.eyes.irisSize} min={0} max={1} onChange={(v) => set((s) => { s.eyes.irisSize = v; return s; })} />
                <Range label="Pupil" value={spec.eyes.pupil} min={0} max={1} onChange={(v) => set((s) => { s.eyes.pupil = v; return s; })} />
                <Range label="Highlight" value={spec.eyes.highlight} min={0} max={1} onChange={(v) => set((s) => { s.eyes.highlight = v; return s; })} />
                <Colour label="Eyelashes and liner" value={spec.eyes.lashes} onChange={(v) => set((s) => { s.eyes.lashes = v; return s; })} />
                {sliders(['eyes']).map((sl) => <Range key={sl.id} label={sl.label} value={spec.face.sliders[sl.id] ?? 0} onChange={(v) => slider('face', sl.id, v)} />)}
              </div>
            </TabPanel>
            <TabPanel value="hair">
              <div className="flex flex-col gap-3">
                <Field label="Hairstyle"><Select aria-label="Hairstyle" value={HAIR_PRESETS.find((p) => p.hair.front === spec.hair.front && p.hair.back === spec.hair.back && p.hair.side === spec.hair.side)?.id ?? ''} onChange={(e) => { const p = HAIR_PRESETS.find((x) => x.id === e.target.value); if (p) set((s) => ({ ...s, hair: { ...s.hair, ...p.hair } })); }}>
                  <option value="">Mixed</option>
                  {HAIR_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select></Field>
                {(['front', 'back', 'side'] as const).map((k) => (
                  <Field key={k} label={{ front: 'Front (bangs)', back: 'Back', side: 'Sides' }[k]}><Select aria-label={`Hair ${k}`} value={spec.hair[k]} onChange={(e) => set((s) => { s.hair[k] = e.target.value; return s; })}>{parts[k].map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
                ))}
                <Colour label="Hair colour" value={spec.hair.color} onChange={(v) => set((s) => { s.hair.color = v; return s; })} />
                <label className="flex items-center justify-between gap-3 text-sm">Gradient to the tips<Switch label="Hair tip gradient" checked={spec.hair.tips !== null} onChange={(v) => set((s) => { s.hair.tips = v ? '#d98ab0' : null; return s; })} /></label>
                {spec.hair.tips ? <Colour label="Tip colour" value={spec.hair.tips} onChange={(v) => set((s) => { s.hair.tips = v; return s; })} /> : null}
                <Range label="Shine" value={spec.hair.highlight} min={0} max={1} onChange={(v) => set((s) => { s.hair.highlight = v; return s; })} />
                <Range label="Length" value={spec.hair.length} onChange={(v) => set((s) => { s.hair.length = v; return s; })} />
                <Range label="Volume" value={spec.hair.volume} onChange={(v) => set((s) => { s.hair.volume = v; return s; })} />
                <Range label="Curl" value={spec.hair.curl} min={0} max={1} onChange={(v) => set((s) => { s.hair.curl = v; return s; })} />
                <label className="flex items-center justify-between gap-3 text-sm">Hair physics<Switch label="Hair physics" checked={spec.hair.physics} onChange={(v) => set((s) => { s.hair.physics = v; return s; })} /></label>
              </div>
            </TabPanel>
            <TabPanel value="skin">
              <div className="flex flex-col gap-3">
                <Field label="Skin tone"><div className="flex flex-wrap gap-2">{['#fbe8dc', '#f6dece', '#efcdb6', '#e3b393', '#c99071', '#a8704f', '#7d4f33', '#5a3622'].map((c) => <button key={c} type="button" aria-label={`Skin tone ${c}`} className={`size-8 rounded-full border-2 ${spec.skin.tone === c ? 'border-accent' : 'border-line'}`} style={{ background: c }} onClick={() => set((s) => { s.skin.tone = c; return s; })} />)}</div></Field>
                <Colour label="Custom skin tone" value={spec.skin.tone} onChange={(v) => set((s) => { s.skin.tone = v; return s; })} />
                <Range label="Blush" value={spec.skin.blush} min={0} max={1} onChange={(v) => set((s) => { s.skin.blush = v; return s; })} />
                <Colour label="Blush colour" value={spec.skin.blushColor} onChange={(v) => set((s) => { s.skin.blushColor = v; return s; })} />
                <Range label="Lip colour" value={spec.skin.lipColor} min={0} max={1} onChange={(v) => set((s) => { s.skin.lipColor = v; return s; })} />
                <Colour label="Lips" value={spec.skin.lips} onChange={(v) => set((s) => { s.skin.lips = v; return s; })} />
                <Range label="Eye shadow" value={spec.skin.eyeshadowAmount} min={0} max={1} onChange={(v) => set((s) => { s.skin.eyeshadowAmount = v; return s; })} />
                <Colour label="Eye shadow colour" value={spec.skin.eyeshadow} onChange={(v) => set((s) => { s.skin.eyeshadow = v; return s; })} />
                <label className="flex items-center justify-between gap-3 text-sm">Nail polish<Switch label="Nail polish" checked={spec.skin.nails !== null} onChange={(v) => set((s) => { s.skin.nails = v ? '#c0304a' : null; return s; })} /></label>
                {spec.skin.nails ? <Colour label="Nail colour" value={spec.skin.nails} onChange={(v) => set((s) => { s.skin.nails = v; return s; })} /> : null}
              </div>
            </TabPanel>
            <TabPanel value="clothes">
              <div className="flex flex-col gap-3">
                <p className="text-sm text-fg-2">Templates are made from the body itself, so they follow every slider. Paint your own on the body's UV template and drop the picture on an item.</p>
                <Button variant="secondary" icon={Download} onClick={saveUvTemplate} disabled={!model}>Save the UV template</Button>
                {spec.clothes.map((c, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-lg border border-line p-3" data-testid="creator-cloth">
                    <div className="flex items-center gap-2">
                      <Select aria-label={`Item ${i + 1}`} value={c.template} onChange={(e) => set((s) => { s.clothes[i]!.template = e.target.value as ClothingItem['template']; return s; })}>{CLOTHING_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
                      <IconButton icon={Trash2} label={`Remove item ${i + 1}`} onClick={() => set((s) => { s.clothes.splice(i, 1); return s; })} />
                    </div>
                    <Colour label="Colour" value={c.color} onChange={(v) => set((s) => { s.clothes[i]!.color = v; return s; })} />
                    <Field label="Pattern"><Select aria-label={`Item ${i + 1} pattern`} value={c.pattern} onChange={(e) => set((s) => { s.clothes[i]!.pattern = e.target.value as ClothingItem['pattern']; return s; })}>{CLOTH_PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
                    {c.pattern !== 'plain' ? <Colour label="Pattern colour" value={c.accent} onChange={(v) => set((s) => { s.clothes[i]!.accent = v; return s; })} /> : null}
                    <div className="flex gap-2">
                      <FileButton variant="secondary" icon={Upload} accept="image/*,.tga,.psd,.dds,.ktx2" onFiles={(f) => void dropTexture(i, f)}>Picture</FileButton>
                      {c.texture ? <Button variant="ghost" onClick={() => set((s) => { s.clothes[i]!.texture = null; return s; })}>Remove picture</Button> : null}
                    </div>
                  </div>
                ))}
                <Button variant="secondary" icon={Plus} disabled={spec.clothes.length >= 12} onClick={() => set((s) => { s.clothes.push({ template: 'tshirt', color: '#4a5a7a', accent: '#e8e4dc', pattern: 'plain', texture: null }); return s; })}>Add clothing</Button>
              </div>
            </TabPanel>
            <TabPanel value="anatomy">
              <div className="flex flex-col gap-3" data-testid="creator-anatomy">
                {anatomyPack ? (
                  <>
                    <label className="flex items-center justify-between gap-3 text-sm">Anatomy<Switch label="Anatomy" checked={spec.anatomy.enabled} onChange={(v) => set((s) => { s.anatomy.enabled = v; return s; })} /></label>
                    {spec.anatomy.enabled ? (
                      <>
                        <Range label="Areola size" value={spec.anatomy.areolaSize} min={0} max={1} onChange={(v) => set((s) => { s.anatomy.areolaSize = v; return s; })} />
                        <Colour label="Areola colour" value={spec.anatomy.areolaColor} onChange={(v) => set((s) => { s.anatomy.areolaColor = v; return s; })} />
                        <Range label="Nipple size" value={spec.anatomy.nippleSize} min={0} max={1} onChange={(v) => set((s) => { s.anatomy.nippleSize = v; return s; })} />
                        <Range label="Puffiness" value={spec.anatomy.puffiness} min={0} max={1} onChange={(v) => set((s) => { s.anatomy.puffiness = v; return s; })} />
                      </>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-fg-2">Anatomy editing comes from the anatomy pack, installed like any other pack (Settings › 3D characters › Packs). It isn't part of Everloom's download. Once installed it works here directly.</p>
                )}
              </div>
            </TabPanel>
          </div>
        </Tabs>
      </div>
    </Page>
  );
}
