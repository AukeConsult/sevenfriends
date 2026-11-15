import { deleteDeviceKey, wipeDeviceKeys } from './device-key';

/** Databases that a browser without `indexedDB.databases()` (older Safari) cannot list: the ones our own code and Firebase make. */
const KNOWN_DATABASES = ['sf-keys', 'firebaseLocalStorageDb', 'firebase-heartbeat-database', 'firebase-installations-database', 'firebase-messaging-database'];

/** Deletes one IndexedDB database; never throws and never waits for ever (a database that another tab holds open is given up after a few seconds). */
function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const timer = setTimeout(resolve, 3000);
      const request = indexedDB.deleteDatabase(name);
      const done = () => { clearTimeout(timer); resolve(); };
      request.onsuccess = done;
      request.onerror = done;
      request.onblocked = done;
    } catch {
      resolve();
    }
  });
}

/** The local things of ONE account: its key, and the pins of the friends' lists it holds. Never throws. (Everything of everybody is `wipeAllLocalData`.) */
export async function wipeAccountLocal(uid: string): Promise<void> {
  try {
    await deleteDeviceKey(uid);
  } catch {
    /* the key store cannot be opened: the whole database is wiped by the caller when nobody else is left */
  }
  try {
    const names: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name?.startsWith(`sf-list-pin:${uid}:`)) names.push(name);
    }
    names.forEach((name) => localStorage.removeItem(name));
  } catch {
    /* no storage */
  }
}

/**
 * Erases EVERYTHING this site keeps in this browser, for a deleted account: every key, all local choices (localStorage, sessionStorage), every
 * IndexedDB database (the keys, the media cache, the sign-in of Firebase), the cache storage and the service workers. Nothing of the person stays on
 * the device. Each step is separate, so one that fails does not stop the others. Never throws.
 */
export async function wipeAllLocalData(): Promise<void> {
  await wipeDeviceKeys();
  try { localStorage.clear(); } catch { /* no storage */ }
  try { sessionStorage.clear(); } catch { /* no storage */ }
  try {
    const names = new Set<string>(KNOWN_DATABASES);
    for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) names.add(db.name);
    for (const name of names) await deleteDatabase(name);
  } catch { /* no databases to list */ }
  try {
    for (const key of await caches.keys()) await caches.delete(key);
  } catch { /* no cache storage */ }
  try {
    for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  } catch { /* no service workers */ }
}
