import { EncryptedUploadHeader, MessageEnc, MessageEncMedia, NotePayload, ObjectPayload, SafeboxType, PublishedKey, SafeboxEnc, SafeboxKind, SafeboxWrap } from '../models';
import { tr } from './i18n';

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

export type Part = 'file' | 'thumb' | 'meta' | 'text' | 'body';

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
    throw new Error(tr('core.thisFileCouldNot', 'This file could not be opened: it was changed or damaged.'));
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
  if (!wrap) throw new Error(tr('core.thisWasLockedFor', 'This {{ noun }} was locked for another device.', { noun }));
  try {
    return await crypto.subtle.unwrapKey('raw', fromBase64(wrap.wrappedKey), privateKey, { name: 'RSA-OAEP' }, { name: 'AES-GCM', length: 256 }, false, FILE_KEY_USAGES);
  } catch {
    throw new Error(tr('core.thisCouldNotBe', 'This {{ noun }} could not be opened with the key on this device.', { noun }));
  }
}

/** The file (`thumb`: its preview) opened; `data` is what the server holds. */
export async function openPart(connectionId: string, enc: SafeboxEnc, fileKey: CryptoKey, part: 'file' | 'thumb', data: ArrayBuffer): Promise<ArrayBuffer> {
  const iv = part === 'file' ? enc.iv : enc.thumbIv;
  if (!iv) throw new Error(tr('core.thereIsNoPreview', 'There is no preview.'));
  return unlock(fileKey, connectionId, part, iv, data);
}

export async function openMeta(connectionId: string, enc: SafeboxEnc, fileKey: CryptoKey): Promise<BoxMeta> {
  const meta = JSON.parse(new TextDecoder().decode(await unlock(fileKey, connectionId, 'meta', enc.metaIv, fromBase64(enc.meta)))) as Partial<BoxMeta>;
  if (typeof meta.name !== 'string' || typeof meta.mime !== 'string') throw new Error(tr('core.thisFileCouldNot', 'This file could not be opened: it was changed or damaged.'));
  return { name: meta.name, mime: meta.mime };
}

/** A new name for an encrypted file, locked with the file key it already has: what the server stores in place of the old one. */
export async function sealMeta(connectionId: string, fileKey: CryptoKey, meta: BoxMeta): Promise<{ metaIv: string; meta: string }> {
  const sealed = await lock(fileKey, connectionId, 'meta', encoder.encode(JSON.stringify(meta)));
  return { metaIv: toBase64(sealed.iv), meta: toBase64(sealed.data) };
}

/**
 * What the list shows of a note or another object, locked apart from its whole content so the list does not have to read the content: the title, one
 * short line and the date (all three can be empty). For an object made like this `meta` is the head and `body` the whole content.
 */
export interface BoxHead {
  title: string;
  line: string;
  when: string;
  /** when the item is due, in milliseconds (from the start of its reminder period to the end of its day): the list can show what is due without opening the content; absent on an item with no date */
  due?: { from: number; to: number } | null;
}

/** The content of an object locked: with a head the head goes in `meta` and the content in `body`; without one (a link between two items) the content is all in `meta`. */
async function sealContent(connectionId: string, key: CryptoKey, payload: unknown, head: BoxHead | null): Promise<{ metaIv: string; meta: string; bodyIv?: string; body?: string }> {
  if (!head) {
    const sealed = await lock(key, connectionId, 'meta', encoder.encode(JSON.stringify(payload)));
    return { metaIv: toBase64(sealed.iv), meta: toBase64(sealed.data) };
  }
  const sealedHead = await lock(key, connectionId, 'meta', encoder.encode(JSON.stringify(head)));
  const sealedBody = await lock(key, connectionId, 'body', encoder.encode(JSON.stringify(payload)));
  return { metaIv: toBase64(sealedHead.iv), meta: toBase64(sealedHead.data), bodyIv: toBase64(sealedBody.iv), body: toBase64(sealedBody.data) };
}

/** The whole content of an object, as JSON; throws when it is not read yet (the list does not carry it: see `needsBody`). */
async function openContent(connectionId: string, enc: SafeboxEnc, key: CryptoKey): Promise<unknown> {
  if (enc.bodyIv) {
    if (!enc.body) throw new Error('The content of this item is not read yet.');
    return JSON.parse(new TextDecoder().decode(await unlock(key, connectionId, 'body', enc.bodyIv, fromBase64(enc.body))));
  }
  return JSON.parse(new TextDecoder().decode(await unlock(key, connectionId, 'meta', enc.metaIv, fromBase64(enc.meta))));
}

/** True when the whole content of an object has to be asked for before it can be opened (the list sends only the head). */
export const needsBody = (enc: SafeboxEnc | undefined): boolean => !!enc?.bodyIv && !enc.body;

/** The head of an object made with one (null for an older object: open it whole). */
export async function openHead(connectionId: string, enc: SafeboxEnc, key: CryptoKey): Promise<BoxHead | null> {
  if (!enc.bodyIv) return null;
  const h = JSON.parse(new TextDecoder().decode(await unlock(key, connectionId, 'meta', enc.metaIv, fromBase64(enc.meta)))) as Partial<BoxHead>;
  if (typeof h.title !== 'string') throw new Error(tr('core.thisItemCouldNot', 'This item could not be opened: it was changed or damaged.'));
  const due = h.due && Number.isFinite(h.due.from) && Number.isFinite(h.due.to) ? { from: h.due.from, to: h.due.to } : null;
  return { title: h.title, line: typeof h.line === 'string' ? h.line : '', when: typeof h.when === 'string' ? h.when : '', due };
}

/**
 * A new note (design: docs/design/safebox-objects.md): a new key for it, the title and text locked with it, the key locked for every key in use of both
 * friends. Returns the body of `POST .../safebox/items`. See `BoxHead` for what is in `meta` and what in `body`; the iv of the file is only a placeholder and is
 * the same as `metaIv`.
 */
export async function sealNote(connectionId: string, payload: NotePayload, head: BoxHead | null, recipients: Recipient[]): Promise<{ type: 'note'; enc: SafeboxEnc }> {
  const key = await newKey();
  const sealed = await sealContent(connectionId, key, payload, head);
  return { type: 'note', enc: { v: 1, iv: sealed.metaIv, ...sealed, thumbIv: null, wraps: await wrapKeyFor(key, recipients) } };
}

/** The new content of a note, locked again with the key it already has: what `PUT .../safebox/items/:id` takes (the copies of the key stay as they are). */
export async function resealNote(connectionId: string, key: CryptoKey, payload: NotePayload, head: BoxHead | null): Promise<{ metaIv: string; meta: string; bodyIv?: string; body?: string }> {
  return sealContent(connectionId, key, payload, head);
}

/** A note opened; throws when it was changed or is not a note. */
export async function openNote(connectionId: string, enc: SafeboxEnc, key: CryptoKey): Promise<NotePayload> {
  const payload = (await openContent(connectionId, enc, key)) as Partial<NotePayload>;
  if (payload.v !== 1 || typeof payload.title !== 'string' || typeof payload.text !== 'string') throw new Error(tr('core.thisNoteCouldNot', 'This note could not be opened: it was changed or damaged.'));
  return { v: 1, title: payload.title, text: payload.text };
}

/** A new object other than a note (a secret, link, checklist ...): the same as a note, with its type and its fields/entries as the payload. */
export async function sealObject(connectionId: string, type: SafeboxType, payload: ObjectPayload, head: BoxHead | null, recipients: Recipient[]): Promise<{ type: SafeboxType; enc: SafeboxEnc }> {
  const key = await newKey();
  const sealed = await sealContent(connectionId, key, payload, head);
  return { type, enc: { v: 1, iv: sealed.metaIv, ...sealed, thumbIv: null, wraps: await wrapKeyFor(key, recipients) } };
}

/** The new content of such an object, locked again with its key (what `PUT .../safebox/items/:id` takes). */
export const resealObject = (connectionId: string, key: CryptoKey, payload: ObjectPayload, head: BoxHead | null): Promise<{ metaIv: string; meta: string; bodyIv?: string; body?: string }> => sealContent(connectionId, key, payload, head);

/** An object opened; throws when it was changed or is not what it says. */
export async function openObject(connectionId: string, enc: SafeboxEnc, key: CryptoKey): Promise<ObjectPayload> {
  const p = (await openContent(connectionId, enc, key)) as Partial<ObjectPayload>;
  if (p.v !== 1 || typeof p.title !== 'string' || !p.fields || typeof p.fields !== 'object') throw new Error(tr('core.thisItemCouldNot', 'This item could not be opened: it was changed or damaged.'));
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(p.fields)) if (typeof v === 'string') fields[k] = v;
  const items = Array.isArray(p.items) ? p.items.filter((i) => i && typeof i.id === 'string' && typeof i.text === 'string').map((i) => ({ id: i.id, text: i.text, done: i.done === true })) : undefined;
  return { v: 1, title: p.title, fields, ...(items ? { items } : {}) };
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
  if (!iv) throw new Error(tr('core.thereIsNoPreview', 'There is no preview.'));
  return unlock(key, connectionId, part, iv, data);
}

export async function openMessageMeta(connectionId: string, media: MessageEncMedia, key: CryptoKey): Promise<MessageMediaMeta> {
  const meta = JSON.parse(new TextDecoder().decode(await unlock(key, connectionId, 'meta', media.metaIv, fromBase64(media.meta)))) as Partial<MessageMediaMeta>;
  if (typeof meta.mime !== 'string') throw new Error(tr('core.thisFileCouldNot', 'This file could not be opened: it was changed or damaged.'));
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
  if (!mine) throw new Error(tr('core.thisWasLockedFor', 'This {{ noun }} was locked for another device.', { noun }));
  const key = await crypto.subtle.unwrapKey('raw', fromBase64(mine.wrappedKey), privateKey, { name: 'RSA-OAEP' }, { name: 'AES-GCM', length: 256 }, true, FILE_KEY_USAGES);
  const publicKey = await crypto.subtle.importKey('jwk', target.key.publicKey, RSA, false, ['wrapKey']);
  const wrapped = await crypto.subtle.wrapKey('raw', key, publicKey, { name: 'RSA-OAEP' });
  return { uid: target.uid, keyId: target.key.id, wrappedKey: toBase64(wrapped) };
}
