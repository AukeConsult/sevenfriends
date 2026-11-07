import { KeyBackup } from '../models';

/**
 * The backup of the private key: the key's bytes scrambled with the recovery key (AES-256-GCM). The server keeps this and cannot open it;
 * only someone with the 24 words can (design: docs/design/safebox-encryption.md). The recovery key is random and full-strength,
 * so it is used as it is (no password stretching is needed).
 */
const ALGORITHM = 'AES-GCM';
/** Tied to what the backup is for: a backup cannot be passed off as anything else that is scrambled with the same key. */
const PURPOSE = new TextEncoder().encode('sevenfriends-key-backup-v1');

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const aesKey = (recoveryKey: Uint8Array, usage: KeyUsage) => crypto.subtle.importKey('raw', recoveryKey as BufferSource, ALGORITHM, false, [usage]);

/** Scrambles the private key (PKCS#8 bytes) with the recovery key. */
export async function lockBackup(pkcs8: Uint8Array, recoveryKey: Uint8Array): Promise<KeyBackup> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: ALGORITHM, iv, additionalData: PURPOSE }, await aesKey(recoveryKey, 'encrypt'), pkcs8 as BufferSource));
  return { v: 1, iv: toBase64(iv), data: toBase64(data) };
}

/** The private key bytes from a backup, or null when the recovery key is wrong or the backup was changed. */
export async function unlockBackup(backup: KeyBackup, recoveryKey: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (backup.v !== 1) return null;
    const bytes = await crypto.subtle.decrypt({ name: ALGORITHM, iv: fromBase64(backup.iv) as BufferSource, additionalData: PURPOSE }, await aesKey(recoveryKey, 'decrypt'), fromBase64(backup.data) as BufferSource);
    return new Uint8Array(bytes);
  } catch {
    return null;
  }
}
