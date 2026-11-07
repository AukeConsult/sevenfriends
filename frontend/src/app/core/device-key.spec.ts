import { StoredDeviceKey, createDeviceKey, deleteDeviceKey, deviceKeySupported, getDeviceKey, keepDeviceKey, restoreDeviceKey } from './device-key';

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
    const restored = await restoreDeviceKey(fresh, key.id, backup as Uint8Array, key.publicKey);
    expect(restored.privateKey.extractable).toBeFalse();
    expect((await getDeviceKey(fresh))?.id).toBe(key.id);
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const opened = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, restored.privateKey, await encrypt(key.publicKey, secret)));
    expect(Array.from(opened)).toEqual(Array.from(secret));
  });

  it('refuses a backup that belongs to another key', async () => {
    const { backup } = await createDeviceKey(person(), { forBackup: true });
    const other = (await createDeviceKey(person())).key;
    await expectAsync(restoreDeviceKey(person(), other.id, backup as Uint8Array, other.publicKey)).toBeRejectedWithError('That backup does not belong to this key.');
  });

  it('can ask the browser to keep the data, and answers yes or no', async () => {
    expect(typeof (await keepDeviceKey())).toBe('boolean');
  });
});
