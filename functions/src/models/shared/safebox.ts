/** What a file in a safebox is. */
export type SafeboxKind = "image" | "video" | "audio" | "document";

/**
 * What an item of the safebox is (design: docs/design/safebox-objects.md): `file` is everything the box held before (a stored file, with
 * `kind`), the others are small typed objects with NO stored file, whose content is a locked JSON payload. More types are added here, one at a time
 * (all ten are built: note, secret, link, checklist, place, contact, date, ticket, album, case). `relation` is not shown in the list: it is the locked
 * record "item A is linked with item B" (payload fields `from` and `to`), so the server never learns which items belong together.
 */
export type SafeboxType = "file" | "note" | "secret" | "link" | "checklist" | "place" | "contact" | "date" | "ticket" | "album" | "case" | "relation";

/** The types that are objects (no stored file): their content is the locked payload in `enc.meta`. */
export const SAFEBOX_OBJECT_TYPES: readonly SafeboxType[] = ["note", "secret", "link", "checklist", "place", "contact", "date", "ticket", "album", "case", "relation"];

/** The most a payload may be, before it is locked (JSON, in bytes). */
export const SAFEBOX_PAYLOAD_MAX_BYTES = 16 * 1024;

/** What a note holds, before it is locked and after it is opened: a title and a text. */
export interface NotePayload {
  v: 1;
  title: string;
  text: string;
}
export const NOTE_TITLE_MAX = 100;

/**
 * What every object other than a note holds, before it is locked and after it is opened: a title, and the fields of its type as text
 * (`secret`: value, note · `link`: url, note · `place`: address, note · `contact`: phone, email, note · `date`: date as yyyy-mm-dd, note · `ticket`: where, date, time as hh:mm, reference, note), and for a
 * `checklist` the entries. The server never sees it (it only checks the type and the size of the locked payload); the field names are the app's business.
 */
export interface ObjectPayload {
  v: 1;
  title: string;
  fields: Record<string, string>;
  items?: ChecklistEntry[];
}
/** One line of a checklist. */
export interface ChecklistEntry {
  id: string;
  text: string;
  done: boolean;
}
export const OBJECT_TITLE_MAX = 100;
export const OBJECT_FIELD_MAX = 2000;
export const CHECKLIST_ENTRIES_MAX = 100;
export const CHECKLIST_TEXT_MAX = 200;
/** How many attachments an object may have, and an album (which holds only pictures and videos). */
export const ATTACHMENTS_MAX = 10;
export const ALBUM_PICTURES_MAX = 100;
/** A case (a file of documents) may have this many attachments. */
export const CASE_DOCUMENTS_MAX = 30;
export const NOTE_TEXT_MAX = 8000;

/** The file key of an encrypted file, locked (RSA-OAEP) for one published key. `keyId` names the key it was locked with. All values are base64. */
export interface SafeboxWrap {
  uid: string;
  keyId: string;
  wrappedKey: string;
}

/**
 * What makes a file encrypted (design: docs/design/safebox-encryption.md). The file, its preview and `meta` (the name and type) are AES-256-GCM
 * with one random file key; every value is base64. The server keeps it and cannot open it. In an item sent to the app `wraps` holds only the
 * copies for the person who asks (the other copies stay on the server).
 * An OBJECT (a note ...) has no file: `meta` (with `metaIv`) is its whole locked payload, `iv` is not used (it is the same value as `metaIv`) and
 * `thumbIv` is null. The key and the copies of it work exactly as for a file, so recovery and a new key need nothing new.
 */
export interface SafeboxEnc {
  v: 1;
  /** the iv of the file (12 bytes) */
  iv: string;
  /** the iv and the encrypted `{ name, mime }` */
  metaIv: string;
  meta: string;
  /** the iv of the preview, when there is one */
  thumbIv: string | null;
  wraps: SafeboxWrap[];
  /**
   * An object (a note, a place ...) made by a newer app: `meta` is then only its small HEAD (title, one line, date: what the list shows) and the whole
   * content is `body` (locked with `bodyIv`). The list does not send `body`, only `bodyIv`: the app asks for the item when it is opened. An object without
   * these (an older one, and a link between two items) has its whole content in `meta`.
   */
  bodyIv?: string;
  body?: string;
}

/** The most the front part of an encrypted upload (see `EncryptedUploadHeader`) may be. */
export const ENC_HEADER_MAX = 64 * 1024;

/**
 * An encrypted file is sent in ONE request: 4 bytes (the length of the header, big-endian), the header as JSON, the encrypted file
 * (`fileLength` bytes) and the encrypted preview (`thumbLength` bytes, 0 = none). The server cannot look inside, so `kind` is what the app says.
 */
export interface EncryptedUploadHeader {
  v: 1;
  kind: SafeboxKind;
  fileLength: number;
  thumbLength: number;
  enc: SafeboxEnc;
}

/**
 * A reminder for an object with a time (a date, a ticket): the MOMENT to push (the event time minus the lead the person chose; the lead itself stays inside
 * the locked payload). It is the one thing about such an object that the server knows, because it must send the push; the push says only that something in
 * the safebox is due, never what. `both` = my friend gets it too.
 */
export interface ReminderRequest {
  at: string;
  both: boolean;
}

/** The body of `POST .../safebox/items`: a new object, its content locked on the device (and a reminder, for an object with a time). */
export interface NewObject {
  type: SafeboxType;
  enc: SafeboxEnc;
  remind?: ReminderRequest | null;
}

/** The body of `PUT .../safebox/items/:id`: the new locked content, and the revision the app last saw (409 when the other friend saved first). */
export interface ObjectChange {
  revision: number;
  metaIv: string;
  /** the head (with `body`) or the whole content (without) */
  meta: string;
  bodyIv?: string;
  body?: string;
  /** absent = the reminder stays as it is; null = no reminder any more; otherwise the new one */
  remind?: ReminderRequest | null;
}

/** One item in the safebox two friends share (a file, or a typed object: see `type`). The file is read from `/api/circles/default/friends/<friendId>/safebox/<id>` (and `/thumb` for the small picture). */
export interface SafeboxItem {
  id: string;
  /** `file` for a stored file (also every item from before there were types), otherwise an object with no stored file */
  type: SafeboxType;
  /** the name of the file (can be changed by both friends); an object has only a placeholder: its title is inside the locked payload */
  name: string;
  /** an object has no file: it says `document` and the app looks at `type` first */
  kind: SafeboxKind;
  mime: string;
  bytes: number;
  /** who saved the file in the box (the user id of its owner; the encryption will use this person's key) */
  ownerId: string;
  /** true = I put it in the box */
  mine: boolean;
  createdAt: string | null;
  /** when an object was last changed (null for a file) */
  updatedAt: string | null;
  /** counts the changes of an object, from 1; a change must name the revision it started from. A file has 1. */
  revision: number;
  /** an ATTACHMENT (a file that belongs to an object): the id of that object; null for everything that stands on its own. The list shows an attachment under its object. */
  parentId: string | null;
  /** true = there is a small preview at `/thumb` */
  hasThumb: boolean;
  /** present = the file is stored encrypted: `name` and `mime` are then only a placeholder until the app opens `enc` and reads the real ones */
  enc?: SafeboxEnc;
}

/** What the safebox of one friendship holds, and its limits. */
export interface Safebox {
  items: SafeboxItem[];
  usedBytes: number;
  /** the whole box may hold this many bytes */
  maxBytes: number;
  /** one file may be this big */
  maxFileBytes: number;
}
