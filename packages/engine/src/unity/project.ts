/**
 * A Unity project's assets, from a `.unitypackage` (GUID folders) or from loose, already extracted
 * files (paths, with or without their `.meta` files). Everything else reads assets through this:
 * by GUID when the `.meta` files are there, by path and name when they aren't.
 */
import { parseYaml, asMap, asStr, type YamlMap } from './yaml';
import type { TarEntry } from './tar';

export type UnityKind = 'model' | 'texture' | 'material' | 'prefab' | 'scene' | 'anim' | 'controller' | 'asset' | 'script' | 'shader' | 'audio' | 'text' | 'folder' | 'other';

export interface UnityAsset {
  guid: string;
  /** "Assets/Author/Avatar/Body.fbx" */
  path: string;
  kind: UnityKind;
  data?: Uint8Array;
  meta?: YamlMap;
  /** True when the GUID was made up from the path (no .meta file). */
  guessed?: boolean;
}

const EXT: Record<string, UnityKind> = {
  fbx: 'model', obj: 'model', dae: 'model', blend: 'model', '3ds': 'model',
  png: 'texture', jpg: 'texture', jpeg: 'texture', tga: 'texture', psd: 'texture', tif: 'texture', tiff: 'texture', bmp: 'texture', exr: 'texture', hdr: 'texture', gif: 'texture', webp: 'texture', dds: 'texture',
  mat: 'material', prefab: 'prefab', unity: 'scene', anim: 'anim', controller: 'controller', overridecontroller: 'controller', mask: 'asset', asset: 'asset', physicMaterial: 'asset',
  cs: 'script', dll: 'script', js: 'script',
  shader: 'shader', cginc: 'shader', hlsl: 'shader', shadergraph: 'shader', compute: 'shader',
  wav: 'audio', mp3: 'audio', ogg: 'audio',
  txt: 'text', md: 'text', pdf: 'text', html: 'text', json: 'text', url: 'text',
};

export function kindOf(path: string): UnityKind {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT[ext] ?? 'other';
}

export class UnityProject {
  readonly byGuid = new Map<string, UnityAsset>();
  readonly byPath = new Map<string, UnityAsset>();
  /** Links made by name because a .meta was missing (shown in the report; the owner can change them). */
  readonly guessed: { from: string; to: string; how: string; kind: UnityKind; key: string }[] = [];
  /** The owner's own choices in "Link missing files": guess key → asset GUID ('' = none). */
  readonly choices = new Map<string, string>();
  /** Links the owner set by hand in "Link missing files": missing GUID → asset GUID. */
  readonly links = new Map<string, string>();

  add(a: UnityAsset) {
    this.byGuid.set(a.guid, a);
    this.byPath.set(normPath(a.path), a);
  }
  get(guid: string | undefined) {
    if (!guid) return undefined;
    return this.byGuid.get(guid) ?? this.byGuid.get(this.links.get(guid) ?? '');
  }
  /**
   * A referenced file whose GUID isn't known (its .meta is missing): the best match by kind, name and
   * folder. `hint` is a name to look for (a material's name for its texture, a prefab's for its model).
   */
  guess(from: string, kind: UnityKind, hint?: string, slot?: string): UnityAsset | undefined {
    if (this.exact) return undefined;
    const key = `${from}|${kind}|${slot ?? ''}`;
    if (this.choices.has(key)) {
      const chosen = this.byGuid.get(this.choices.get(key)!);
      this.guessed.push({ from, to: chosen?.path ?? '', how: 'chosen by you', kind, key });
      return chosen;
    }
    const dir = dirName(from);
    const pool = this.all(kind).filter((a) => a.guessed);
    if (!pool.length) return undefined;
    const near = (a: UnityAsset) => commonPrefix(dirName(a.path), dir);
    const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u3040-\u9fff]+/g, ' ').trim();
    const h = hint ? words(hint) : '';
    const score = (a: UnityAsset) => {
      const n = words(stem(a.path));
      let v = near(a) / 100;
      if (h && n === h) v += 10;
      else if (h && (n.includes(h) || h.includes(n))) v += 5;
      if (slot && /bump|normal/i.test(slot)) v += /normal|nrm|_n\b/i.test(a.path) ? 3 : -3;
      else if (slot && /main|base|albedo|color/i.test(slot)) v += /normal|nrm|mask|emi|matcap|shadow/i.test(a.path) ? -3 : 1;
      return v;
    };
    const best = pool.sort((a, b) => score(b) - score(a))[0];
    if (!best || (h && score(best) < 1 && pool.length > 1)) {
      this.guessed.push({ from, to: '', how: 'no match found', kind, key });
      return undefined;
    }
    this.guessed.push({ from, to: best.path, how: hint ? `by the name “${hint}”` : 'the only one in its folder', kind, key });
    return best;
  }
  all(kind?: UnityKind) {
    const out = [...this.byGuid.values()];
    return kind ? out.filter((a) => a.kind === kind) : out;
  }
  /** Finds an asset by file name (without the folder), preferring the same folder as `near`. */
  byName(name: string, near?: string, kind?: UnityKind): UnityAsset | undefined {
    const want = name.toLowerCase();
    const hits = this.all(kind).filter((a) => baseName(a.path).toLowerCase() === want || stem(a.path).toLowerCase() === want);
    if (hits.length <= 1 || !near) return hits[0];
    const dir = dirName(near);
    return hits.find((h) => dirName(h.path) === dir) ?? hits.sort((x, y) => commonPrefix(y.path, near) - commonPrefix(x.path, near))[0];
  }
  /** True when every asset came with its .meta (references resolve exactly). */
  get exact() {
    return this.all().every((a) => !a.guessed);
  }
}

export const normPath = (p: string) => p.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
export const baseName = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p;
export const stem = (p: string) => baseName(p).replace(/\.[^.]+$/, '');
export const dirName = (p: string) => p.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
const commonPrefix = (a: string, b: string) => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i;
};

const dec = new TextDecoder();
export const text = (d: Uint8Array | undefined) => (d ? dec.decode(d) : '');

/** Makes a stable stand-in GUID for a file that has no .meta. */
export function pathGuid(path: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1234567;
  const s = normPath(path);
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822507) >>> 0;
  }
  return ('path' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).padEnd(32, '0').slice(0, 32);
}

/** Groups a .unitypackage's tar entries (GUID/asset, GUID/asset.meta, GUID/pathname) into a project. */
export function projectFromPackage(entries: Iterable<TarEntry>): UnityProject {
  const groups = new Map<string, { asset?: Uint8Array; meta?: Uint8Array; pathname?: string }>();
  for (const e of entries) {
    const m = /^([0-9a-f]{32})\/(asset|asset\.meta|pathname)$/i.exec(e.name);
    if (!m) continue;
    const g = groups.get(m[1]!.toLowerCase()) ?? {};
    if (m[2] === 'asset') g.asset = e.data;
    else if (m[2] === 'asset.meta') g.meta = e.data;
    // The pathname file can have a second line (a hash in older packages): keep the first.
    else g.pathname = text(e.data).split('\n')[0]!.trim();
    groups.set(m[1]!.toLowerCase(), g);
  }
  const p = new UnityProject();
  for (const [guid, g] of groups) {
    if (!g.pathname) continue;
    const path = safeUnityPath(g.pathname);
    if (!path) continue;
    const meta = g.meta ? safeMeta(g.meta) : undefined;
    p.add({ guid, path, kind: g.asset ? kindOf(path) : 'folder', data: g.asset, meta });
  }
  return p;
}

/** Builds a project from loose files (a folder upload, a zip, or files dropped together). */
export function projectFromFiles(files: { path: string; data: Uint8Array }[]): UnityProject {
  const metas = new Map<string, Uint8Array>();
  for (const f of files) if (/\.meta$/i.test(f.path)) metas.set(normPath(f.path.replace(/\.meta$/i, '')), f.data);
  const p = new UnityProject();
  for (const f of files) {
    if (/\.meta$/i.test(f.path)) continue;
    const path = safeUnityPath(f.path);
    if (!path) continue;
    const metaRaw = metas.get(normPath(f.path));
    const meta = metaRaw ? safeMeta(metaRaw) : undefined;
    const guid = asStr(meta?.guid).toLowerCase();
    p.add({ guid: /^[0-9a-f]{32}$/.test(guid) ? guid : pathGuid(path), path, kind: kindOf(path), data: f.data, meta, guessed: !/^[0-9a-f]{32}$/.test(guid) });
  }
  return p;
}

/** A Unity path, kept as a logical name only; refuses anything that tries to climb out. */
export function safeUnityPath(p: string): string | null {
  const s = p.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!s || s.split('/').some((seg) => seg === '..') || /^[a-z]:/i.test(s) || s.includes('\0')) return null;
  return s;
}

function safeMeta(d: Uint8Array): YamlMap | undefined {
  try {
    return parseYaml(text(d));
  } catch {
    return undefined;
  }
}

/** The importer section of a .meta (ModelImporter, TextureImporter, …). */
export function importer(meta: YamlMap | undefined, name: string): YamlMap {
  return asMap(meta?.[name]);
}
