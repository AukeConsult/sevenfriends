import { Injectable, inject, signal } from '@angular/core';
import { KeyBackup, MyKeys, PublishedKey, canonicalPublicKey, fingerprintOf, keyIdOf } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { createDeviceKey, deleteDeviceKey, deviceKeySupported, getDeviceKey, keepDeviceKey, restoreDeviceKey } from './device-key';
import { lockBackup, unlockBackup } from './key-backup';
import { keyOf, newRecoveryKey, wordsOf } from './recovery-code';

/** How a restore from the recovery words ended. */
export type RestoreResult = 'ok' | 'bad-words' | 'no-backup' | 'wrong-code' | 'no-key';

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

  private get uid(): string {
    const uid = this.auth.user()?.uid;
    if (!uid) throw new Error('Not signed in');
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
      const ready = !!id && mine.keys.some((k) => k.id === id && !k.revoked);
      this.fingerprint.set(ready ? fingerprint : null);
      this.thisKeyId.set(ready ? id : null);
      this.state.set(ready ? 'ready' : 'none');
    } catch {
      this.state.set('none'); // the server could not be asked: the person can still try to set up
    }
  }

  /**
   * Makes the key, publishes it and stores the backup. Returns the 24 recovery words (the only place they ever exist besides the
   * person's own copy). If anything fails the new key is removed again, so nothing is half set up.
   */
  async setup(): Promise<string[]> {
    const uid = this.uid;
    const created = await createDeviceKey(uid, { forBackup: true });
    try {
      const publicKey = canonicalPublicKey(created.key.publicKey);
      if (!publicKey || !created.backup) throw new Error('The key could not be made.');
      const recoveryKey = newRecoveryKey();
      const backup = await lockBackup(created.backup, recoveryKey);
      const words = await wordsOf(recoveryKey);
      // the backup first: a key is published only when its backup is safe
      await this.api.request('/keys/backup', { method: 'PUT', body: JSON.stringify(backup) });
      await this.api.request('/keys', { method: 'POST', body: JSON.stringify({ publicKey, label: this.label() }) });
      recoveryKey.fill(0);
      created.backup.fill(0);
      void keepDeviceKey(); // ask the browser not to clear the key when it is short of room
      await this.refresh();
      return words;
    } catch (err) {
      created.backup?.fill(0);
      await deleteDeviceKey(uid);
      throw err;
    }
  }

  /** A name for this device in the list of keys. */
  private label(): string {
    const app = (window as unknown as { SevenFriendsAndroid?: unknown }).SevenFriendsAndroid ? 'Android app' : 'Browser';
    return `${app}, ${new Date().toISOString().slice(0, 10)}`;
  }

  /** Retires a key of mine (a lost or replaced device): it is no longer used for new files. */
  async revoke(id: string): Promise<void> {
    await this.api.request(`/keys/${id}/revoke`, { method: 'POST' });
    await this.refresh();
  }

  /** A new key for this device with new recovery words: the key it had is retired first (files locked for it can no longer be opened). Returns the words. */
  async reset(): Promise<string[]> {
    const old = this.thisKeyId();
    if (old) await this.revoke(old);
    return this.setup();
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
