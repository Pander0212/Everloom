/** Part packs for the parts maker: the list, each pack's manifest, and where its files are. */
import { PackManifestSchema, type PackManifest } from '@everloom/engine';
import { useQuery } from '@tanstack/react-query';
import { api, del, get, patch } from '@/lib/api';
import { queryClient } from '@/lib/queries';

export interface PackDTO {
  id: string;
  name: string;
  builtin: boolean;
  enabled: boolean;
  license: string;
  credits: string;
  base: string | null;
  files: Record<string, string> | null;
  manifest: PackManifest | null;
  parts: number;
  size: number;
  createdAt: number;
}

export interface LoadedPack extends PackDTO {
  manifest: PackManifest;
}

const KEY = ['avatar-packs'] as const;

/** Every pack with its manifest (built-in manifests come from the app's own files). */
export const usePacks = (enabled = true) =>
  useQuery({
    queryKey: KEY,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<LoadedPack[]> => {
      const list = await get<PackDTO[]>('/api/avatar-packs');
      return Promise.all(
        list.map(async (p) => {
          if (p.manifest) return p as LoadedPack;
          const r = await fetch(`${p.base}manifest.json`);
          const m = PackManifestSchema.parse(await r.json());
          return { ...p, manifest: m, parts: m.traits.reduce((a, g) => a + g.collection.length, 0) };
        }),
      );
    },
  });

/** The URL of a file in a pack (a path as the manifest resolves it), or null if it isn't there. */
export function packFile(p: PackDTO, path: string): string | null {
  if (p.base) return `${p.base}${path}`;
  return p.files?.[path] ?? null;
}

/** How a garment refers to a pack file: the built-in path, or the media id. */
export function packRef(p: PackDTO, path: string): string | null {
  const url = packFile(p, path);
  if (!url) return null;
  return p.base ? url : url.replace(/^\/media\//, '');
}

export async function importPack(file: File) {
  const r = await api<PackDTO>('/api/avatar-packs', { method: 'POST', raw: file, contentType: 'application/zip', query: { name: undefined } });
  void queryClient.invalidateQueries({ queryKey: KEY });
  return r;
}
export async function setPackEnabled(id: string, enabled: boolean) {
  await patch(`/api/avatar-packs/${id}`, { enabled });
  void queryClient.invalidateQueries({ queryKey: KEY });
}
export async function deletePack(id: string) {
  await del(`/api/avatar-packs/${id}`);
  void queryClient.invalidateQueries({ queryKey: KEY });
}
