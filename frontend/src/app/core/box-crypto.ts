import { EncryptedUploadHeader, MessageEnc, MessageEncMedia, PublishedKey, SafeboxEnc, SafeboxKind, SafeboxWrap } from '../models';

/**
 * The encryption of a safebox file (design: docs/design/safebox-encryption.md). Each file gets a random AES-256-GCM key; the file, its small
 * preview and its name and type ("meta") are locked with it. The file key is then locked (RSA-OAEP) once for every key in use of the two friends,
 * so either can open the file. Everything here runs in the browser: the server only ever gets ciphertext and the locked copies of the file key.
 *
 * Every AES lock binds the friendship and the part ("file", "thumb", "meta" or, for a message, "text") as additional data, so the server cannot move a
 * file or a preview to another box, or swap one part for another, without the opening failing.
 *
 * A message (design: docs/design/message-encryption.md) is locked the same way: its own random key, the text locked with it (part "text"), and the
 * key locked once for every key in use of both friends (`sealText`, `openText`).
 */

const RSA: RsaHashedImportParams = { name: 'RSA-OAEP', hash: 'SHA-256' };
const FILE_KEY_USAGES: KeyUsage[] = ['encrypt', 'decrypt'];

export type Part = 'file' | 'thumb' | 'meta' | 'text';

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

/** A new random AES-256-GCM key: for one file, or for one message. */
const newKey = (): Promise<CryptoKey> => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, FILE_KEY_USAGES);

/** The key locked (RSA-OAEP) once for every key in use of the people: the copies the server keeps next to the locked data. */
async function wrapKeyFor(key: CryptoKey, recipients: Recipient[]): Promise<SafeboxWrap[]> {
  const wraps: SafeboxWrap[] = [];
  for (const person of recipients) {
    for (const published of person.keys) {
      const publicKey = await crypto.subtle.importKey('jwk', published.publicKey, RSA, false, ['wrapKey']);
      const wrapped = await crypto.subtle.wrapKey('raw', key, publicKey, { name: 'RSA-OAEP' });
      wraps.push({ uid: person.uid, keyId: published.id, wrappedKey: toBase64(wrapped) });
    }
  }
  return wraps;
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
  const fileKey = await newKey();
  const file = await lock(fileKey, connectionId, 'file', await input.file.arrayBuffer());
  const thumb = input.thumb ? await lock(fileKey, connectionId, 'thumb', await input.thumb.arrayBuffer()) : null;
  const meta = await lock(fileKey, connectionId, 'meta', encoder.encode(JSON.stringify({ name: input.name, mime: input.mime } satisfies BoxMeta)));
  const wraps = await wrapKeyFor(fileKey, input.recipients);
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
export async function openFileKey(enc: { wraps: SafeboxWrap[] }, myKeyId: string, privateKey: CryptoKey, noun: 'file' | 'message' = 'file'): Promise<CryptoKey> {
  const wrap = enc.wraps.find((w) => w.keyId === myKeyId);
  if (!wrap) throw new Error(`This ${noun} was locked for another device.`);
  try {
    return await crypto.subtle.unwrapKey('raw', fromBase64(wrap.wrappedKey), privateKey, { name: 'RSA-OAEP' }, { name: 'AES-GCM', length: 256 }, false, FILE_KEY_USAGES);
  } catch {
    throw new Error(`This ${noun} could not be opened with the key on this device.`);
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

/**
 * Locks the text of a message: a new key for this message, the text locked with it, the key locked for every key in use of both friends.
 * Returns what the server keeps: `text` is the locked text (base64) and replaces the plain text; `enc` holds the iv and the locked key copies.
 */
export async function sealText(connectionId: string, text: string, recipients: Recipient[]): Promise<{ text: string; enc: MessageEnc }> {
  return sealTextWith(connectionId, await newKey(), text, recipients);
}

/**
 * The same with a message key that already exists: a message with a picture, video or voice has its key before the file is uploaded (the file is
 * locked with it first), and the caption and the copies of the key are made when the message is sent. `media` (from `sealMessageMedia`) goes into `enc`.
 */
export async function sealTextWith(connectionId: string, key: CryptoKey, text: string, recipients: Recipient[], media?: MessageEncMedia): Promise<{ text: string; enc: MessageEnc }> {
  const sealed = await lock(key, connectionId, 'text', encoder.encode(text));
  return { text: toBase64(sealed.data), enc: { v: 1, iv: toBase64(sealed.iv), wraps: await wrapKeyFor(key, recipients), ...(media ? { media } : {}) } };
}

/** A new key for a message with a file. */
export const newMessageKey = newKey;

/** What is locked in `enc.media.meta` of a message: what the server must not learn about the file. */
export interface MessageMediaMeta {
  name: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/** The file of a message locked with the message key (part "file"), with its preview (part "thumb") and its meta (part "meta"). `media` goes into the message's `enc`. */
export async function sealMessageMedia(connectionId: string, key: CryptoKey, input: { file: Blob; thumb: Blob | null; meta: MessageMediaMeta }): Promise<{ file: Blob; thumb: Blob | null; media: MessageEncMedia }> {
  const file = await lock(key, connectionId, 'file', await input.file.arrayBuffer());
  const thumb = input.thumb ? await lock(key, connectionId, 'thumb', await input.thumb.arrayBuffer()) : null;
  const meta = await lock(key, connectionId, 'meta', encoder.encode(JSON.stringify(input.meta)));
  return {
    file: new Blob([file.data], { type: 'application/octet-stream' }),
    thumb: thumb ? new Blob([thumb.data], { type: 'application/octet-stream' }) : null,
    media: { iv: toBase64(file.iv), thumbIv: thumb ? toBase64(thumb.iv) : null, metaIv: toBase64(meta.iv), meta: toBase64(meta.data) },
  };
}

/** The message key of a locked message, opened with the private key of this device. */
export const openMessageKey = (enc: { wraps: SafeboxWrap[] }, myKeyId: string, privateKey: CryptoKey): Promise<CryptoKey> => openFileKey(enc, myKeyId, privateKey, 'message');

/** The file (`thumb`: its preview) of a locked message opened; `data` is what the server holds. */
export async function openMessageMedia(connectionId: string, media: MessageEncMedia, key: CryptoKey, part: 'file' | 'thumb', data: ArrayBuffer): Promise<ArrayBuffer> {
  const iv = part === 'file' ? media.iv : media.thumbIv;
  if (!iv) throw new Error('There is no preview.');
  return unlock(key, connectionId, part, iv, data);
}

export async function openMessageMeta(connectionId: string, media: MessageEncMedia, key: CryptoKey): Promise<MessageMediaMeta> {
  const meta = JSON.parse(new TextDecoder().decode(await unlock(key, connectionId, 'meta', media.metaIv, fromBase64(media.meta)))) as Partial<MessageMediaMeta>;
  if (typeof meta.mime !== 'string') throw new Error('This file could not be opened: it was changed or damaged.');
  const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { name: typeof meta.name === 'string' ? meta.name : null, mime: meta.mime, width: number(meta.width), height: number(meta.height), durationMs: number(meta.durationMs) };
}

/**
 * A new text for a message that is already locked (an edit): locked again with the message key it already has (opened with the key of this device),
 * with a new iv. The copies of the key stay as they are, so the same keys can read it and nobody else is let in.
 */
export async function resealText(connectionId: string, enc: MessageEnc, text: string, myKeyId: string, privateKey: CryptoKey): Promise<{ text: string; iv: string }> {
  const key = await openFileKey(enc, myKeyId, privateKey, 'message');
  const sealed = await lock(key, connectionId, 'text', encoder.encode(text));
  return { text: toBase64(sealed.data), iv: toBase64(sealed.iv) };
}

/** The text of a locked message, opened with the private key of this device; throws when no copy was locked for this key or the text was changed. */
export async function openText(connectionId: string, enc: MessageEnc, text: string, myKeyId: string, privateKey: CryptoKey): Promise<string> {
  return openTextWith(connectionId, enc, text, await openFileKey(enc, myKeyId, privateKey, 'message'));
}

/** The same with the message key already opened (a message with a file opens its key once for the text and the file). */
export async function openTextWith(connectionId: string, enc: MessageEnc, text: string, key: CryptoKey): Promise<string> {
  return new TextDecoder().decode(await unlock(key, connectionId, 'text', enc.iv, fromBase64(text)));
}

/**
 * Recovery: the key of a message or file, opened with this device's key and locked again for ONE other key (the new key of the friend who asks). The opened key is only
 * held for this one step (it has to be exportable to be locked again) and is not kept; nothing readable leaves the device.
 */
export async function rewrapKey(enc: { wraps: SafeboxWrap[] }, myKeyId: string, privateKey: CryptoKey, target: { uid: string; key: PublishedKey }, noun: 'file' | 'message' = 'file'): Promise<SafeboxWrap> {
  const mine = enc.wraps.find((w) => w.keyId === myKeyId);
  if (!mine) throw new Error(`This ${noun} was locked for another device.`);
  const key = await crypto.subtle.unwrapKey('raw', fromBase64(mine.wrappedKey), privateKey, { name: 'RSA-OAEP' }, { name: 'AES-GCM', length: 256 }, true, FILE_KEY_USAGES);
  const publicKey = await crypto.subtle.importKey('jwk', target.key.publicKey, RSA, false, ['wrapKey']);
  const wrapped = await crypto.subtle.wrapKey('raw', key, publicKey, { name: 'RSA-OAEP' });
  return { uid: target.uid, keyId: target.key.id, wrappedKey: toBase64(wrapped) };
}
