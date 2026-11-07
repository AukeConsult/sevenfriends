/**
 * The device key: an RSA key pair made on THIS device for ONE signed-in person (design: docs/design/safebox-encryption.md).
 *
 * - The PRIVATE key is saved in the browser's own database (IndexedDB) as a sealed, non-extractable key: the app can ask the browser to
 *   decrypt with it, but nobody (this code included) can read its bytes. It never goes anywhere: not to the server, not to Firebase.
 * - The PUBLIC key is a plain JSON key (JWK) that can be published, so a friend's app can encrypt something for this device.
 * - A backup of the private key can be made ONCE when the pair is created (`backup`: the key as bytes). The caller scrambles it with
 *   the recovery code and must drop it at once; the saved key stays sealed.
 * - Restoring a key on a new device is `restoreDeviceKey`: the bytes of a backup go back in, sealed again.
 *
 * Nothing here talks to the server. A person who clears the app's data, reinstalls, or uses a new phone has no key until a new one is
 * made or restored: `getDeviceKey` then answers null.
 */

/** The algorithm: RSA-OAEP with SHA-256 (it works in every browser; it wraps the small key of a file, never the file itself). */
export const DEVICE_KEY_ALGORITHM: RsaHashedKeyGenParams = {
  name: 'RSA-OAEP',
  modulusLength: 3072,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

const DATABASE = 'sf-keys';
const STORE = 'keys';
/** The layout of what is saved; a later layout reads this number. */
const VERSION = 1;

/** What is saved for one person on this device. */
export interface StoredDeviceKey {
  /** a random name for this key (it tells the devices of one person apart) */
  id: string;
  /** the public key, as JSON (JWK) */
  publicKey: JsonWebKey;
  /** the sealed private key: it can decrypt and unwrap, nothing else, and its bytes cannot be read */
  privateKey: CryptoKey;
  createdAt: string;
  version: number;
}

/** What a new key gives back: the key itself, and (only when asked for) the private key as bytes for the backup. */
export interface CreatedDeviceKey {
  key: StoredDeviceKey;
  /** the private key as PKCS#8 bytes, only with `forBackup`: scramble it with the recovery code and let go of it */
  backup?: Uint8Array;
}

/** Where the keys are kept. IndexedDB in the app; a test can bring its own. */
export interface KeyStore {
  read(uid: string): Promise<StoredDeviceKey | null>;
  write(uid: string, key: StoredDeviceKey): Promise<void>;
  remove(uid: string): Promise<void>;
}

/** The browser can make and keep a key (Web Crypto needs a secure page: https or localhost). */
export function deviceKeySupported(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof indexedDB !== 'undefined';
}

// ---------------------------------------------------------------------------------------------------- the store in IndexedDB

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The key store could not be opened'));
    request.onblocked = () => reject(new Error('The key store is busy'));
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('The key store failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('The key store failed'));
    });
  } finally {
    database.close();
  }
}

/** A saved value that is not what this code writes (an older or damaged one) counts as no key. */
function valid(value: unknown): value is StoredDeviceKey {
  const v = value as Partial<StoredDeviceKey> | null | undefined;
  return !!v && typeof v.id === 'string' && !!v.publicKey && v.privateKey instanceof CryptoKey && typeof v.createdAt === 'string' && v.version === VERSION;
}

export const indexedDbKeyStore: KeyStore = {
  async read(uid) {
    const value = await run('readonly', (store) => store.get(uid));
    return valid(value) ? value : null;
  },
  async write(uid, key) {
    await run('readwrite', (store) => store.put(key, uid));
  },
  async remove(uid) {
    await run('readwrite', (store) => store.delete(uid));
  },
};

// ---------------------------------------------------------------------------------------------------- making, finding, restoring

const randomId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

/** The sealed copy of a private key given as bytes: the bytes can be thrown away afterwards, this one cannot be read out. */
function seal(pkcs8: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', pkcs8, { name: DEVICE_KEY_ALGORITHM.name, hash: 'SHA-256' }, false, ['decrypt', 'unwrapKey']);
}

/** The accounts that have a key in this browser (only their ids): for the page that explains why a key is, or is not, found. */
export async function storedKeyOwners(): Promise<string[]> {
  if (!deviceKeySupported()) return [];
  try {
    return (await run('readonly', (store) => store.getAllKeys())).map(String);
  } catch {
    return [];
  }
}

/** The key of this person on this device, or null when there is none (never made, or the app's data was cleared). */
export async function getDeviceKey(uid: string, store: KeyStore = indexedDbKeyStore): Promise<StoredDeviceKey | null> {
  if (!deviceKeySupported()) return null;
  return store.read(uid);
}

/**
 * Makes a new key pair for this person on this device and saves it (an earlier key of this person is replaced: keep it, or its files are lost).
 * The private key is made readable for a moment only to be sealed (and, with `forBackup`, handed over as bytes): the saved one cannot be read.
 */
export async function createDeviceKey(uid: string, options: { forBackup?: boolean; store?: KeyStore } = {}): Promise<CreatedDeviceKey> {
  if (!deviceKeySupported()) throw new Error('This browser cannot keep an encryption key (it needs a secure page).');
  const store = options.store ?? indexedDbKeyStore;
  const pair = await crypto.subtle.generateKey(DEVICE_KEY_ALGORITHM, true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const key: StoredDeviceKey = {
    id: randomId(),
    publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
    privateKey: await seal(pkcs8),
    createdAt: new Date().toISOString(),
    version: VERSION,
  };
  await store.write(uid, key);
  if (!options.forBackup) {
    new Uint8Array(pkcs8).fill(0); // not needed any more
    return { key };
  }
  return { key, backup: new Uint8Array(pkcs8) };
}

/**
 * Puts a key back on a new device from the bytes of its backup (the caller has unscrambled them with the recovery code), sealed again.
 * `publicKey` is the one published for it; the bytes must belong to it, or this throws.
 */
export async function restoreDeviceKey(uid: string, id: string, pkcs8: Uint8Array, publicKey: JsonWebKey, store: KeyStore = indexedDbKeyStore): Promise<StoredDeviceKey> {
  if (!deviceKeySupported()) throw new Error('This browser cannot keep an encryption key (it needs a secure page).');
  const bytes = pkcs8.buffer.slice(pkcs8.byteOffset, pkcs8.byteOffset + pkcs8.byteLength) as ArrayBuffer;
  const privateKey = await seal(bytes);
  // the private key must belong to the public key: whatever the public key encrypts, the private key must open
  const pub = await crypto.subtle.importKey('jwk', publicKey, { name: DEVICE_KEY_ALGORITHM.name, hash: 'SHA-256' }, false, ['encrypt']);
  const probe = crypto.getRandomValues(new Uint8Array(32));
  const sealed = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, probe);
  let opened: Uint8Array;
  try {
    opened = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, sealed));
  } catch {
    opened = new Uint8Array(); // the browser refuses to open it with a key that does not fit: the same answer as a wrong result
  }
  if (opened.length !== probe.length || opened.some((b, i) => b !== probe[i])) throw new Error('That backup does not belong to this key.');
  const key: StoredDeviceKey = { id, publicKey, privateKey, createdAt: new Date().toISOString(), version: VERSION };
  await store.write(uid, key);
  return key;
}

/** Forgets the key of this person on this device (sign-out of the account for good, or "reset"). The files made for this key can no longer be opened here. */
export async function deleteDeviceKey(uid: string, store: KeyStore = indexedDbKeyStore): Promise<void> {
  if (!deviceKeySupported()) return;
  await store.remove(uid);
}

/**
 * Asks the browser to keep this site's data (the key) even when the phone is short of room. A browser may say no; the answer is only
 * information: false = the key can be cleared by the browser when it needs space.
 */
export async function keepDeviceKey(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
