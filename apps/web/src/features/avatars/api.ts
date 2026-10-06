/** 3D avatars API (no three.js here: this module is safe to load with 3D characters off). */
import type { AvatarConfig, AvatarKind, AvatarRecipe, ExpressionMap, HumanBone, RigBone } from '@everloom/engine';
import { useQuery } from '@tanstack/react-query';
import { api, del, get, patch, post, put } from '@/lib/api';
import { queryClient } from '@/lib/queries';

export interface AvatarSummary {
  id: string;
  name: string;
  kind: AvatarKind;
  status: 'processing' | 'ready' | 'failed';
  error: string | null;
  format: 'glb' | 'vrm0' | 'vrm1' | string;
  model: string | null;
  low: string | null;
  thumb: string | null;
  triangles: number | null;
  size: number | null;
  warnings: number;
  createdAt: number;
  updatedAt: number;
}

export interface ModelWarning {
  code: string;
  message: string;
  level: 'info' | 'heavy' | 'problem';
}

export interface ModelInfo {
  format: string;
  bytes: number;
  triangles: number;
  vertices: number;
  meshes: number;
  materials: number;
  textures: Array<{ index: number; mime: string; width: number; height: number; bytes: number }>;
  textureMemory: number;
  bones: RigBone[];
  joints: number;
  morphs: string[];
  vrmExpressions: string[];
  animations: string[];
  springs: boolean;
  boneMap: Partial<Record<HumanBone, string>>;
  missingBones: HumanBone[];
  convention: string;
  expressionMap: ExpressionMap;
  faceRig: string;
  meshNames: string[];
  materialNames: string[];
  warnings: ModelWarning[];
  report?: { before: number; after: number; low: number; textures: string; ktx2: number; webp: number; ms: number; notes: string[] };
  optimize?: { maxTexture?: number; ktx2?: boolean; lowRatio?: number };
  conversion?: Record<string, unknown> | null;
}

export interface AvatarDetail extends AvatarSummary {
  config: AvatarConfig;
  info: Partial<ModelInfo>;
  source: string | null;
}

export interface BlenderInfo {
  found: boolean;
  path: string | null;
  version: string | null;
  mmd: boolean;
  source: string | null;
}

export interface ClipSummary {
  id: string;
  label: string;
  category: string;
  source: string;
  createdAt: number;
}

export const avatarKeys = {
  list: ['avatars'] as const,
  one: (id: string) => ['avatar', id] as const,
  clips: ['avatar-clips'] as const,
  blender: ['blender'] as const,
};

export const useAvatars = (enabled = true) =>
  useQuery({
    queryKey: avatarKeys.list,
    queryFn: () => get<AvatarSummary[]>('/api/avatars'),
    enabled,
    // Keep checking while something is being processed.
    refetchInterval: (q) => ((q.state.data as AvatarSummary[] | undefined)?.some((a) => a.status === 'processing') ? 1500 : false),
  });

export const useAvatar = (id?: string | null) =>
  useQuery({
    queryKey: avatarKeys.one(id ?? ''),
    queryFn: () => get<AvatarDetail>(`/api/avatars/${id}`),
    enabled: !!id,
    refetchInterval: (q) => ((q.state.data as AvatarDetail | undefined)?.status === 'processing' ? 1200 : false),
  });

export const useAvatarClips = (enabled = true) => useQuery({ queryKey: avatarKeys.clips, queryFn: () => get<ClipSummary[]>('/api/avatar-clips'), enabled });
export const useBlender = (enabled = true) => useQuery({ queryKey: avatarKeys.blender, queryFn: () => get<BlenderInfo>('/api/blender'), enabled, staleTime: 5 * 60_000 });

function refresh(id?: string) {
  void queryClient.invalidateQueries({ queryKey: avatarKeys.list });
  if (id) void queryClient.invalidateQueries({ queryKey: avatarKeys.one(id) });
}

export async function uploadAvatar(file: File, name?: string): Promise<AvatarSummary> {
  const r = await api<AvatarSummary>('/api/avatars', { method: 'POST', raw: file, contentType: 'application/octet-stream', query: { filename: file.name, name } });
  refresh();
  return r;
}

export async function saveAvatar(id: string, body: { name?: string; config?: AvatarConfig }): Promise<AvatarDetail> {
  const r = await patch<AvatarDetail>(`/api/avatars/${id}`, body);
  queryClient.setQueryData(avatarKeys.one(id), r);
  refresh();
  return r;
}

export async function reprocessAvatar(id: string, opts: { maxTexture?: number; ktx2?: boolean; lowRatio?: number }) {
  const r = await post<AvatarSummary>(`/api/avatars/${id}/reprocess`, opts);
  refresh(id);
  return r;
}

export async function deleteAvatar(id: string) {
  const r = await del<{ ok: true; unlinked: number }>(`/api/avatars/${id}`);
  queryClient.removeQueries({ queryKey: avatarKeys.one(id) });
  refresh();
  void queryClient.invalidateQueries({ queryKey: ['characters'] });
  return r;
}

export async function setAvatarThumbnail(id: string, png: Blob) {
  const r = await api<AvatarSummary>(`/api/avatars/${id}/thumbnail`, { method: 'POST', raw: png, contentType: 'image/png' });
  refresh(id);
  return r;
}

export async function addOutfitModel(id: string, file: File) {
  return api<{ model: string; modelLow: string; url: string; triangles: number; warnings: ModelWarning[] }>(`/api/avatars/${id}/outfit-model`, { method: 'POST', raw: file, contentType: 'application/octet-stream', query: { filename: file.name } });
}

export async function setBlenderPath(path: string | null) {
  const r = await put<BlenderInfo>('/api/blender', { path });
  queryClient.setQueryData(avatarKeys.blender, r);
  return r;
}

export async function refreshBlender() {
  const r = await get<BlenderInfo>('/api/blender', { refresh: '1' });
  queryClient.setQueryData(avatarKeys.blender, r);
  return r;
}

export async function saveClip(id: string, body: { label: string; category: string; clip: unknown; source?: string }) {
  const r = await put(`/api/avatar-clips/${id}`, body);
  void queryClient.invalidateQueries({ queryKey: avatarKeys.clips });
  return r;
}

export async function deleteClip(id: string) {
  await del(`/api/avatar-clips/${id}`);
  void queryClient.invalidateQueries({ queryKey: avatarKeys.clips });
}

export const fmtBytes = (n: number | null | undefined) => (n == null ? '—' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** A code-made character (a recipe, no model file). */
export async function createCodeAvatar(name: string, recipe: AvatarRecipe): Promise<AvatarSummary> {
  const r = await post<AvatarSummary>('/api/avatars/code', { name, recipe });
  refresh();
  return r;
}

/** A recipe from a character's description: the utility model when there is one, else the text alone. */
export const fillRecipe = (body: { characterId?: string; name?: string; text?: string }) => post<{ recipe: AvatarRecipe; source: 'model' | 'text' }>('/api/avatars/recipe', body);
