import type { AvatarConfig } from '@everloom/engine';
import { apiFetch, exportHeaders, upload } from '@/lib/api';

export async function downloadPreset(id: string, config: AvatarConfig, kind: 'character' | 'rig') {
  const headers = await exportHeaders(); if (!headers) return;
  const response = await apiFetch(`/api/avatars/${id}/preset-export`, { body: { config, kind }, headers });
  const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
  link.href = url; link.download = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? `${kind}-preset.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export async function readPreset(id: string, file: File) {
  if (file.size > 1024 * 1024) throw new Error('Presets must be smaller than 1 MB.');
  return upload(`/api/avatars/${id}/preset-import`, new Blob([await file.arrayBuffer()], { type: 'application/octet-stream' }));
}
