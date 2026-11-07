/** What a file in a safebox is. */
export type SafeboxKind = "image" | "video" | "audio" | "document";

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

/** One file in the safebox two friends share. The file is read from `/api/circles/default/friends/<friendId>/safebox/<id>` (and `/thumb` for the small picture). */
export interface SafeboxItem {
  id: string;
  /** the name of the file (can be changed by both friends) */
  name: string;
  kind: SafeboxKind;
  mime: string;
  bytes: number;
  /** who saved the file in the box (the user id of its owner; the encryption will use this person's key) */
  ownerId: string;
  /** true = I put it in the box */
  mine: boolean;
  createdAt: string | null;
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
