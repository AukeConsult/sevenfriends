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

/** A published key as the server lists it. `id` is the key ID (the first 32 hex characters of the fingerprint), `fingerprint` all 64. */
export interface PublishedKey {
  id: string;
  fingerprint: string;
  label: string;
  createdAt: string | null;
  revoked: boolean;
  /** the public key itself (it is public): a new device that restores its key from the backup picks the one that fits */
  publicKey: PublicKeyJwk;
}

/** What GET /keys returns: my published keys, and whether a recovery backup of the private key is stored. */
export interface MyKeys {
  keys: PublishedKey[];
  hasBackup: boolean;
}

/** What GET .../safebox/keys returns: the keys in use (not retired) of me and of my friend. Files can be locked only when both lists have a key. */
export interface BoxKeys {
  /** the user id of my friend (the copies of a file key are filed under it) */
  friendUid: string;
  mine: PublishedKey[];
  friend: PublishedKey[];
}

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
