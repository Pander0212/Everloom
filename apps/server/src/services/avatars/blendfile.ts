/**
 * Blender's own files (.blend), opened by the Blender worker. A .blend can come alone (textures
 * packed into it with File › External Data › Pack Resources) or in a zip with the folders its
 * textures sit in, so its relative paths (`//textures/skin.png`) still resolve.
 *
 * Opening a .blend never runs code from it: the worker starts Blender with auto-run off and opens
 * the file with scripts disabled (drivers and registered scripts stay inert).
 */
import path from 'node:path';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { HttpError } from '../../context.js';

const GZIP = [0x1f, 0x8b];
const ZSTD = [0x28, 0xb5, 0x2f, 0xfd];
const starts = (b: Buffer, sig: number[]) => sig.every((v, i) => b[i] === v);

/** A .blend by its header (Blender 3+ may save it compressed: then the name decides). */
export function isBlend(b: Buffer, filename = ''): boolean {
  if (b.subarray(0, 7).toString('latin1') === 'BLENDER') return true;
  return /\.blend$/i.test(filename) && (starts(b, GZIP) || starts(b, ZSTD));
}

export function isZip(b: Buffer) {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

/** A path inside a zip that's safe to recreate in a job folder (no climbing out, nothing odd). */
export function safeRelPath(name: string): string | null {
  if (!name || name.length > 400 || /[\u0000-\u001f\\]/.test(name) || name.startsWith('/')) return null;
  const parts = name.split('/').filter(Boolean);
  if (!parts.length || parts.length > 12 || parts.some((p) => p === '.' || p === '..' || p.length > 120)) return null;
  const norm = path.posix.normalize(parts.join('/'));
  return norm.startsWith('..') ? null : norm;
}

/** Does this zip hold a .blend? (Read without unpacking the contents.) */
export function zipHasBlend(b: Buffer): boolean {
  if (!isZip(b)) return false;
  let found = false;
  try {
    unzipSync(new Uint8Array(b), {
      filter: (f) => {
        if (/\.blend$/i.test(f.name) && !f.name.startsWith('__MACOSX/')) found = true;
        return false;
      },
    });
  } catch {
    return false;
  }
  return found;
}

/**
 * The files for a Blender job and which one to open: a lone .blend, or the zip's files with their
 * folders (the .blend nearest the top, if there are several).
 */
export function blendJobFiles(bytes: Buffer, filename = ''): { files: Record<string, Buffer>; input: string } {
  if (isBlend(bytes, filename)) return { files: { 'input.blend': bytes }, input: 'input.blend' };
  if (!isZip(bytes)) throw new HttpError(415, 'Not a .blend file or a zip with one inside');
  let raw: Record<string, Uint8Array>;
  try {
    let total = 0;
    let count = 0;
    raw = unzipSync(new Uint8Array(bytes), {
      filter: (f) => {
        if (f.name.endsWith('/') || f.name.startsWith('__MACOSX/') || f.name.split('/').some((p) => p.startsWith('._'))) return false;
        count++;
        total += f.originalSize;
        if (count > 3000 || total > 1024 * 1024 * 1024) throw new Error('the zip unpacks to too much');
        return true;
      },
    });
  } catch (e) {
    throw new HttpError(400, `Not a readable zip: ${(e as Error).message}`);
  }
  const files: Record<string, Buffer> = {};
  for (const [name, data] of Object.entries(raw)) {
    const rel = safeRelPath(name);
    if (rel) files[`blend/${rel}`] = Buffer.from(data);
  }
  const blends = Object.keys(files)
    .filter((n) => /\.blend$/i.test(n) && isBlend(files[n]!, n))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  if (!blends.length) throw new HttpError(400, 'No .blend file in that zip');
  return { files, input: blends[0]! };
}

/**
 * The Blender version that saved a .blend, from its header ("BLENDER-v402" → "4.2"; Blender 5's
 * "BLENDER17-01v0500" → "5.0"), also inside gzip or zstd compression. Null if it can't be read.
 */
export function blendVersion(bytes: Buffer): string | null {
  let head = bytes.subarray(0, 32);
  try {
    if (starts(bytes, ZSTD)) head = zstdDecompressSync(bytes, { maxOutputLength: 64 * 1024 * 1024 } as never).subarray(0, 32);
    else if (starts(bytes, GZIP)) head = gunzipSync(bytes).subarray(0, 32);
  } catch {
    // A zstd stream may stop early when cut short; only the header is needed.
    try {
      if (starts(bytes, ZSTD)) head = zstdDecompressSync(bytes.subarray(0, 1 << 20) as Buffer).subarray(0, 32);
    } catch {
      return null;
    }
  }
  const h = head.toString('latin1');
  const old = /^BLENDER[_-][vV](\d)(\d\d)/.exec(h);
  if (old) return `${old[1]}.${Number(old[2])}`;
  const v5 = /^BLENDER\d\d-\d\d[vV](\d\d)(\d\d)/.exec(h);
  if (v5) return `${Number(v5[1])}.${Number(v5[2])}`;
  return null;
}

const vnum = (v: string) => {
  const [a, b] = v.split('.').map(Number);
  return (a ?? 0) * 100 + (b ?? 0);
};

/** True when the file was saved by a newer Blender than the one converting it. */
export function newerThan(file: string | null, blender: string | null): boolean {
  return !!file && !!blender && vnum(file) > vnum(blender);
}

/** Plain-words notes about what Blender found in a .blend (for the import report). */
export function blendNotes(result: Record<string, unknown>, fileVersion: string | null = null, via = 'Blender on this server'): Array<{ code: string; message: string; level: 'info' | 'problem' }> {
  const conv = typeof result.blender === 'string' ? result.blender.replace(/\s.*$/, '') : null;
  const head: Array<{ code: string; message: string; level: 'info' | 'problem' }> = [];
  if (conv) head.push({ code: 'blend_converter', message: `Converted by Blender ${conv} (${via})${fileVersion ? `; the file was saved with Blender ${fileVersion}` : ''}: meshes, armature, weights, shape keys and materials.`, level: 'info' });
  if (newerThan(fileVersion, conv)) head.push({ code: 'blend_newer', message: `The file is from a newer Blender (${fileVersion}) than the converter (${conv}); newer features may be missing. Install Blender ${fileVersion} or newer for a faithful import.`, level: 'problem' });
  const actions = Array.isArray(result.actions) ? (result.actions as string[]) : [];
  if (actions.length) head.push({ code: 'blend_actions', message: `${actions.length} animation${actions.length === 1 ? '' : 's'} in the file (${actions.slice(0, 4).join(', ')}${actions.length > 4 ? '…' : ''}): import ${actions.length === 1 ? 'it' : 'them'} as motions in Settings › 3D characters › Motion clips with the same file.`, level: 'info' });
  const b = result.blend as { missingTextures?: string[]; missingLibraries?: number; skipped?: number; subdivRemoved?: number; modifiersNotApplied?: number } | undefined;
  if (!b) return head;
  const out: Array<{ code: string; message: string; level: 'info' | 'problem' }> = head;
  if (b.missingTextures?.length) out.push({ code: 'blend_missing_textures', message: `${b.missingTextures.length} texture${b.missingTextures.length === 1 ? ' was' : 's were'} not found (${b.missingTextures.slice(0, 3).join(', ')}${b.missingTextures.length > 3 ? '…' : ''}). Pack them into the .blend (File › External Data › Pack Resources) or zip the .blend with its texture folders.`, level: 'problem' });
  if (b.missingLibraries) out.push({ code: 'blend_missing_libraries', message: `${b.missingLibraries} linked .blend file${b.missingLibraries === 1 ? ' is' : 's are'} missing; linked parts are left out. Make them local in Blender (Object › Relations › Make Local) or include them in the zip.`, level: 'problem' });
  if (b.skipped) out.push({ code: 'blend_skipped', message: `${b.skipped} object${b.skipped === 1 ? ' was' : 's were'} left out (cameras, lights, and anything hidden from render).`, level: 'info' });
  if (b.subdivRemoved) out.push({ code: 'blend_subdivision', message: 'Subdivision modifiers were dropped (too heavy for the stage); the base mesh is used.', level: 'info' });
  if (b.modifiersNotApplied) out.push({ code: 'blend_modifiers', message: `${b.modifiersNotApplied} modifier${b.modifiersNotApplied === 1 ? ' was' : 's were'} not applied (on meshes with shape keys, or they failed). Apply them in Blender if the shape looks wrong.`, level: 'info' });
  return out;
}
