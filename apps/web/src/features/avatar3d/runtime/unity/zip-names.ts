/** Read only ZIP directory records, without inflating or buffering the archive. */
export async function unityZip(file: File, pattern = /\.(unitypackage|prefab|meta)$/i): Promise<boolean> {
  const tailAt = Math.max(0, file.size - 65557), tail = new DataView(await file.slice(tailAt).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50 && i + 22 + tail.getUint16(i + 20, true) === tail.byteLength) { eocd = i; break; }
  if (eocd < 0) return false;
  let size = tail.getUint32(eocd + 12, true), offset = tail.getUint32(eocd + 16, true);
  if (size === 0xffffffff || offset === 0xffffffff) {
    if (eocd < 20 || tail.getUint32(eocd - 20, true) !== 0x07064b50) throw new Error('Missing ZIP64 directory');
    const at = Number(tail.getBigUint64(eocd - 12, true));
    if (!Number.isSafeInteger(at) || at + 56 > file.size) throw new Error('Invalid ZIP64 directory');
    const record = new DataView(await file.slice(at, at + 56).arrayBuffer());
    if (record.getUint32(0, true) !== 0x06064b50) throw new Error('Invalid ZIP64 directory');
    size = Number(record.getBigUint64(40, true)); offset = Number(record.getBigUint64(48, true));
  }
  if (!Number.isSafeInteger(offset) || size > 16 * 1024 ** 2 || offset + size > file.size) throw new Error('ZIP directory exceeds its size limit');
  const directory = new DataView(await file.slice(offset, offset + size).arrayBuffer()), decoder = new TextDecoder();
  for (let at = 0; at + 46 <= directory.byteLength;) {
    if (directory.getUint32(at, true) !== 0x02014b50) throw new Error('Invalid ZIP directory entry');
    const n = directory.getUint16(at + 28, true), extra = directory.getUint16(at + 30, true), comment = directory.getUint16(at + 32, true);
    if (at + 46 + n + extra + comment > directory.byteLength) throw new Error('Truncated ZIP directory');
    const name = decoder.decode(new Uint8Array(directory.buffer, at + 46, n));
    if (pattern.test(name)) return true;
    at += 46 + n + extra + comment;
  }
  return false;
}
