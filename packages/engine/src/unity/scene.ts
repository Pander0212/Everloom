/**
 * Resolves a prefab (or scene) into one flat set of objects: what's in the file itself, plus
 * everything brought in by prefab instances (a model, another prefab, a variant), with the
 * instance's modifications applied (active state, names, materials, blendshape values, transforms,
 * component fields) and removed objects and components taken out.
 *
 * Objects from a model (FBX) are known only by the node names its .meta lists; the three.js side
 * matches them to the loaded model by name.
 */
import { asList, asMap, asNum, asRef, asStr, parseUnityYaml, type UnityDoc, type UnityRef, type YamlMap, type YamlValue } from './yaml';
import { text, type UnityProject } from './project';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Quat extends Vec3 {
  w: number;
}

export interface SceneNode {
  key: string;
  name: string;
  parent: string | null;
  active: boolean;
  /** Set for nodes that come from a model file: the model's GUID and the node's name in it. */
  model?: { guid: string; node: string };
  pos?: Vec3;
  rot?: Quat;
  scale?: Vec3;
  comps: string[];
}

export type SceneComp =
  | { key: string; node: string; type: 'SkinnedMeshRenderer' | 'MeshRenderer'; enabled: boolean; materials: (UnityRef | null)[]; blendShapes: Record<number, number>; mesh: UnityRef | null; bones?: (UnityRef | null)[] }
  | { key: string; node: string; type: 'MonoBehaviour'; enabled: boolean; script: UnityRef | null; fields: YamlMap }
  | { key: string; node: string; type: 'Animator'; enabled: boolean; controller: UnityRef | null; avatar: UnityRef | null }
  | { key: string; node: string; type: 'Other'; classId: number; enabled: boolean };

export interface ResolvedScene {
  nodes: Map<string, SceneNode>;
  comps: Map<string, SceneComp>;
  /** The models (FBX GUIDs) this scene is built on. */
  models: Set<string>;
  /** Maps a file id (as written in the top file) to an object key: node or component. */
  keyOf(fileId: string): string | undefined;
  /** Notes about things that couldn't be resolved. */
  notes: string[];
}

interface Composite {
  nodes: Map<string, SceneNode>;
  comps: Map<string, SceneComp>;
  models: Set<string>;
  /** fileID in this asset → key (node or comp). */
  ids: Map<string, string>;
  /** "<source guid>:<fileID>" → key, for every object however deeply nested (variants target these). */
  origins: Map<string, string>;
  notes: string[];
}

const MAX_DEPTH = 12;

export function resolvePrefab(project: UnityProject, guid: string): ResolvedScene {
  const c = load(project, guid, 0, new Set());
  return { ...c, keyOf: (id) => c.ids.get(id) };
}

/** Resolves documents already parsed (a loose prefab file not in the project). */
export function resolveDocs(project: UnityProject, docs: UnityDoc[], guid = 'loose'): ResolvedScene {
  const c = fromDocs(project, guid, docs, 0, new Set([guid]));
  return { ...c, keyOf: (id) => c.ids.get(id) };
}

function empty(): Composite {
  return { nodes: new Map(), comps: new Map(), models: new Set(), ids: new Map(), origins: new Map(), notes: [] };
}

function load(project: UnityProject, guid: string, depth: number, seen: Set<string>, from?: { path: string; name: string }): Composite {
  // Without .meta files a prefab's model is found by name (the prefab's own, then the folder's model).
  const asset = project.get(guid) ?? (from ? project.guess(from.path, 'model', from.name) : undefined);
  if (!asset) {
    const c = empty();
    c.notes.push(`A referenced asset (${guid}) is not in the package.`);
    return c;
  }
  if (depth > MAX_DEPTH || seen.has(guid)) {
    const c = empty();
    c.notes.push(`${asset.path}: nested too deeply or refers to itself.`);
    return c;
  }
  if (asset.kind === 'model') return fromModel(project, asset.guid);
  return fromDocs(project, asset.guid, parseUnityYaml(text(asset.data)), depth, new Set([...seen, asset.guid]));
}

// ------------------------------------------------------------------ models (FBX)

/** fileID → [classId, name] from a model's .meta (internalIDToNameTable or fileIDToRecycleName). */
export function modelIdTable(meta: YamlMap | undefined): Map<string, { classId: number; name: string }> {
  const out = new Map<string, { classId: number; name: string }>();
  const imp = asMap(meta?.ModelImporter);
  for (const e of asList(imp.internalIDToNameTable).map(asMap)) {
    const first = asMap(e.first);
    const [cls, id] = Object.entries(first)[0] ?? [];
    if (cls === undefined || id === undefined) continue;
    out.set(asStr(id), { classId: Number(cls), name: asStr(e.second) });
  }
  const legacy = asMap(imp.fileIDToRecycleName);
  for (const [id, name] of Object.entries(legacy)) {
    // Legacy ids: class id × 100000 + n (e.g. 100002: a GameObject, 13700000: a SkinnedMeshRenderer).
    const n = Number(id);
    out.set(id, { classId: Math.floor(n / 100000), name: asStr(name) });
  }
  return out;
}

function fromModel(project: UnityProject, guid: string): Composite {
  const c = empty();
  const asset = project.get(guid)!;
  c.models.add(guid);
  const table = modelIdTable(asset.meta);
  const rootName = asset.path.split('/').pop()!.replace(/\.[^.]+$/, '');
  const node = (name: string) => {
    const nm = name === '//RootNode' ? rootName : name;
    let n = c.nodes.get(nm);
    if (!n) {
      n = { key: nm, name: nm, parent: null, active: true, model: { guid, node: nm }, comps: [] };
      c.nodes.set(nm, n);
    }
    return n;
  };
  // The root always exists, even when the table is empty (no .meta): the model itself.
  node(rootName);
  for (const [id, { classId, name }] of table) {
    if (classId === 1 || classId === 4) {
      c.ids.set(id, node(name).key);
      c.origins.set(`${guid}:${id}`, node(name).key);
    } else if (classId === 137 || classId === 23) {
      const n = node(name);
      const key = `${n.key}#${classId === 137 ? 'smr' : 'mr'}`;
      if (!c.comps.has(key)) {
        c.comps.set(key, { key, node: n.key, type: classId === 137 ? 'SkinnedMeshRenderer' : 'MeshRenderer', enabled: true, materials: [], blendShapes: {}, mesh: null });
        n.comps.push(key);
      }
      c.ids.set(id, key);
      c.origins.set(`${guid}:${id}`, key);
    } else if (classId === 95) {
      const n = node(name);
      const key = `${n.key}#animator`;
      if (!c.comps.has(key)) {
        c.comps.set(key, { key, node: n.key, type: 'Animator', enabled: true, controller: null, avatar: null });
        n.comps.push(key);
      }
      c.ids.set(id, key);
      c.origins.set(`${guid}:${id}`, key);
    }
  }
  // Every node of a model hangs under its root unless we know better (the FBX itself has the tree).
  for (const n of c.nodes.values()) if (n.key !== rootName) n.parent = rootName;
  return c;
}

// ------------------------------------------------------------------ prefab and scene files

function fromDocs(project: UnityProject, guid: string, docs: UnityDoc[], depth: number, seen: Set<string>): Composite {
  const c = empty();
  const byId = new Map(docs.map((d) => [d.fileId, d]));
  const pendingParents: { c: Composite; roots: string[]; father: string }[] = [];
  // 1. Prefab instances first: their objects are what stripped docs point at.
  const instances = new Map<string, Composite>();
  for (const d of docs) {
    if (d.classId !== 1001 || d.type !== 'PrefabInstance') continue;
    const src = asRef(d.body.m_SourcePrefab);
    if (!src?.guid) continue;
    const selfPath = project.get(guid)?.path ?? '';
    const inner = load(project, src.guid, depth + 1, seen, { path: selfPath, name: selfPath.split('/').pop()!.replace(/\.[^.]+$/, '').replace(/\s*variant$/i, '') });
    const prefix = `${d.fileId}/`;
    for (const n of inner.nodes.values()) c.nodes.set(prefix + n.key, { ...n, key: prefix + n.key, parent: n.parent ? prefix + n.parent : null, comps: n.comps.map((k) => prefix + k) });
    for (const k of inner.comps.values()) c.comps.set(prefix + k.key, { ...clone(k), key: prefix + k.key, node: prefix + k.node } as SceneComp);
    for (const m of inner.models) c.models.add(m);
    for (const [o, k] of inner.origins) c.origins.set(o, prefix + k);
    c.notes.push(...inner.notes);
    instances.set(d.fileId, inner);
    const mod = asMap(d.body.m_Modification);
    // Modifications target objects in the source asset.
    for (const raw of asList(mod.m_Modifications).map(asMap)) {
      const target = asRef(raw.target);
      if (!target) continue;
      // Usually an object of the source asset; in variants, the deepest source's object.
      const innerKey = target.guid && target.guid !== src.guid ? inner.origins.get(`${target.guid}:${target.fileID}`) : inner.ids.get(target.fileID);
      if (!innerKey) continue;
      applyMod(c, prefix + innerKey, asStr(raw.propertyPath), raw.value ?? null, asRef(raw.objectReference));
    }
    for (const r of asList(mod.m_RemovedComponents).map(asRef)) {
      const k = r && inner.ids.get(r.fileID);
      if (k) removeComp(c, prefix + k);
    }
    for (const r of asList(mod.m_RemovedGameObjects).map(asRef)) {
      const k = r && inner.ids.get(r.fileID);
      if (k) removeNode(c, prefix + k);
    }
    // Where the instance's root hangs in this file.
    const tp = asRef(mod.m_TransformParent);
    if (tp && tp.fileID !== '0') pendingParents.push({ c, roots: [...inner.nodes.values()].filter((n) => !n.parent).map((n) => prefix + n.key), father: tp.fileID });
  }
  // 2. Stripped docs map to objects inside an instance.
  for (const d of docs) {
    if (!d.stripped) continue;
    const inst = asRef(d.body.m_PrefabInstance);
    const corr = asRef(d.body.m_CorrespondingSourceObject);
    const inner = inst && instances.get(inst.fileID);
    const k = inner && corr ? (corr.guid && corr.guid !== asRef(byId.get(inst!.fileID)?.body.m_SourcePrefab)?.guid ? inner.origins.get(`${corr.guid}:${corr.fileID}`) : inner.ids.get(corr.fileID)) : undefined;
    if (k) c.ids.set(d.fileId, `${inst!.fileID}/${k}`);
  }
  // 3. This file's own GameObjects.
  for (const d of docs) {
    if (d.stripped || d.classId !== 1) continue;
    const key = d.fileId;
    c.nodes.set(key, { key, name: asStr(d.body.m_Name), parent: null, active: asNum(d.body.m_IsActive, 1) !== 0, comps: [] });
    c.ids.set(d.fileId, key);
    c.origins.set(`${guid}:${d.fileId}`, key);
  }
  // 4. Components (on own or stripped GameObjects).
  const nodeOfGo = (ref: UnityRef | null) => (ref ? c.ids.get(ref.fileID) : undefined);
  for (const d of docs) {
    if (d.stripped || d.classId === 1 || d.classId === 1001) continue;
    const nodeKey = nodeOfGo(asRef(d.body.m_GameObject));
    if (!nodeKey || !c.nodes.has(nodeKey)) continue;
    const node = c.nodes.get(nodeKey)!;
    const enabled = asNum(d.body.m_Enabled, 1) !== 0;
    const key = d.fileId;
    let comp: SceneComp | null = null;
    if (d.classId === 4 || d.classId === 224) {
      // Transform / RectTransform: the node's pose and parent.
      node.pos = vec(d.body.m_LocalPosition);
      node.rot = quat(d.body.m_LocalRotation);
      node.scale = vec(d.body.m_LocalScale, 1);
      c.ids.set(d.fileId, nodeKey);
      c.origins.set(`${guid}:${d.fileId}`, nodeKey);
      const father = asRef(d.body.m_Father);
      if (father && father.fileID !== '0') pendingParents.push({ c, roots: [nodeKey], father: father.fileID });
      continue;
    }
    if (d.classId === 137 || d.classId === 23) {
      const bs: Record<number, number> = {};
      asList(d.body.m_BlendShapeWeights).forEach((v, i) => {
        bs[i] = asNum(v);
      });
      comp = { key, node: nodeKey, type: d.classId === 137 ? 'SkinnedMeshRenderer' : 'MeshRenderer', enabled, materials: asList(d.body.m_Materials).map(asRef), blendShapes: bs, mesh: asRef(d.body.m_Mesh), bones: asList(d.body.m_Bones).map(asRef) };
    } else if (d.classId === 114) {
      const fields: YamlMap = {};
      for (const [k, v] of Object.entries(d.body)) if (!/^m_(ObjectHideFlags|CorrespondingSourceObject|PrefabInstance|PrefabAsset|GameObject|Enabled|EditorHideFlags|Script|EditorClassIdentifier)$/.test(k)) fields[k] = v;
      comp = { key, node: nodeKey, type: 'MonoBehaviour', enabled, script: asRef(d.body.m_Script), fields };
    } else if (d.classId === 95) {
      comp = { key, node: nodeKey, type: 'Animator', enabled, controller: asRef(d.body.m_Controller), avatar: asRef(d.body.m_Avatar) };
    } else comp = { key, node: nodeKey, type: 'Other', classId: d.classId, enabled };
    c.comps.set(key, comp);
    node.comps.push(key);
    c.ids.set(d.fileId, key);
    c.origins.set(`${guid}:${d.fileId}`, key);
  }
  // 5. Parents, now that every id is known.
  for (const p of pendingParents.splice(0)) {
    const fatherKey = p.c.ids.get(p.father);
    const fatherNode = fatherKey ? (p.c.nodes.has(fatherKey) ? fatherKey : (p.c.comps.get(fatherKey)?.node ?? null)) : null;
    if (!fatherNode) continue;
    for (const r of p.roots) {
      const n = p.c.nodes.get(r);
      if (n) n.parent = fatherNode;
    }
  }
  return c;
}


function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function vec(v: YamlValue | undefined, d = 0): Vec3 {
  const m = asMap(v);
  return { x: asNum(m.x, d), y: asNum(m.y, d), z: asNum(m.z, d) };
}
function quat(v: YamlValue | undefined): Quat {
  const m = asMap(v);
  return { x: asNum(m.x), y: asNum(m.y), z: asNum(m.z), w: asNum(m.w, 1) };
}

function removeComp(c: Composite, key: string) {
  const comp = c.comps.get(key);
  if (!comp) return;
  c.comps.delete(key);
  const n = c.nodes.get(comp.node);
  if (n) n.comps = n.comps.filter((k) => k !== key);
}

function removeNode(c: Composite, key: string) {
  const n = c.nodes.get(key);
  if (!n) return;
  for (const k of n.comps) c.comps.delete(k);
  c.nodes.delete(key);
  for (const child of [...c.nodes.values()]) if (child.parent === key) removeNode(c, child.key);
}

/** Applies one prefab modification to a node or component. */
function applyMod(c: Composite, key: string, path: string, value: YamlValue, ref: UnityRef | null) {
  const node = c.nodes.get(key);
  const comp = c.comps.get(key);
  const num = asNum(value);
  if (node) {
    if (path === 'm_IsActive') node.active = num !== 0;
    else if (path === 'm_Name') node.name = asStr(value);
    else {
      const t = /^m_Local(Position|Rotation|Scale)\.([xyzw])$/.exec(path);
      if (t) {
        const which = t[1] === 'Position' ? 'pos' : t[1] === 'Rotation' ? 'rot' : 'scale';
        const cur = (node[which] ?? (which === 'rot' ? { x: 0, y: 0, z: 0, w: 1 } : which === 'scale' ? { x: 1, y: 1, z: 1 } : { x: 0, y: 0, z: 0 })) as unknown as Record<string, number>;
        cur[t[2]!] = num;
        (node as unknown as Record<string, unknown>)[which] = cur;
      }
    }
    return;
  }
  if (!comp) return;
  if (path === 'm_Enabled') {
    comp.enabled = num !== 0;
    return;
  }
  if (comp.type === 'SkinnedMeshRenderer' || comp.type === 'MeshRenderer') {
    const bs = /^m_BlendShapeWeights\.Array\.data\[(\d+)\]$/.exec(path);
    if (bs) comp.blendShapes[Number(bs[1])] = num;
    const mat = /^m_Materials\.Array\.data\[(\d+)\]$/.exec(path);
    if (mat) comp.materials[Number(mat[1])] = ref;
    if (path === 'm_Materials.Array.size') comp.materials.length = num;
    return;
  }
  if (comp.type === 'MonoBehaviour') setField(comp.fields, path, ref ?? value);
}

/** Sets a serialized field by its property path ("a.b.Array.data[2].c", ".Array.size"). */
export function setField(fields: YamlMap, path: string, value: YamlValue | UnityRef) {
  const parts = path.replace(/\.Array\.data\[(\d+)\]/g, '.$1').replace(/\.Array\.size$/, '.#size').split('.');
  let cur: YamlValue = fields;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const nextIsIndex = /^\d+$/.test(parts[i + 1]!) || parts[i + 1] === '#size';
    const container = cur as Record<string, YamlValue>;
    let next: YamlValue | undefined = Array.isArray(cur) ? (cur as YamlValue[])[Number(p)] : container[p];
    if (next === undefined || next === null || typeof next !== 'object') {
      next = nextIsIndex ? [] : {};
      if (Array.isArray(cur)) (cur as YamlValue[])[Number(p)] = next;
      else container[p] = next;
    }
    cur = next;
  }
  const last = parts[parts.length - 1]!;
  if (last === '#size' && Array.isArray(cur)) {
    cur.length = asNum(value as YamlValue);
    return;
  }
  const v = (value && typeof value === 'object' && 'fileID' in value ? { ...(value as UnityRef) } : value) as YamlValue;
  if (Array.isArray(cur)) cur[Number(last)] = v;
  else (cur as Record<string, YamlValue>)[last] = v;
}

/** The path of node names from the root to this node. */
export function nodePath(scene: { nodes: Map<string, SceneNode> }, key: string): string[] {
  const out: string[] = [];
  let k: string | null = key;
  const guard = new Set<string>();
  while (k && !guard.has(k)) {
    guard.add(k);
    const n = scene.nodes.get(k);
    if (!n) break;
    out.unshift(n.name);
    k = n.parent;
  }
  return out;
}

/** True when this node and all its parents are active. */
export function activeInHierarchy(scene: { nodes: Map<string, SceneNode> }, key: string): boolean {
  let k: string | null = key;
  const guard = new Set<string>();
  while (k && !guard.has(k)) {
    guard.add(k);
    const n = scene.nodes.get(k);
    if (!n) return true;
    if (!n.active) return false;
    k = n.parent;
  }
  return true;
}
