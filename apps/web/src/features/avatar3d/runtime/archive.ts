/**
 * Archives as BOOTH and Gumroad deliver them (.zip, .7z, .rar), unpacked in the browser with
 * libarchive.js (MIT; libarchive is BSD-2, its RAR reader a clean-room implementation). Runs in
 * libarchive's own worker; limits stop archives that unpack to too much, entries that climb out of
 * the archive are skipped, and encrypted archives are refused with a clear message.
 */
const MAX_FILES = 20_000;
const MAX_TOTAL = 2 * 1024 * 1024 * 1024;

export const ARCHIVE = /\.(zip|7z|rar)$/i;

export class ArchiveError extends Error {}

/** The archive's files as File objects, with their paths ("Avatar/Assets/…") as names in `path`. */
export async function unpackArchive(file: File, progress: (s: string) => void = () => {}): Promise<{ path: string; file: File }[]> {
  progress(`Opening ${file.name}…`);
  const { Archive } = await import('libarchive.js');
  Archive.init({ workerUrl: '/archive/worker-bundle.js' });
  const archive = await Archive.open(file);
  try {
    if (await archive.hasEncryptedData()) throw new ArchiveError(`${file.name} is password-protected. Unpack it with its password on your PC first, then drop the files here.`);
    const list = (await archive.getFilesArray()) as { file: { name: string; size: number; extract: () => Promise<File> }; path: string }[];
    if (list.length > MAX_FILES) throw new ArchiveError(`${file.name} holds more than ${MAX_FILES} files.`);
    const total = list.reduce((n, e) => n + (e.file.size ?? 0), 0);
    if (total > MAX_TOTAL) throw new ArchiveError(`${file.name} unpacks to more than 2 GB.`);
    progress(`Unpacking ${list.length} files…`);
    const out: { path: string; file: File }[] = [];
    for (const e of list) {
      const p = `${e.path}${e.file.name}`.replace(/\\/g, '/').replace(/^\/+/, '');
      if (!p || p.split('/').includes('..') || p.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(p)) continue;
      out.push({ path: p, file: await e.file.extract() });
    }
    return out;
  } finally {
    await archive.close?.().catch?.(() => {});
  }
}

/** Formats that can't be imported, with what to do instead. */
export function unsupportedMessage(name: string, head?: Uint8Array): string | null {
  const n = name.toLowerCase();
  if (n.endsWith('.vrca') || (head && new TextDecoder().decode(head.subarray(0, 7)) === 'UnityFS')) return `${name} is a VRChat upload (an asset bundle): it's built for VRChat only and can't be opened. Import the avatar's .unitypackage from where you bought it instead.`;
  if (/\.(cs3c|cs3o|cs3s)$/.test(n)) return `${name} is a Clip Studio 3D file, a format only Clip Studio reads. In Clip Studio, export the model as FBX or OBJ and import that.`;
  if (/\.(vroid|vroidcustomitem)$/.test(n)) return `${name} is a VRoid Studio project. Open it in VRoid Studio and export it as VRM, then import the .vrm.`;
  if (/\.(max|ma|mb|c4d|lwo|skp|3dm|hip|spp|ztl|zpr)$/.test(n)) return `${name} is a project file of another 3D program. Export the character from it as FBX, glTF/GLB or OBJ.`;
  return null;
}
