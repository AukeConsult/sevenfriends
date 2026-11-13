/**
 * Public keys and their fingerprints (design: docs/design/safebox-encryption.md). The same code runs in the app and on the server,
 * so both get the same fingerprint from the same key: the server checks the fingerprint it is told, it never takes it on trust.
 */

/** The public key of a device as published: an RSA key in JWK form. */
export interface PublicKeyJwk {
  kty: "RSA";
  n: string;
  e: string;
}

/** The public signing key of a device: an ECDSA P-256 key in JWK form. */
export interface SignKeyJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

/** A published key as the server lists it. `id` is the key ID (the first 32 hex characters of the fingerprint), `fingerprint` all 64. */
export interface PublishedKey {
  id: string;
  fingerprint: string;
  label: string;
  createdAt: string | null;
  revoked: boolean;
  /** the public key itself (it is public): a new device that restores its key from the backup picks the one that fits */
  publicKey: PublicKeyJwk;
  /** the public signing key of the same device (ECDSA P-256); missing on an older lock (made before signing existed) */
  signKey?: SignKeyJwk;
  /** a key in use that waits for another device of the person to approve it (it has no copies of the old messages yet, and cannot help the others) */
  waiting?: boolean;
}

/** What GET /keys returns: my published keys, and whether a recovery backup of the private key is stored. */
export interface MyKeys {
  keys: PublishedKey[];
  /** a recovery backup is stored (for any of my keys) */
  hasBackup: boolean;
  /** the keys that have a backup of their own: the 24 words of a device are only for that device */
  backups: string[];
}

/** What GET .../safebox/keys returns: the keys in use (not retired) of me and of my friend. Files can be locked only when both lists have a key. */
export interface BoxKeys {
  /** the user id of my friend (the copies of a file key are filed under it); empty for a group */
  friendUid: string;
  mine: PublishedKey[];
  /** the keys of my friend; empty for a group (see `others`) */
  friend: PublishedKey[];
  /** every OTHER person of the connection with the keys in use of each: my friend (one person), or the other members of a group (none, when I am alone in it) */
  others: BoxPerson[];
}

/** One other person of a connection and their keys in use (`name`: as I know them). */
export interface BoxPerson {
  uid: string;
  name: string;
  keys: PublishedKey[];
}

/** Who a file, item or message is locked for: me and every other person, each with all their keys in use (one copy of the file key per key). */
export const recipientsOf = (me: string, keys: BoxKeys): { uid: string; keys: PublishedKey[] }[] => [
  { uid: me, keys: keys.mine },
  ...(keys.others ?? (keys.friendUid ? [{ uid: keys.friendUid, name: '', keys: keys.friend }] : [])).map((o) => ({ uid: o.uid, keys: o.keys })),
];

/** The private key of a device, scrambled with the recovery key (AES-256-GCM): all three parts are base64. The server stores it and cannot open it. */
export interface KeyBackup {
  v: 1;
  iv: string;
  data: string;
}

/** RSA with a 3072-bit key: `n` is 384 bytes, which is 512 characters of base64url. */
export const KEY_N_LENGTH = 512;
export const KEY_ID_LENGTH = 32;
export const MAX_KEYS_PER_PERSON = 10;
export const MAX_KEY_LABEL = 60;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The key as the checker needs it: only the three fields that make the key, nothing else, or null when it is not a 3072-bit RSA public key. */
export function canonicalPublicKey(value: unknown): PublicKeyJwk | null {
  if (!value || typeof value !== "object") return null;
  const k = value as { kty?: unknown; n?: unknown; e?: unknown };
  if (k.kty !== "RSA" || k.e !== "AQAB") return null; // the exponent 65537
  if (typeof k.n !== "string" || k.n.length !== KEY_N_LENGTH || !BASE64URL.test(k.n)) return null;
  return { e: "AQAB", kty: "RSA", n: k.n }; // the fields in a fixed order: the same text for the same key
}

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

/** The fingerprint of a key: the SHA-256 of its canonical JSON, as 64 hex characters. Null when the key is not valid. */
export async function fingerprintOf(key: unknown): Promise<string | null> {
  const canonical = canonicalPublicKey(key);
  if (!canonical) return null;
  return hex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonical))));
}

/** The key ID: the first 32 hex characters of the fingerprint. */
export const keyIdOf = (fingerprint: string): string => fingerprint.slice(0, KEY_ID_LENGTH);

/** A fingerprint to read out or compare: groups of four, eight to a line ("a1b2 c3d4 ..."). */
export function readableFingerprint(fingerprint: string): string {
  const groups = fingerprint.match(/.{1,4}/g) ?? [];
  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += 8) lines.push(groups.slice(i, i + 8).join(" "));
  return lines.join("\n");
}

/**
 * Recovery (design: docs/design/message-encryption.md): a person with a NEW key asks their friend to open the old messages and safebox files for it. The friend's
 * device opens each message key with its own key and locks it again for the new key; only the keys move. One request per friendship.
 */
export type RecoveryStatus = "none" | "asked" | "approved" | "declined" | "done";

/**
 * One request of mine in the list on Home (GET /recovery, all my circles): as the friend who is asked (`helper`) or as the one who asked (`requester`).
 * `declined` and `done` are only news on their way (see docs/design/recovery-by-friend.md): they are deleted when the asker's app has shown them.
 */
export interface RecoveryItem {
  /** the id of the friendship (the friend's id in my circle) */
  id: string;
  /** my circle of that friendship */
  circleId: string;
  role: "requester" | "helper";
  status: Exclude<RecoveryStatus, "none">;
  friendName: string;
  total: number;
  added: number;
  /** when the request was made (ISO), the app tells a new one from one it has seen */
  createdAt: string | null;
}

/** What GET .../recovery returns. `role` is mine in this request: the one who asked (requester) or the friend who is asked (helper). */
export interface RecoveryState {
  role: "none" | "requester" | "helper";
  status: RecoveryStatus;
  /** the new key of the one who asked: the helper compares it with them before approving */
  keyId: string | null;
  fingerprint: string | null;
  /** how many messages and files needed a new copy when the friend approved, and how many have one now */
  total: number;
  added: number;
  /** the friend's name as in the list */
  friendName: string;
}

/** One message or file whose key the helper can open (the helper's own copies of its key); the helper locks it again for the new key. */
export interface RecoveryTodoItem {
  id: string;
  wraps: { uid: string; keyId: string; wrappedKey: string }[];
  /** the keys in use of the one who asks that have no copy of this key yet: the helper locks it for each of them */
  missing: string[];
}

/** GET .../recovery/todo?part=messages|box&after=<cursor>: the next items to do; `next` = continue after this cursor, null = this part is finished. */
export interface RecoveryTodo {
  part: "messages" | "box";
  items: RecoveryTodoItem[];
  next: string | null;
}

/**
 * A device asks my OTHER devices to open my old messages and files for its key (design: docs/design/recovery-own-devices.md). Made by itself when a key is
 * published next to other keys, and by the person at any time (a new request replaces the old one). `declined` and `done` are only news on their way:
 * the asking device shows them and deletes the request (nothing is kept).
 */
export interface OwnRecoveryRequest {
  /** the key of the device that asks */
  keyId: string;
  label: string;
  fingerprint: string;
  status: "asked" | "working" | "declined" | "done";
  /** how many messages and files lack a copy for that key (when the request was made / the work began) and how many have one now */
  total: number;
  added: number;
  createdAt: string | null;
}

/** A group's safebox item that lacks a copy of its key for a key in use of a member (a member who joined, a new device): `wraps` are MY copies (I can open them), `missing` the keys still to be given one. */
export interface GroupShareItem {
  id: string;
  wraps: { uid: string; keyId: string; wrappedKey: string }[];
  missing: { uid: string; keyId: string }[];
}


// ---------------------------------------------------------------------------------------------------- the signed device list (docs/design/default-key.md)

/** P-256 coordinates are 32 bytes: 43 characters of base64url. */
const COORDINATE_LENGTH = 43;

/** The signing key as the checker needs it (only kty, crv, x, y, in a fixed order), or null when it is not a P-256 public key. */
export function canonicalSignKey(value: unknown): SignKeyJwk | null {
  if (!value || typeof value !== "object") return null;
  const k = value as { kty?: unknown; crv?: unknown; x?: unknown; y?: unknown };
  if (k.kty !== "EC" || k.crv !== "P-256") return null;
  for (const c of [k.x, k.y]) if (typeof c !== "string" || c.length !== COORDINATE_LENGTH || !BASE64URL.test(c)) return null;
  return { crv: "P-256", kty: "EC", x: k.x as string, y: k.y as string };
}

/** One device in a person's device list. `keyId` is the key ID of the lock key (see `keyIdOf`). */
export interface DeviceListEntry {
  keyId: string;
  lockKey: PublicKeyJwk;
  signKey: SignKeyJwk;
  label: string;
}

/**
 * A person's device list, one version of it: signed by a device that was in the version before (version 1: by the first device itself).
 * `prev` is the SHA-256 of the previous version's signed text (hex; empty in version 1). The server keeps every version and checks the
 * structure only; devices check the signatures.
 */
export interface DeviceList {
  version: number;
  devices: DeviceListEntry[];
  prev: string;
  /** the key ID of the device that signed */
  signedBy: string;
  /** the signature (ECDSA P-256 over `deviceListText(list)`), base64 */
  signature: string;
  /**
   * Version 1 only: from when this person's texts are signed (ISO, the device clock). A text from this person without a signature that is newer than this
   * is a stripped signature. Missing on a list made before this field existed: then an unsigned text is accepted as before.
   */
  since?: string;
  /**
   * A new beginning, after every device of the person was lost: a version (never 1) signed by one of ITS OWN devices, because nothing before it can sign any more.
   * It is part of the signed text. Friends do not take it over by themselves: each one is asked to confirm that it is the person (docs/design/default-key.md).
   */
  restart?: true;
  createdAt?: string | null;
}

export const MAX_DEVICE_LIST_VERSIONS = 1000;
const SIGNATURE_LENGTH = 88; // 64 bytes (r and s) as base64 with padding

/** The text that is signed and hashed: every field except the signature, in a fixed order. */
export function deviceListText(list: Pick<DeviceList, "version" | "devices" | "prev" | "signedBy" | "since" | "restart">): string {
  return JSON.stringify({
    version: list.version,
    devices: list.devices.map((d) => ({ keyId: d.keyId, lockKey: d.lockKey, signKey: d.signKey, label: d.label })),
    prev: list.prev,
    signedBy: list.signedBy,
    ...(list.since ? { since: list.since } : {}), // only when there is one: a list made before the field existed has the same text as before
    ...(list.restart ? { restart: true } : {}),
  });
}

/** The SHA-256 of a list's signed text and signature, as 64 hex characters: the next version's `prev`. */
export async function deviceListHash(list: DeviceList): Promise<string> {
  return hex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceListText(list) + "." + list.signature)));
}

/**
 * The list in its canonical form, or a short reason why it is not a well-formed list. Structure only: it does NOT check the signature
 * (the server cannot, and must not be relied on to) and does not check the chain to the version before.
 */
export async function checkedDeviceList(value: unknown): Promise<{ list: DeviceList } | { problem: string }> {
  if (!value || typeof value !== "object") return { problem: "That is not a device list" };
  const v = value as { version?: unknown; devices?: unknown; prev?: unknown; signedBy?: unknown; signature?: unknown; since?: unknown; restart?: unknown };
  if (!Number.isInteger(v.version) || (v.version as number) < 1 || (v.version as number) > MAX_DEVICE_LIST_VERSIONS) return { problem: "The version is not a number" };
  if (!Array.isArray(v.devices) || v.devices.length < 1 || v.devices.length > MAX_KEYS_PER_PERSON) return { problem: `A list holds 1 to ${MAX_KEYS_PER_PERSON} devices` };
  const devices: DeviceListEntry[] = [];
  for (const raw of v.devices) {
    const e = (raw ?? {}) as { keyId?: unknown; lockKey?: unknown; signKey?: unknown; label?: unknown };
    const lockKey = canonicalPublicKey(e.lockKey);
    const signKey = canonicalSignKey(e.signKey);
    const fingerprint = lockKey ? await fingerprintOf(lockKey) : null;
    if (!lockKey || !signKey || !fingerprint) return { problem: "A device has no valid lock key and signing key" };
    if (e.keyId !== keyIdOf(fingerprint)) return { problem: "A device's key ID does not fit its lock key" };
    if (devices.some((d) => d.keyId === e.keyId)) return { problem: "A device is listed twice" };
    const label = typeof e.label === "string" ? e.label.slice(0, MAX_KEY_LABEL) : "";
    devices.push({ keyId: e.keyId as string, lockKey, signKey, label });
  }
  const version = v.version as number;
  const prev = typeof v.prev === "string" ? v.prev : "";
  if (version === 1 ? prev !== "" : !/^[0-9a-f]{64}$/.test(prev)) return { problem: "The link to the version before is wrong" };
  if (typeof v.signedBy !== "string" || v.signedBy.length !== KEY_ID_LENGTH) return { problem: "The signer is not a key ID" };
  if (version === 1 && !devices.some((d) => d.keyId === v.signedBy)) return { problem: "Version 1 must be signed by one of its own devices" };
  if (typeof v.signature !== "string" || v.signature.length !== SIGNATURE_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.signature)) return { problem: "That is not a signature" };
  const since = typeof v.since === "string" && v.since.length <= 40 && !Number.isNaN(Date.parse(v.since)) ? v.since : undefined;
  if (v.since !== undefined && !since) return { problem: "The date is not valid" };
  if (since && version !== 1) return { problem: "Only version 1 has a date" };
  const restart = v.restart === true;
  if (v.restart !== undefined && !restart) return { problem: "That is not a new beginning" };
  if (restart && version === 1) return { problem: "Version 1 can not be a new beginning" };
  if (restart && !devices.some((d) => d.keyId === v.signedBy)) return { problem: "A new beginning must be signed by one of its own devices" };
  return { list: { version, devices, prev, signedBy: v.signedBy, signature: v.signature, ...(since ? { since } : {}), ...(restart ? { restart: true as const } : {}) } };
}

/** One other person of a connection with their device lists (GET .../safebox/key-lists): every version, oldest first; empty = an older lock without a list. */
export interface PersonKeyLists {
  uid: string;
  lists: DeviceList[];
}

/**
 * Re-locking old items (design: docs/design/default-key.md, step 5b). An item is stale when one of its copies of the content key is for a key of mine that was
 * retired. The device opens it with a key it has, locks it anew with a fresh content key for the keys now in use, and sends it back.
 * GET .../reencrypt/todo?part=messages|box&after=<cursor>
 */
export interface ReencryptTodo {
  part: "messages" | "box";
  /** a message: my copy of it (the locked text and its `enc`); an object of the box: the locked head and body */
  items: ReencryptItem[];
  next: string | null;
}

export interface ReencryptItem {
  id: string;
  /** the friendship the item is in (a lock is bound to it) */
  connectionId?: string;
  /** the circle of MY entry of that friendship (the routes of a friendship are under it) */
  circleId?: string;
  /** the revision the object started from (the box part only) */
  revision?: number;
  /** the locked text of a message */
  text?: string;
  /** the item's `enc` as the server keeps it, with only MY copies of the key */
  enc: Record<string, unknown>;
}
