import { fingerprintOf, keyIdOf } from '../models';
import { getDeviceKey } from './device-key';

/**
 * The key of a person on this device with its id (as published), or null when there is none. `signKey` is the sealed signing key of this device
 * and is missing on an older lock (made before signing existed): what is written then goes out unsigned, as before.
 */
export async function myDeviceKey(uid: string | undefined): Promise<{ uid: string; keyId: string; privateKey: CryptoKey; signKey?: CryptoKey } | null> {
  const device = uid ? await getDeviceKey(uid) : null;
  const fingerprint = device ? await fingerprintOf(device.publicKey) : null;
  return uid && device && fingerprint ? { uid, keyId: keyIdOf(fingerprint), privateKey: device.privateKey, signKey: device.signKey?.privateKey } : null;
}
