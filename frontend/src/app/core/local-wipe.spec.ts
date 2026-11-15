import { createDeviceKey, storedKeyOwners } from './device-key';
import { wipeAllLocalData } from './local-wipe';

/** Deleting an account leaves nothing of the person in the browser. These run in Chrome (karma) with the real storage. */
describe('wipeAllLocalData', () => {
  let originalTimeout: number;
  beforeAll(() => {
    originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 120_000;
  });
  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  const makeDatabase = (name: string) =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('things');
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });

  it('removes the keys, the local choices, every database, the cache storage and the session', async () => {
    const database = `sf-test-${crypto.randomUUID()}`;
    await createDeviceKey(`test-${crypto.randomUUID()}`);
    await makeDatabase(database);
    localStorage.setItem('sf-ui', '{"theme":"dark"}');
    localStorage.setItem('sf-list-pin:me:friend', '3');
    sessionStorage.setItem('anything', '1');
    await (await caches.open('sf-test-cache')).put('/x', new Response('x'));

    await wipeAllLocalData();

    expect(await storedKeyOwners()).toEqual([]);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(database);
    expect(await caches.keys()).not.toContain('sf-test-cache');
  });

  it('can be done twice, and on a browser that holds nothing', async () => {
    await wipeAllLocalData();
    await wipeAllLocalData();
    expect(localStorage.length).toBe(0);
    expect(await storedKeyOwners()).toEqual([]);
  });

  it('after a wipe a new key can be made at once (a new account on the same browser)', async () => {
    await wipeAllLocalData();
    const uid = `test-${crypto.randomUUID()}`;
    await createDeviceKey(uid);
    expect(await storedKeyOwners()).toEqual([uid]);
    await wipeAllLocalData();
  });
});
