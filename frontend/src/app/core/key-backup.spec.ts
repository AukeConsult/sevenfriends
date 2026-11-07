import { lockBackup, unlockBackup } from './key-backup';
import { newRecoveryKey } from './recovery-code';
import { canonicalPublicKey, fingerprintOf, keyIdOf, readableFingerprint } from '../models';

describe('key backup', () => {
  it('is opened with the same recovery key, and only with it', async () => {
    const key = newRecoveryKey();
    const secret = crypto.getRandomValues(new Uint8Array(1800));
    const backup = await lockBackup(secret, key);
    expect(backup.v).toBe(1);
    expect(Array.from((await unlockBackup(backup, key))!)).toEqual(Array.from(secret));
    expect(await unlockBackup(backup, newRecoveryKey())).toBeNull();
  });

  it('is refused when it has been changed', async () => {
    const key = newRecoveryKey();
    const backup = await lockBackup(crypto.getRandomValues(new Uint8Array(100)), key);
    const bytes = Uint8Array.from(atob(backup.data), (c) => c.charCodeAt(0));
    bytes[3] ^= 1;
    expect(await unlockBackup({ ...backup, data: btoa(String.fromCharCode(...bytes)) }, key)).toBeNull();
  });
});

describe('key fingerprint', () => {
  it('is the same for the same key whatever else the JWK carries, and different for another key', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const fingerprint = (await fingerprintOf(jwk))!;
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(await fingerprintOf({ ...jwk, alg: 'RSA-OAEP-256', ext: false })).toBe(fingerprint);
    expect(canonicalPublicKey(jwk)).toEqual({ e: 'AQAB', kty: 'RSA', n: jwk.n! });
    expect(keyIdOf(fingerprint)).toBe(fingerprint.slice(0, 32));
    expect(await fingerprintOf({ ...jwk, n: jwk.n!.slice(0, -1) + (jwk.n!.endsWith('A') ? 'B' : 'A') })).not.toBe(fingerprint);
    expect(await fingerprintOf({ kty: 'RSA', n: 'short', e: 'AQAB' })).toBeNull();
    expect(readableFingerprint(fingerprint).split('\n').length).toBe(2);
  });
});
