import { DeviceList, DeviceListEntry, PublicKeyJwk, PublishedKey, canonicalPublicKey, canonicalSignKey, deviceListText, fingerprintOf, keyIdOf } from '../models';
import { StoredDeviceKey } from './device-key';

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** The entry of a device in the device list, from its stored key, or null when the key has no signing key (an older lock) or is not valid. */
export async function entryOf(key: StoredDeviceKey, label: string): Promise<DeviceListEntry | null> {
  const lockKey = canonicalPublicKey(key.publicKey);
  const signKey = canonicalSignKey(key.signKey?.publicKey);
  const fingerprint = lockKey ? await fingerprintOf(lockKey) : null;
  return lockKey && signKey && fingerprint ? { keyId: keyIdOf(fingerprint), lockKey: lockKey as PublicKeyJwk, signKey, label } : null;
}

/**
 * Version 1 of a person's device list: the first device, signed by itself. (Later versions are signed by a device of the version before; see
 * docs/design/default-key.md, steps 4 and 5.)
 */
export async function firstDeviceList(key: StoredDeviceKey, label: string): Promise<DeviceList | null> {
  const entry = await entryOf(key, label);
  if (!entry || !key.signKey) return null;
  return signList({ version: 1, devices: [entry], prev: '', signedBy: entry.keyId, since: new Date().toISOString() }, key.signKey.privateKey);
}

/** A list with its signature: `signKey` is the sealed signing key of the device named in `signedBy`. */
export async function signList(list: Omit<DeviceList, 'signature'>, signKey: CryptoKey): Promise<DeviceList> {
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signKey, new TextEncoder().encode(deviceListText(list)));
  return { ...list, signature: toBase64(new Uint8Array(signature)) };
}

/** The entry of a PUBLISHED key (as the server lists it) for the device list, or null when it has no signing key (an older lock) or does not fit itself. */
export async function entryOfPublished(key: PublishedKey): Promise<DeviceListEntry | null> {
  const lockKey = canonicalPublicKey(key.publicKey);
  const signKey = canonicalSignKey(key.signKey);
  const fingerprint = lockKey ? await fingerprintOf(lockKey) : null;
  return lockKey && signKey && fingerprint && keyIdOf(fingerprint) === key.id ? { keyId: key.id, lockKey: lockKey as PublicKeyJwk, signKey, label: key.label } : null;
}

/** Does the signature of a list hold for the signing key of the device that signed it (one of `signers`)? */
export async function listSignatureHolds(list: DeviceList, signers: DeviceListEntry[]): Promise<boolean> {
  try {
    const signer = signers.find((d) => d.keyId === list.signedBy);
    if (!signer) return false;
    const key = await crypto.subtle.importKey('jwk', signer.signKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromBase64(list.signature) as BufferSource, new TextEncoder().encode(deviceListText(list)));
  } catch {
    return false;
  }
}
