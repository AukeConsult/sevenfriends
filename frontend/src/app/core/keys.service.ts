import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { KeyBackup, MyKeys, PublishedKey, canonicalPublicKey, fingerprintOf, keyIdOf } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { StoredDeviceKey, deleteDeviceKey, deviceKeySupported, deviceKeyWorks, generateDeviceKey, getDeviceKey, keepDeviceKey, restoreDeviceKey, saveDeviceKey, storedKeyOwners } from './device-key';
import { lockBackup, unlockBackup } from './key-backup';
import { keyOf, newRecoveryKey, wordsOf } from './recovery-code';
import { tr } from './i18n';

/** How a restore from the recovery words ended. */
export type RestoreResult = 'ok' | 'bad-words' | 'no-backup' | 'wrong-code' | 'no-key';

/** What the last look at the key found (shown on Settings → Keys, so a missing key can be explained). */
export interface KeyDiagnosis {
  /** the account (user id) this was looked up for */
  account: string;
  /** the key ID of the key found in this browser for this account, or null */
  localKeyId: string | null;
  /** is that key one of my published keys: 'yes', 'removed' (retired), 'no' (not published), or null when there is no local key */
  localPublished: 'yes' | 'removed' | 'no' | null;
  /** my published keys in use / retired */
  active: number;
  removed: number;
  /** how many accounts have a key in this browser, and whether this one is among them */
  accountsInBrowser: number;
  /** the server or the key store could not be asked */
  failed: boolean;
}

/**
 * 'checking' = not known yet; 'unsupported' = this browser cannot keep a key; 'none' = no key for this person on this device (or it was never
 * published); 'ready' = the key is on this device and its public part is published.
 */
export type EncryptionState = 'checking' | 'unsupported' | 'none' | 'ready';

/**
 * The encryption key of this person on this device: whether it is set up, and setting it up (design: docs/design/safebox-encryption.md,
 * step 2). Setting up makes the key pair on the device, publishes the public key, stores the scrambled backup of the private key on the
 * server, and hands back the 24 recovery words, which are shown once and never kept.
 */
@Injectable({ providedIn: 'root' })
export class KeysService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  readonly state = signal<EncryptionState>('checking');
  /** the fingerprint of this device's key (64 hex characters), once it is ready */
  readonly fingerprint = signal<string | null>(null);
  /** every key of mine that is published (my devices), as the server lists them; revoked ones too */
  readonly published = signal<PublishedKey[]>([]);
  /** the key ID of the key on THIS device, once it is ready */
  readonly thisKeyId = signal<string | null>(null);

  readonly diagnosis = signal<KeyDiagnosis | null>(null);

  /** true = no usable key is on THIS device, but keys of mine are published (made on another device, or the key of this browser was cleared): restoring it with the 24 words brings it back */
  readonly elsewhere = signal(false);

  constructor() {
    // another person signs in (or the person signs out) in this open app: what was known about the key of the one before is dropped
    let lastUid: string | null | undefined;
    effect(() => {
      const uid = this.auth.user()?.uid ?? null;
      if (lastUid === uid) return;
      const first = lastUid === undefined;
      lastUid = uid;
      if (first) return;
      untracked(() => {
        this.state.set('checking');
        this.fingerprint.set(null);
        this.thisKeyId.set(null);
        this.published.set([]);
        this.elsewhere.set(false);
        this.diagnosis.set(null);
        if (uid) void this.refresh();
      });
    });
  }

  private get uid(): string {
    const uid = this.auth.user()?.uid;
    if (!uid) throw new Error(tr('core.notSignedIn', 'Not signed in'));
    return uid;
  }

  /** Looks at this device and at the server: is there a key here whose public part is published? */
  async refresh(): Promise<void> {
    if (!deviceKeySupported()) {
      this.state.set('unsupported');
      return;
    }
    try {
      const local = await getDeviceKey(this.uid);
      const fingerprint = local ? await fingerprintOf(local.publicKey) : null;
      const mine = await this.api.request<MyKeys>('/keys');
      this.published.set(mine.keys);
      const id = fingerprint ? keyIdOf(fingerprint) : null;
      const found = id ? mine.keys.find((k) => k.id === id) : undefined;
      this.diagnosis.set({
        account: this.uid,
        localKeyId: id,
        localPublished: !id ? null : !found ? 'no' : found.revoked ? 'removed' : 'yes',
        active: mine.keys.filter((k) => !k.revoked).length,
        removed: mine.keys.filter((k) => k.revoked).length,
        accountsInBrowser: (await storedKeyOwners()).length,
        failed: false,
      });
      const ready = !!id && mine.keys.some((k) => k.id === id && !k.revoked);
      this.fingerprint.set(ready ? fingerprint : null);
      this.thisKeyId.set(ready ? id : null);
      this.elsewhere.set(!ready && mine.keys.some((k) => !k.revoked));
      this.state.set(ready ? 'ready' : 'none');
      if (ready) void keepDeviceKey(); // ask again on every visit: the browser may grant it later, and then it does not clear the key
    } catch {
      // the server (or the key store) could not be asked: a key that was known to be ready stays; otherwise the person can still try to set up
      if (this.state() !== 'ready') this.state.set('none');
      const before = this.diagnosis();
      this.diagnosis.set({ account: this.auth.user()?.uid ?? '', localKeyId: before?.localKeyId ?? null, localPublished: before?.localPublished ?? null, active: before?.active ?? 0, removed: before?.removed ?? 0, accountsInBrowser: (await storedKeyOwners()).length, failed: true });
    }
  }

  /** A key that has been made and shown with its recovery words but is not saved yet: it only exists here, in memory. */
  private pending: { uid: string; key: StoredDeviceKey; publicKey: NonNullable<ReturnType<typeof canonicalPublicKey>>; backup: KeyBackup; replaces: string | null } | null = null;

  /**
   * Step 1 of making a key: makes it in memory and returns the 24 recovery words (the only place they ever exist besides the person's own
   * copy). NOTHING is saved on this device or on the server yet: that happens in `commit`, when the person has written the words down and pressed Save.
   * `replace`: the key this device has now is retired when the new one is saved.
   */
  async prepare(replace = false): Promise<string[]> {
    const uid = this.uid;
    this.discard();
    const created = await generateDeviceKey();
    const recoveryKey = newRecoveryKey();
    try {
      const publicKey = canonicalPublicKey(created.key.publicKey);
      if (!publicKey || !created.backup) throw new Error(tr('core.theKeyCouldNot', 'The key could not be made.'));
      const backup = await lockBackup(created.backup, recoveryKey);
      const words = await wordsOf(recoveryKey);
      this.pending = { uid, key: created.key, publicKey, backup, replaces: replace ? this.thisKeyId() : null };
      return words;
    } finally {
      recoveryKey.fill(0);
      created.backup?.fill(0);
    }
  }

  /** Lets go of a key that was made but not saved (the person left before pressing Save). */
  discard(): void {
    this.pending = null;
  }

  /**
   * Step 2: saves the key made by `prepare` on this device, publishes it with its backup in ONE step on the server, and checks all of it: the server
   * lists the key as in use, and the key on this device is the same key and works. If anything fails, this device is put back as it was (the old key, or none).
   */
  async commit(): Promise<void> {
    const pending = this.pending;
    if (!pending) throw new Error(tr('core.thereIsNoNew', 'There is no new key to save. Start again.'));
    const uid = this.uid;
    if (pending.uid !== uid) {
      this.pending = null;
      throw new Error(tr('core.youSignedInAs', 'You signed in as someone else. Start again.'));
    }
    const before = await getDeviceKey(uid); // what this device had, to put it back if saving fails
    try {
      await saveDeviceKey(uid, pending.key);
      // the key and its backup are stored in ONE step on the server: a key is never published without its backup (nor a backup without its key)
      await this.api.request('/keys', { method: 'POST', body: JSON.stringify({ publicKey: pending.publicKey, label: this.label(), backup: pending.backup }) });
      // and it is read back: the key counts as made only when the server lists it as in use ...
      await this.refresh();
      const id = keyIdOf((await fingerprintOf(pending.publicKey))!);
      if (this.thisKeyId() !== id) throw new Error(tr('core.theKeyCouldNot2', 'The key could not be saved on the server. Try again.'));
      // ... and the key on this device is the same one and works
      if (!(await deviceKeyWorks(uid, pending.key.publicKey))) throw new Error(tr('core.theKeyOnThis', 'The key on this device could not be checked. Try again.'));
    } catch (err) {
      if (before) await saveDeviceKey(uid, before);
      else await deleteDeviceKey(uid);
      await this.refresh();
      throw err;
    }
    this.pending = null;
    void keepDeviceKey(); // ask the browser not to clear the key when it is short of room
    // a key this one replaces is retired only now that the new one is safe
    if (pending.replaces && pending.replaces !== this.thisKeyId()) await this.revoke(pending.replaces);
  }

  /** A name for this device in the list of keys. */
  private label(): string {
    const app = (window as unknown as { SevenFriendsAndroid?: unknown }).SevenFriendsAndroid ? tr('core.androidApp', 'Android app') : 'Browser';
    return `${app}, ${new Date().toISOString().slice(0, 10)}`;
  }

  /** Retires a key of mine (a lost or replaced device): it is no longer used for new files. */
  async revoke(id: string): Promise<void> {
    await this.api.request(`/keys/${id}/revoke`, { method: 'POST' });
    await this.refresh();
  }

  /**
   * Puts this person's key on this device from the 24 recovery words: the backup on the server is opened with them, and the key that fits
   * one of the published public keys is saved here (sealed again). Needs no key on this device yet.
   */
  async restore(words: string[]): Promise<RestoreResult> {
    const recoveryKey = await keyOf(words);
    if (!recoveryKey) return 'bad-words';
    let backup: KeyBackup;
    try {
      backup = await this.api.request<KeyBackup>('/keys/backup');
    } catch {
      return 'no-backup';
    }
    const pkcs8 = await unlockBackup(backup, recoveryKey);
    recoveryKey.fill(0);
    if (!pkcs8) return 'wrong-code';
    try {
      const mine = await this.api.request<MyKeys>('/keys');
      for (const key of mine.keys.filter((k) => !k.revoked)) {
        try {
          await restoreDeviceKey(this.uid, key.id, pkcs8, key.publicKey);
          void keepDeviceKey();
          await this.refresh();
          return 'ok';
        } catch {
          /* not this one: the backup belongs to another of the keys */
        }
      }
      return 'no-key';
    } finally {
      pkcs8.fill(0);
    }
  }
}
