import { fingerprintOf, keyIdOf } from '../models';
import { getDeviceKey } from './device-key';

/** The key of a person on this device with its id (as published), or null when there is none. */
export async function myDeviceKey(uid: string | undefined): Promise<{ uid: string; keyId: string; privateKey: CryptoKey } | null> {
  const device = uid ? await getDeviceKey(uid) : null;
  const fingerprint = device ? await fingerprintOf(device.publicKey) : null;
  return uid && device && fingerprint ? { uid, keyId: keyIdOf(fingerprint), privateKey: device.privateKey } : null;
}
