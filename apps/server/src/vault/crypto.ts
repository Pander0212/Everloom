/**
 * Vault key handling. A random 32-byte data key encrypts everything; it is wrapped (AES-256-GCM) by
 * a key derived from the passphrase (scrypt, from node:crypto: no native build), and separately by
 * the recovery key. The database key and the media key are derived from the data key, so neither
 * is the data key itself.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

export interface KdfParams {
  N: number;
  r: number;
  p: number;
}
/** About 0.3 s and 128 MB per derivation on a small VPS: slow to guess, fine for an unlock. */
export const KDF: KdfParams = { N: 2 ** 17, r: 8, p: 1 };

export interface Wrapped {
  iv: string;
  tag: string;
  data: string;
}

export function deriveKek(secret: string, salt: Buffer, kdf: KdfParams = KDF): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(secret.normalize('NFKC'), salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export function wrapKey(key: Buffer, kek: Buffer): Wrapped {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', kek, iv);
  c.setAAD(Buffer.from('everloom-vault-key'));
  const data = Buffer.concat([c.update(key), c.final()]);
  return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/** The data key, or null when the secret was wrong (the tag doesn't match). */
export function unwrapKey(w: Wrapped, kek: Buffer): Buffer | null {
  try {
    const d = createDecipheriv('aes-256-gcm', kek, Buffer.from(w.iv, 'base64'));
    d.setAAD(Buffer.from('everloom-vault-key'));
    d.setAuthTag(Buffer.from(w.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(w.data, 'base64')), d.final()]);
  } catch {
    return null;
  }
}

// Recovery keys: 32 random bytes written in an unambiguous alphabet, in groups of four.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newRecoveryKey(): string {
  const bytes = randomBytes(30);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out.match(/.{1,4}/g)!.join('-');
}
export const normalizeRecoveryKey = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/[O]/g, '0').replace(/[I]/g, '1');

/** A purpose-bound key derived from the data key. */
export const subkey = (dataKey: Buffer, label: 'database' | 'media' | 'export') => Buffer.from(hkdfSync('sha256', dataKey, Buffer.alloc(0), `everloom-${label}-v1`, 32));

// ------------------------------------------------------------------ encrypted files

/** Files the vault wrote start with this, so plain and encrypted files can live side by side. */
export const FILE_MAGIC = Buffer.from('EVLTENC1');

export const isEncryptedBlob = (buf: Buffer) => buf.length >= FILE_MAGIC.length + 28 && timingSafeEqual(buf.subarray(0, FILE_MAGIC.length), FILE_MAGIC);

export function encryptBlob(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([FILE_MAGIC, iv, c.getAuthTag(), body]);
}

export function decryptBlob(key: Buffer, blob: Buffer): Buffer {
  const at = FILE_MAGIC.length;
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(at, at + 12));
  d.setAuthTag(blob.subarray(at + 12, at + 28));
  return Buffer.concat([d.update(blob.subarray(at + 28)), d.final()]);
}

/** Password-protected export files (any vault state): scrypt + AES-256-GCM, self-describing. */
const EXPORT_MAGIC = Buffer.from('EVLTEXP1');
export async function encryptWithPassword(password: string, plain: Buffer): Promise<Buffer> {
  const salt = randomBytes(16);
  const key = await deriveKek(password, salt);
  const inner = encryptBlob(key, plain);
  return Buffer.concat([EXPORT_MAGIC, salt, inner]);
}
export const isPasswordEncrypted = (buf: Buffer) => buf.length > 24 && buf.subarray(0, 8).equals(EXPORT_MAGIC);
export async function decryptWithPassword(password: string, buf: Buffer): Promise<Buffer | null> {
  try {
    const key = await deriveKek(password, buf.subarray(8, 24));
    return decryptBlob(key, buf.subarray(24));
  } catch {
    return null;
  }
}
