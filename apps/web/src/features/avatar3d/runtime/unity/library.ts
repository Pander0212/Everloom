import { api, apiFetch } from '@/lib/api';
import { UnityProject, dependencyAssets, type UnityAsset } from '@everloom/engine/unity';
type Job = { id: string; offset: number; state: 'uploading' | 'processing' | 'done' | 'failed'; error?: string; result?: { guids?: string[]; avatar?: string } };
const CHUNK = 4 * 1024 * 1024;
async function uploadFiles(files: File[], progress: (s: string) => void, signal?: AbortSignal, mode: 'library' | 'avatar' = 'library') {
  let avatar: string | undefined;
  const recent = new Set<string>();
  for (const file of files) {
    // A bounded fingerprint identifies reselected files after reload. Retried chunks are also verified by the server.
    const sample = new Uint8Array(await new Blob([String(file.size), String(file.lastModified), file.slice(0, 65536), file.slice(-65536)]).arrayBuffer());
    const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', sample))].map(v => v.toString(16).padStart(2, '0')).join('');
    const name = (file as File & { relPath?: string }).relPath || file.webkitRelativePath || file.name;
    let job = await api<Job>('/api/unity/uploads', { body: { name, size: file.size, fingerprint }, signal });
    while (job.offset < file.size) {
      signal?.throwIfAborted();
      progress(`Uploading ${file.name}: ${Math.round(job.offset / file.size * 100)}%. Reselect the same file to resume if interrupted.`);
      job = await api<Job>(`/api/unity/uploads/${job.id}`, { method: 'PUT', raw: file.slice(job.offset, job.offset + CHUNK), query: { offset: job.offset }, signal });
    }
    job = await api<Job>(`/api/unity/uploads/${job.id}/process`, { body: { mode }, signal });
    const cancel = () => { void api(`/api/unity/uploads/${job.id}/cancel`, { body: {} }).catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      while (job.state === 'processing') {
        signal?.throwIfAborted(); progress(`Indexing ${file.name} on your server…`);
        await new Promise(r => setTimeout(r, 750));
        job = await api<Job>(`/api/unity/uploads/${job.id}`, { signal });
      }
      if (job.state !== 'done') throw new Error(job.error || 'Unity indexing failed');
      avatar = job.result?.avatar ?? avatar;
      job.result?.guids?.forEach(g => recent.add(g));
      await api(`/api/unity/uploads/${job.id}`, { method: 'DELETE', signal });
    } finally { signal?.removeEventListener('abort', cancel); }
  }
  return { recent, avatar };
}
export async function uploadBlend(files: File[], progress: (s: string) => void, signal?: AbortSignal) {
  const result = await uploadFiles(files, progress, signal, 'avatar');
  if (!result.avatar) throw new Error('No avatar was created');
  return result.avatar;
}
export async function readUnityLibrary(files: File[], progress: (s: string) => void, signal?: AbortSignal) {
  const { recent } = await uploadFiles(files, progress, signal);
  const manifest = await api<(Omit<UnityAsset, 'data'> & { text?: string })[]>('/api/unity/library', { signal });
  const p = new UnityProject();
  for (const guid of recent) p.recent.add(guid);
  for (const { text, ...a } of manifest) p.add({ ...a, data: text === undefined ? undefined : new TextEncoder().encode(text) });
  return p;
}
export async function hydrateUnity(project: UnityProject, guid: string, progress: (s: string) => void) {
  const deps = new Set(dependencyAssets(project, guid).assets);
  // Keep only the selected dependency set in browser memory between builds.
  for (const a of project.all()) if (a.sourceId && ['model', 'texture'].includes(a.kind) && !deps.has(a.guid)) a.data = undefined;
  const size = [...deps].reduce((n, id) => n + (project.get(id)?.size ?? project.get(id)?.data?.byteLength ?? 0), 0);
  if (size > 256 * 1024 ** 2) throw new Error('This item needs more than 256 MiB to convert in the browser. Reduce its model or texture sizes first. The source remains in your library.');
  for (const id of deps) {
    const a = project.get(id); if (!a?.sourceId || a.data) continue;
    progress(`Loading ${a.path}…`);
    a.data = new Uint8Array(await (await apiFetch(`/api/unity/library/${a.sourceId}`)).arrayBuffer());
  }
}
