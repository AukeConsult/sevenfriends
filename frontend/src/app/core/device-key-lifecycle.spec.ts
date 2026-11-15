import { createDeviceKey, deleteDeviceKey, deviceKeyWorks, generateIdentityKey, getDeviceKey, saveDeviceKey, storedKeyOwners, wipeDeviceKeys } from './device-key';

/**
 * The life of the keys in the browser: made, kept, deleted, wiped, made again, and the things that go wrong in Safari on an iPhone.
 * These run in Chrome (karma) with the real Web Crypto and the real IndexedDB. Every test starts from an empty key store.
 */
describe('device key lifecycle', () => {
  let originalTimeout: number;
  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 120_000; // a 3072 bit key takes a few seconds
  });
  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });
  beforeEach(async () => {
    await wipeDeviceKeys();
  });
  afterAll(async () => {
    await wipeDeviceKeys();
  });

  const person = () => `test-${crypto.randomUUID()}`;

  it('wipes the keys of every person at once', async () => {
    const [a, b, c] = [person(), person(), person()];
    await createDeviceKey(a);
    await createDeviceKey(b);
    await createDeviceKey(c);
    expect((await storedKeyOwners()).sort()).toEqual([a, b, c].sort());
    await wipeDeviceKeys();
    expect(await storedKeyOwners()).toEqual([]);
    expect(await getDeviceKey(a)).toBeNull();
    expect(await getDeviceKey(b)).toBeNull();
    expect(await getDeviceKey(c)).toBeNull();
  });

  it('a wipe of an empty store is fine, and can be done twice', async () => {
    await wipeDeviceKeys();
    await wipeDeviceKeys();
    expect(await storedKeyOwners()).toEqual([]);
  });

  it('deleting the key of one person leaves the others', async () => {
    const [a, b] = [person(), person()];
    await createDeviceKey(a);
    const kept = (await createDeviceKey(b)).key;
    await deleteDeviceKey(a);
    expect(await getDeviceKey(a)).toBeNull();
    expect((await getDeviceKey(b))?.id).toBe(kept.id);
  });

  it('a key can be made again after a delete, and it is a different key', async () => {
    const uid = person();
    const first = (await createDeviceKey(uid)).key;
    await deleteDeviceKey(uid);
    expect(await getDeviceKey(uid)).toBeNull();
    const second = (await createDeviceKey(uid)).key;
    expect(second.id).not.toBe(first.id);
    expect(JSON.stringify(second.publicKey)).not.toBe(JSON.stringify(first.publicKey));
    expect(await deviceKeyWorks(uid, second.publicKey)).toBeTrue();
  });

  it('a key can be made again after a wipe, for the same person and for another', async () => {
    const [a, b] = [person(), person()];
    const old = (await createDeviceKey(a)).key;
    await wipeDeviceKeys();
    const again = (await createDeviceKey(a)).key;
    const other = (await createDeviceKey(b)).key;
    expect(again.id).not.toBe(old.id);
    expect(await deviceKeyWorks(a, again.publicKey)).toBeTrue();
    expect(await deviceKeyWorks(b, other.publicKey)).toBeTrue();
    expect(await deviceKeyWorks(a, old.publicKey)).toBeFalse(); // the old key is gone for good
  });

  it('a wipe leaves other databases of the site alone', async () => {
    const name = `sf-other-${crypto.randomUUID()}`;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('things');
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
    await createDeviceKey(person());
    await wipeDeviceKeys();
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).toContain(name);
    expect(names).not.toContain('sf-keys-never-there');
    await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = () => resolve(); });
  });

  it('makes the identity key (lock key and signing key), saves it, and it works when read back', async () => {
    const uid = person();
    const key = await generateIdentityKey();
    expect(key.signKey).toBeTruthy();
    expect(key.privateKey.extractable).toBeFalse();
    expect(key.signKey!.privateKey.extractable).toBeFalse();
    await saveDeviceKey(uid, key);
    expect((await getDeviceKey(uid))?.id).toBe(key.id);
    expect(await deviceKeyWorks(uid, key.publicKey)).toBeTrue();
  });

  it('two identity keys are never the same', async () => {
    const [a, b] = [await generateIdentityKey(), await generateIdentityKey()];
    expect(a.id).not.toBe(b.id);
    expect(JSON.stringify(a.publicKey)).not.toBe(JSON.stringify(b.publicKey));
  });

  describe('when Safari on an iPhone misbehaves', () => {
    it('opens the key database again when the first open fails', async () => {
      const uid = person();
      const original = indexedDB.open.bind(indexedDB);
      let calls = 0;
      spyOn(indexedDB, 'open').and.callFake((name: string, version?: number) => {
        calls++;
        if (calls === 1) {
          const failing: { onerror?: () => void; error?: unknown } = {};
          setTimeout(() => failing.onerror?.(), 0); // "Connection to Indexed Database server lost"
          return failing as unknown as IDBOpenDBRequest;
        }
        return original(name, version);
      });
      expect(await getDeviceKey(uid)).toBeNull(); // the second open worked
      expect(calls).toBeGreaterThanOrEqual(2);
    });

    it('opens the key database again when the first open never answers', async () => {
      const uid = person();
      const original = indexedDB.open.bind(indexedDB);
      let calls = 0;
      spyOn(indexedDB, 'open').and.callFake((name: string, version?: number) => {
        calls++;
        if (calls === 1) return {} as unknown as IDBOpenDBRequest; // never answers
        return original(name, version);
      });
      expect(await getDeviceKey(uid)).toBeNull();
      expect(calls).toBeGreaterThanOrEqual(2);
    });

    it('gives up (and says why) when the key database cannot be opened at all', async () => {
      spyOn(indexedDB, 'open').and.callFake(() => {
        const failing: { onerror?: () => void; error?: unknown } = {};
        setTimeout(() => failing.onerror?.(), 0);
        return failing as unknown as IDBOpenDBRequest;
      });
      await expectAsync(getDeviceKey(person())).toBeRejected();
    });

    it('still makes an identity key when the browser cannot export the public key of an unextractable pair', async () => {
      const uid = person();
      const original = crypto.subtle.generateKey.bind(crypto.subtle) as (...args: unknown[]) => Promise<unknown>;
      let refused = 0;
      spyOn(crypto.subtle, 'generateKey').and.callFake(((algorithm: unknown, extractable: boolean, usages: unknown) => {
        if (!extractable) {
          refused++;
          return Promise.reject(new DOMException('exporting the public key is not allowed', 'OperationError'));
        }
        return original(algorithm, extractable, usages);
      }) as never);
      const key = await generateIdentityKey();
      expect(refused).toBeGreaterThan(0); // the first way was refused
      expect(key.signKey).toBeTruthy(); // and the second way made both keys
      expect(key.privateKey.extractable).toBeFalse(); // the saved private keys are still sealed
      expect(key.signKey!.privateKey.extractable).toBeFalse();
      await saveDeviceKey(uid, key);
      expect(await deviceKeyWorks(uid, key.publicKey)).toBeTrue();
    });
  });
});
