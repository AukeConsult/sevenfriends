import { unpackBackup, StoredDeviceKey, createDeviceKey, deleteDeviceKey, deviceKeySupported, deviceKeyWorks, generateDeviceKey, getDeviceKey, keepDeviceKey, restoreDeviceKey, saveDeviceKey } from './device-key';

/** These run in Chrome (karma), with the real Web Crypto and the real IndexedDB; every test uses its own person, which is removed again. */
describe('device key', () => {
  const people: string[] = [];
  const person = () => {
    const uid = `test-${crypto.randomUUID()}`;
    people.push(uid);
    return uid;
  };

  let originalTimeout: number;
  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60_000; // making a 3072 bit key takes a few seconds
  });
  afterAll(async () => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
    await Promise.all(people.map((uid) => deleteDeviceKey(uid)));
  });

  const encrypt = async (publicKey: JsonWebKey, bytes: Uint8Array) => {
    const key = await crypto.subtle.importKey('jwk', publicKey, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    return crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, bytes as BufferSource);
  };

  it('is supported in this browser', () => {
    expect(deviceKeySupported()).toBeTrue();
  });

  it('has no key until one is made', async () => {
    expect(await getDeviceKey(person())).toBeNull();
  });

  it('makes a sealed private key and a public key that can be published', async () => {
    const uid = person();
    const { key, backup } = await createDeviceKey(uid);
    expect(backup).toBeUndefined();
    expect(key.id).toMatch(/^[0-9a-f]{24}$/);
    expect(key.publicKey.kty).toBe('RSA');
    expect(key.publicKey.alg).toBe('RSA-OAEP-256');
    expect(key.publicKey.d).toBeUndefined(); // nothing private in the public key
    expect(key.privateKey.extractable).toBeFalse();
    expect(key.privateKey.usages).toEqual(jasmine.arrayContaining(['decrypt', 'unwrapKey']));
    await expectAsync(crypto.subtle.exportKey('pkcs8', key.privateKey)).toBeRejected(); // its bytes cannot be read
    await expectAsync(crypto.subtle.exportKey('jwk', key.privateKey)).toBeRejected();
  });

  it('keeps the key: it is found again, and it decrypts what the public key encrypted', async () => {
    const uid = person();
    const { key } = await createDeviceKey(uid);
    const found = (await getDeviceKey(uid)) as StoredDeviceKey;
    expect(found.id).toBe(key.id);
    expect(found.publicKey).toEqual(key.publicKey);
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const opened = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, found.privateKey, await encrypt(found.publicKey, secret)));
    expect(Array.from(opened)).toEqual(Array.from(secret));
  });

  it('keeps one key for each person', async () => {
    const a = person();
    const b = person();
    const first = (await createDeviceKey(a)).key;
    expect(await getDeviceKey(b)).toBeNull();
    const second = (await createDeviceKey(b)).key;
    expect((await getDeviceKey(a))?.id).toBe(first.id);
    expect((await getDeviceKey(b))?.id).toBe(second.id);
  });

  it('forgets the key when asked', async () => {
    const uid = person();
    await createDeviceKey(uid);
    await deleteDeviceKey(uid);
    expect(await getDeviceKey(uid)).toBeNull();
  });

  it('hands over the private key as bytes for the backup only when asked, and a backup restores the key', async () => {
    const original = person();
    const { key, backup } = await createDeviceKey(original, { forBackup: true });
    expect(backup instanceof Uint8Array && backup.length > 1000).toBeTrue();
    // a new device: the same key put back from the backup, sealed again
    const fresh = person();
    const restored = await restoreDeviceKey(fresh, key.id, unpackBackup(backup as Uint8Array).lock, key.publicKey);
    expect(restored.privateKey.extractable).toBeFalse();
    expect((await getDeviceKey(fresh))?.id).toBe(key.id);
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const opened = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, restored.privateKey, await encrypt(key.publicKey, secret)));
    expect(Array.from(opened)).toEqual(Array.from(secret));
  });

  it('makes a key in memory without saving it, and saves it only when asked', async () => {
    const uid = person();
    const { key, backup } = await generateDeviceKey();
    expect(backup).toBeDefined();
    expect(await getDeviceKey(uid)).toBeNull(); // nothing is on the device yet
    expect(await deviceKeyWorks(uid, key.publicKey)).toBeFalse();
    await saveDeviceKey(uid, key);
    expect((await getDeviceKey(uid))?.id).toBe(key.id);
    expect(await deviceKeyWorks(uid, key.publicKey)).toBeTrue(); // read back, same key, and what it locks it opens
  });

  it('does not accept a key on the device that is not the expected one', async () => {
    const uid = person();
    const saved = (await createDeviceKey(uid)).key;
    const other = (await generateDeviceKey()).key;
    expect(await deviceKeyWorks(uid, saved.publicKey)).toBeTrue();
    expect(await deviceKeyWorks(uid, other.publicKey)).toBeFalse();
  });

  it('refuses a backup that belongs to another key', async () => {
    const { backup } = await createDeviceKey(person(), { forBackup: true });
    const other = (await createDeviceKey(person())).key;
    await expectAsync(restoreDeviceKey(person(), other.id, unpackBackup(backup as Uint8Array).lock, other.publicKey)).toBeRejectedWithError('That backup does not belong to this key.');
  });

  it('can ask the browser to keep the data, and answers yes or no', async () => {
    expect(typeof (await keepDeviceKey())).toBe('boolean');
  });

  it('a key made for a rescue code has a signing key, and the backup brings both back on a new device', async () => {
    const { key, backup } = await generateDeviceKey();
    expect(key.signKey).toBeTruthy();
    const parts = unpackBackup(backup as Uint8Array);
    expect(parts.sign).toBeTruthy();
    const fresh = person();
    const restored = await restoreDeviceKey(fresh, key.id, parts.lock, key.publicKey, undefined, { pkcs8: parts.sign!, publicKey: key.signKey!.publicKey });
    expect(restored.signKey).toBeTruthy();
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, restored.signKey!.privateKey, new Uint8Array([1, 2, 3]));
    const verifier = await crypto.subtle.importKey('jwk', key.signKey!.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, signature, new Uint8Array([1, 2, 3]))).toBeTrue();
    // a signing key of another device is refused
    const other = await generateDeviceKey();
    await expectAsync(restoreDeviceKey(person(), key.id, parts.lock, key.publicKey, undefined, { pkcs8: unpackBackup(other.backup as Uint8Array).sign!, publicKey: key.signKey!.publicKey })).toBeRejected();
  });

  it('an older backup (the lock key alone) is read as it is', async () => {
    const { backup } = await createDeviceKey(person(), { forBackup: true });
    expect(unpackBackup(backup as Uint8Array).sign).toBeUndefined();
  });
});
