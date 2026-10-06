/**
 * Import a motion as an emote: GLB/glTF, VRMA, FBX and BVH are read here; FBX files this browser
 * can't read, and VMD (with its PMX model), go through Blender on the server. The motion is
 * retargeted to the canonical skeleton, previewed on the mannequin, and saved under an emote name.
 */
import { BUILTIN_EMOTES, EMOTE_CATEGORIES, EMOTE_ID, type EmoteCategory, type HumanBone } from '@everloom/engine';
import { Play, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { saveClip } from '@/features/avatars/api';
import { apiFetch } from '@/lib/api';
import { toast, toastError } from '@/lib/store';
import { Button, Field, FileButton, Input, Select, Spinner, Switch } from '@/ui';
import Preview3D, { type PreviewHandle } from './Preview3D';
import { forgetClip, registerClip } from './runtime/clips';
import type { ClipJSON } from './runtime/clip';
import { convertMotion, type MotionSource } from './runtime/convert';

type Loaded = { files: File[]; names: string[]; read: () => Promise<MotionSource> };

const ext = (f: File) => f.name.split('.').pop()!.toLowerCase();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'm$1').slice(0, 40) || 'motion';

async function gltfSource(buf: ArrayBuffer): Promise<MotionSource> {
  const gltf = await new GLTFLoader().parseAsync(buf, '');
  // VRMA: the file names its humanoid bones itself.
  const json = (gltf.parser as unknown as { json: { nodes?: Array<{ name?: string }>; extensions?: Record<string, any> } }).json;
  const human = json.extensions?.VRMC_vrm_animation?.humanoid?.humanBones as Record<string, { node: number }> | undefined;
  const humanoid = human ? (Object.fromEntries(Object.entries(human).flatMap(([k, v]) => (json.nodes?.[v.node]?.name ? [[k, json.nodes[v.node]!.name!]] : []))) as Partial<Record<HumanBone, string>>) : null;
  return { scene: gltf.scene, animations: gltf.animations, humanoid };
}

/** Through Blender on the server: FBX this browser can't read, and VMD with its model. */
async function viaServer(files: File[]): Promise<ArrayBuffer> {
  const vmd = files.find((f) => ext(f) === 'vmd');
  let body: Blob;
  let filename: string;
  if (vmd) {
    const model = files.find((f) => ['pmx', 'pmd'].includes(ext(f)));
    if (!model) throw new Error('A VMD motion needs the PMX model it was made for: choose both files together.');
    body = new Blob([zipSync({ [vmd.name]: new Uint8Array(await vmd.arrayBuffer()), [model.name]: new Uint8Array(await model.arrayBuffer()) }) as Uint8Array<ArrayBuffer>]);
    filename = 'motion.zip';
  } else {
    body = files[0]!;
    filename = files[0]!.name;
  }
  const res = await apiFetch('/api/avatar-clips/convert', { method: 'POST', raw: body, query: { filename } });
  return res.arrayBuffer();
}

async function load(files: File[]): Promise<Loaded> {
  const main = files.find((f) => ['glb', 'gltf', 'vrma', 'fbx', 'bvh', 'vmd'].includes(ext(f)));
  if (!main) throw new Error('Choose a GLB, VRMA, FBX, BVH or VMD file.');
  const kind = ext(main);
  let read: () => Promise<MotionSource>;
  if (kind === 'bvh') {
    const text = await main.text();
    read = async () => {
      const r = new BVHLoader().parse(text);
      const scene = new THREE.Group();
      scene.add(r.skeleton.bones[0]!);
      return { scene, animations: [r.clip] };
    };
  } else if (kind === 'fbx') {
    const buf = await main.arrayBuffer();
    let viaBlender: ArrayBuffer | null = null;
    read = async () => {
      if (!viaBlender) {
        try {
          const group = new FBXLoader().parse(buf, '');
          if (group.animations.length) return { scene: group, animations: group.animations };
        } catch {
          /* older or unusual FBX: Blender converts it (once) */
        }
        viaBlender = await viaServer([main]);
      }
      return gltfSource(viaBlender);
    };
  } else if (kind === 'vmd') {
    let glb: ArrayBuffer | null = null;
    read = async () => gltfSource((glb ??= await viaServer(files)));
  } else {
    const buf = await main.arrayBuffer();
    read = () => gltfSource(buf);
  }
  const first = await read();
  if (!first.animations.length) throw new Error('This file has no animation in it.');
  return { files, names: first.animations.map((a, i) => a.name || `Animation ${i + 1}`), read };
}

export default function ClipImporter({ onDone }: { onDone: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anim, setAnim] = useState(0);
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<EmoteCategory>('social');
  const [loop, setLoop] = useState(false);
  const [inPlace, setInPlace] = useState(true);
  const [clip, setClip] = useState<ClipJSON | null>(null);
  const handle = useRef<PreviewHandle | null>(null);

  const pick = async (files: File[]) => {
    setBusy(true);
    setError(null);
    setClip(null);
    try {
      const l = await load(files);
      setLoaded(l);
      setAnim(0);
      const name = l.names[0]!;
      setLabel(name.replace(/[_|]+/g, ' ').trim().slice(0, 40));
      setId(slug(name));
      setLoop(/loop|idle|dance|walk|run/i.test(name));
      setCategory(/dance/i.test(name) ? 'dance' : /idle/i.test(name) ? 'idle' : /attack|punch|kick|block|hit|cast/i.test(name) ? 'battle' : 'social');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    if (!loaded) return;
    setBusy(true);
    setError(null);
    try {
      const src = await loaded.read();
      const json = convertMotion(src, src.animations[anim]!, { id: id || 'preview', loop, inPlace, source: loaded.files.map((f) => f.name).join(' + ').slice(0, 200), maxSeconds: 120 });
      setClip(json);
      registerClip(`import_preview`, json);
      play();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const play = () => {
    const a = handle.current?.avatar;
    if (!a) return;
    if (loop) void a.setBase('import_preview', 0.2);
    else {
      void a.setBase('idle', 0.2);
      void a.emote('import_preview');
    }
  };
  useEffect(() => {
    if (loaded) void convert();
  }, [loaded, anim, loop, inPlace]); // eslint-disable-line react-hooks/exhaustive-deps

  const idError = !EMOTE_ID.test(id) ? 'Lowercase letters, digits and _ (starting with a letter)' : BUILTIN_EMOTES.some((e) => e.id === id) ? 'That name is a built-in emote; choose another' : null;
  const save = async () => {
    if (!clip || idError) return;
    setBusy(true);
    try {
      await saveClip(id, { label: label.trim() || id, category, clip: { ...clip, id }, source: clip.source });
      forgetClip(id);
      toast({ title: `Saved “${label || id}”`, tone: 'success' });
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FileButton accept=".glb,.gltf,.vrma,.fbx,.bvh,.vmd,.pmx,.pmd" multiple onFiles={pick} icon={Upload} variant="secondary" loading={busy && !loaded}>
        Choose a motion file
      </FileButton>
      <p className="text-xs text-fg-2">GLB, VRMA, FBX and BVH are read here. A VMD needs its PMX model (choose both); VMD and some FBX files need Blender.</p>
      {error ? <p className="rounded-md bg-danger-soft p-2 text-sm text-danger" role="alert">{error}</p> : null}
      {loaded ? (
        <>
          <Preview3D src="/avatar/mannequin.glb" framing="full" className="h-[38dvh]" onLoaded={(h) => ((handle.current = h), h && clip && play())}>
            <div className="absolute bottom-2 right-2">
              <Button size="sm" variant="secondary" icon={Play} onClick={play} disabled={!clip}>
                Play
              </Button>
            </div>
            {busy ? (
              <div className="absolute inset-0 grid place-items-center">
                <Spinner />
              </div>
            ) : null}
          </Preview3D>
          {loaded.names.length > 1 ? (
            <Field label="Animation">
              <Select aria-label="Animation" value={anim} onChange={(e) => setAnim(Number(e.target.value))}>
                {loaded.names.map((n, i) => (
                  <option key={i} value={i}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <Input aria-label="Emote label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
            </Field>
            <Field label="Id" error={idError}>
              <Input aria-label="Emote id" value={id} maxLength={40} onChange={(e) => setId(e.target.value.toLowerCase())} />
            </Field>
          </div>
          <Field label="Kind">
            <Select aria-label="Kind" value={category} onChange={(e) => setCategory(e.target.value as EmoteCategory)}>
              {EMOTE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Loops (a pose, an idle or a dance)</span>
            <Switch checked={loop} onChange={setLoop} label="Loops" />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>Stay in place (remove walking forward)</span>
            <Switch checked={inPlace} onChange={setInPlace} label="Stay in place" />
          </label>
          <Button onClick={save} loading={busy} disabled={!clip || !!idError} data-testid="clip-save">
            Save emote
          </Button>
        </>
      ) : null}
    </div>
  );
}
