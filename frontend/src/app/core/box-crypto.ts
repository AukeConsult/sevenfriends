import { EncryptedUploadHeader, PublishedKey, SafeboxEnc, SafeboxKind } from '../models';

/**
 * The encryption of a safebox file (design: docs/design/safebox-encryption.md). Each file gets a random AES-256-GCM key; the file, its small
 * preview and its name and type ("meta") are locked with it. The file key is then locked (RSA-OAEP) once for every key in use of the two friends,
 * so either can open the file. Everything here runs in the browser: the server only ever gets ciphertext and the locked copies of the file key.
 *
 * Every AES lock binds the friendship and the part ("file", "thumb" or "meta") as additional data, so the server cannot move a file or a preview
 * to another box, or swap one part for another, without the opening failing.
 */

const RSA: RsaHashedImportParams = { name: 'RSA-OAEP', hash: 'SHA-256' };
const FILE_KEY_USAGES: KeyUsage[] = ['encrypt', 'decrypt'];

export type Part = 'file' | 'thumb' | 'meta';

/** What is locked in `meta`: the real name and type of the file. */
export interface BoxMeta {
  name: string;
  mime: string;
}

/** The people a file is locked for: each one's published keys (all in use). */
export interface Recipient {
  uid: string;
  keys: PublishedKey[];
}

const encoder = new TextEncoder();
const aad = (connectionId: string, part: Part): BufferSource => encoder.encode(`sevenfriends-box-v1:${connectionId}:${part}`);

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text = '';
  for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(text);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const randomIv = (): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(12));

async function lock(key: CryptoKey, connectionId: string, part: Part, data: BufferSource): Promise<{ iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }> {
  const iv = randomIv();
  return { iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(connectionId, part) }, key, data) };
}

async function unlock(key: CryptoKey, connectionId: string, part: Part, iv: string, data: BufferSource): Promise<ArrayBuffer> {
  try {
    return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: aad(connectionId, part) }, key, data);
  } catch {
    throw new Error('This file could not be opened: it was changed or damaged.');
  }
}

/** What kind of file this is and its type, from what the browser says and its first bytes; throws for a kind the box does not take. */
export async function classify(file: Blob, name: string): Promise<{ kind: SafeboxKind; mime: string }> {
  const type = file.type.split(';')[0].trim().toLowerCase();
  for (const kind of ['image', 'video', 'audio'] as const) if (type.startsWith(`${kind}/`)) return { kind, mime: type };
  if (!file.size) throw new Error(`“${name}” is empty`);
  const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  const text = String.fromCharCode(...head.subarray(0, 5));
  if (text === '%PDF-') return { kind: 'document', mime: 'application/pdf' };
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4) return { kind: 'document', mime: 'application/zip' };
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return { kind: 'document', mime: 'application/octet-stream' };
  if (head.every((c) => c >= 32 || c === 9 || c === 10 || c === 12 || c === 13)) return { kind: 'document', mime: 'text/plain; charset=utf-8' };
  throw new Error(`“${name}” is not a supported kind of file (pictures, video, sound, PDF, Office files, zip and text are)`);
}

/**
 * Locks a file for upload and returns the request body: the header (see EncryptedUploadHeader), the locked file and the locked preview.
 * `recipients` must list every key in use of both friends (the server refuses a file that misses one).
 */
export async function sealFile(input: { connectionId: string; file: Blob; name: string; kind: SafeboxKind; mime: string; thumb?: Blob | null; recipients: Recipient[] }): Promise<Blob> {
  const { connectionId } = input;
  const fileKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, FILE_KEY_USAGES);
  const file = await lock(fileKey, connectionId, 'file', await input.file.arrayBuffer());
  const thumb = input.thumb ? await lock(fileKey, connectionId, 'thumb', await input.thumb.arrayBuffer()) : null;
  const meta = await lock(fileKey, connectionId, 'meta', encoder.encode(JSON.stringify({ name: input.name, mime: input.mime } satisfies BoxMeta)));
  const wraps: SafeboxEnc['wraps'] = [];
  for (const person of input.recipients) {
    for (const key of person.keys) {
      const publicKey = await crypto.subtle.importKey('jwk', key.publicKey, RSA, false, ['wrapKey']);
      const wrapped = await crypto.subtle.wrapKey('raw', fileKey, publicKey, { name: 'RSA-OAEP' });
      wraps.push({ uid: person.uid, keyId: key.id, wrappedKey: toBase64(wrapped) });
    }
  }
  const header: EncryptedUploadHeader = {
    v: 1,
    kind: input.kind,
    fileLength: file.data.byteLength,
    thumbLength: thumb?.data.byteLength ?? 0,
    enc: { v: 1, iv: toBase64(file.iv), metaIv: toBase64(meta.iv), meta: toBase64(meta.data), thumbIv: thumb ? toBase64(thumb.iv) : null, wraps },
  };
  const head = encoder.encode(JSON.stringify(header));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, head.length);
  return new Blob([length, head, file.data, ...(thumb ? [thumb.data] : [])], { type: 'application/octet-stream' });
}

/** The file key of an encrypted file, opened with the private key of this device; throws when none of the copies was locked for this key. */
export async function openFileKey(enc: SafeboxEnc, myKeyId: string, privateKey: CryptoKey): Promise<CryptoKey> {
  const wrap = enc.wraps.find((w) => w.keyId === myKeyId);
  if (!wrap) throw new Error('This file was locked for another device. Ask someone with access to share it again.');
  try {
    return await crypto.subtle.unwrapKey('raw', fromBase64(wrap.wrappedKey), privateKey, { name: 'RSA-OAEP' }, { name: 'AES-GCM', length: 256 }, false, FILE_KEY_USAGES);
  } catch {
    throw new Error('This file could not be opened with the key on this device.');
  }
}

/** The file (`thumb`: its preview) opened; `data` is what the server holds. */
export async function openPart(connectionId: string, enc: SafeboxEnc, fileKey: CryptoKey, part: 'file' | 'thumb', data: ArrayBuffer): Promise<ArrayBuffer> {
  const iv = part === 'file' ? enc.iv : enc.thumbIv;
  if (!iv) throw new Error('There is no preview.');
  return unlock(fileKey, connectionId, part, iv, data);
}

export async function openMeta(connectionId: string, enc: SafeboxEnc, fileKey: CryptoKey): Promise<BoxMeta> {
  const meta = JSON.parse(new TextDecoder().decode(await unlock(fileKey, connectionId, 'meta', enc.metaIv, fromBase64(enc.meta)))) as Partial<BoxMeta>;
  if (typeof meta.name !== 'string' || typeof meta.mime !== 'string') throw new Error('This file could not be opened: it was changed or damaged.');
  return { name: meta.name, mime: meta.mime };
}

/** A new name for an encrypted file, locked with the file key it already has: what the server stores in place of the old one. */
export async function sealMeta(connectionId: string, fileKey: CryptoKey, meta: BoxMeta): Promise<{ metaIv: string; meta: string }> {
  const sealed = await lock(fileKey, connectionId, 'meta', encoder.encode(JSON.stringify(meta)));
  return { metaIv: toBase64(sealed.iv), meta: toBase64(sealed.data) };
}
