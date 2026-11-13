import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { DeviceList, KeyBackup, MyKeys, PublishedKey, canonicalPublicKey, canonicalSignKey, fingerprintOf, keyIdOf } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { StoredDeviceKey, unpackBackup, deleteDeviceKey, deviceKeySupported, deviceKeyWorks, generateDeviceKey, generateIdentityKey, getDeviceKey, keepDeviceKey, restoreDeviceKey, saveDeviceKey, storedKeyOwners } from './device-key';
import { lockBackup, unlockBackup } from './key-backup';
import { keyOf, newRecoveryKey, wordsOf } from './recovery-code';
import { tr } from './i18n';
import { deviceLabel } from './device-name';
import { firstDeviceList } from './device-list';
import { myDeviceKey } from './my-key';
import { DeviceListService } from './device-list.service';
import { OwnRecoveryService } from './own-recovery.service';
import { ReencryptService } from './reencrypt.service';

/** How a restore from the recovery words ended. */
export type RestoreResult = 'ok' | 'bad-words' | 'no-backup' | 'wrong-code' | 'no-key';

/** What the last look at the key found (shown on Settings → Privacy lock, so a missing key can be explained). */
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
  private readonly deviceList = inject(DeviceListService);
  private readonly ownRecovery = inject(OwnRecoveryService);
  private readonly reencrypt = inject(ReencryptService);

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
  /** a recovery backup of a key of mine is stored (a key made with the 24 words); false = the keys of this person were made silently and can not be restored, only approved */
  readonly hasBackup = signal(false);

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
      this.hasBackup.set(!!id && (mine.backups?.includes(id) || (!mine.backups?.length && mine.hasBackup))); // the words of THIS device (an account from before there was one per key: its one backup counts)
      this.state.set(ready ? 'ready' : 'none');
      if (ready && mine.keys.some((k) => k.revoked)) void this.reencrypt.run(); // what a retired key could open is locked anew (quiet, at most every 10 minutes)
      if (ready) void keepDeviceKey(); // ask again on every visit: the browser may grant it later, and then it does not clear the key
      if (ready && local && found && found.label !== deviceLabel()) void this.relabel(local.publicKey, found.id);
      // a device with no key of its own makes one without being asked (docs/design/default-key.md), also when the person has keys on other devices and a rescue code:
      // the new key waits, and another device of the person approves it by itself. A key on this device (even an unpublished one) is never replaced.
      if (!ready && !local) {
        if (await this.makeIdentity()) return;
      } else if (ready && local?.signKey) void this.ensureList(local);
    } catch {
      // the server (or the key store) could not be asked: a key that was known to be ready stays; otherwise the person can still try to set up
      if (this.state() !== 'ready') this.state.set('none');
      const before = this.diagnosis();
      this.diagnosis.set({ account: this.auth.user()?.uid ?? '', localKeyId: before?.localKeyId ?? null, localPublished: before?.localPublished ?? null, active: before?.active ?? 0, removed: before?.removed ?? 0, accountsInBrowser: (await storedKeyOwners()).length, failed: true });
    }
  }

  private readonly identityTried = new Set<string>();
  private readonly listChecked = new Set<string>();

  /**
   * The silent first sign-in: makes the lock key and the signing key on this device (neither can be read out), publishes them, and publishes
   * version 1 of the device list. Nothing is shown. Tried once per person per start of the app; if it fails the person simply has no key
   * (as before) and Settings → Privacy lock still offers one. Returns true when the key is in place.
   */
  private async makeIdentity(): Promise<boolean> {
    const uid = this.uid;
    if (this.identityTried.has(uid)) return false;
    this.identityTried.add(uid);
    const key = await generateIdentityKey().catch(() => null);
    const publicKey = key ? canonicalPublicKey(key.publicKey) : null;
    const signKey = key ? canonicalSignKey(key.signKey?.publicKey) : null;
    if (!key || !publicKey || !signKey) return false;
    try {
      await saveDeviceKey(uid, key);
      await this.api.request('/keys', { method: 'POST', body: JSON.stringify({ publicKey, signKey, label: deviceLabel() }) });
      await this.refresh();
      if (this.thisKeyId() !== keyIdOf((await fingerprintOf(publicKey))!) || !(await deviceKeyWorks(uid, key.publicKey))) throw new Error('The key could not be checked');
      return true;
    } catch {
      // put this device back as it was: no key (the server may hold a public key that no device has; it is retired so it is not used)
      await deleteDeviceKey(uid).catch(() => undefined);
      const id = keyIdOf((await fingerprintOf(publicKey)) ?? '');
      if (id) await this.api.request(`/keys/${id}/revoke`, { method: 'POST' }).catch(() => undefined);
      await this.refresh();
      return false;
    }
  }

  /** Publishes version 1 of the device list when there is none and this device is the only one (also when an earlier try was cut off). */
  private async ensureList(local: StoredDeviceKey): Promise<void> {
    const uid = this.uid;
    if (this.listChecked.has(uid)) return;
    this.listChecked.add(uid);
    try {
      const { lists } = await this.api.request<{ lists: DeviceList[] }>('/keys/list');
      if (lists.length || this.published().filter((k) => !k.revoked).length !== 1) return;
      const list = await firstDeviceList(local, deviceLabel());
      if (list) await this.api.request('/keys/list', { method: 'POST', body: JSON.stringify(list) });
    } catch {
      this.listChecked.delete(uid); // the next refresh tries again
    }
  }

  /** A key that has been made and shown with its recovery words but is not saved yet: it only exists here, in memory. */
  private pending: { uid: string; key: StoredDeviceKey; publicKey: NonNullable<ReturnType<typeof canonicalPublicKey>>; signKey: ReturnType<typeof canonicalSignKey>; backup: KeyBackup; replaces: string | null } | null = null;

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
      this.pending = { uid, key: created.key, publicKey, signKey: canonicalSignKey(created.key.signKey?.publicKey), backup, replaces: replace ? this.thisKeyId() : null };
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
    const replacing = pending.replaces && before ? before : null; // a rotation: the old key is still here and hands its history over before it goes
    const newId = keyIdOf((await fingerprintOf(pending.publicKey))!);
    let published = false;
    this.ownRecovery.madeKey(newId); // this device made it: it never asks itself to approve it
    try {
      const body = JSON.stringify({ publicKey: pending.publicKey, ...(pending.signKey ? { signKey: pending.signKey } : {}), label: deviceLabel(), backup: pending.backup });
      if (replacing) {
        // 1. the new key and its backup go to the server in ONE step, while the old key is still the key of this device
        const added = await this.api.request<PublishedKey>('/keys', { method: 'POST', body });
        published = true;
        // 2. the old key gives the new one its copies of every message and file key (it is the only one that can; the new key is not on this device yet)
        const old = await myDeviceKey(uid);
        if (old) await this.ownRecovery.allow(added, () => undefined, old);
        // 3. the next version of the signed device list: the new device in place of the old one, signed by the old key (version 1 for a person who had no list)
        await this.deviceList.rotate(replacing, pending.key, added);
        // 4. only now is the new key the key of this device
        await saveDeviceKey(uid, pending.key);
      } else {
        await saveDeviceKey(uid, pending.key);
        // the key and its backup are stored in ONE step on the server: a key is never published without its backup (nor a backup without its key)
        await this.api.request('/keys', { method: 'POST', body });
        published = true;
      }
      // and it is read back: the key counts as made only when the server lists it as in use ...
      await this.refresh();
      if (this.thisKeyId() !== newId) throw new Error(tr('core.theKeyCouldNot2', 'The key could not be saved on the server. Try again.'));
      // ... and the key on this device is the same one and works
      if (!(await deviceKeyWorks(uid, pending.key.publicKey))) throw new Error(tr('core.theKeyOnThis', 'The key on this device could not be checked. Try again.'));
    } catch (err) {
      if (before) await saveDeviceKey(uid, before);
      else await deleteDeviceKey(uid);
      if (published && replacing) await this.api.request(`/keys/${newId}/revoke`, { method: 'POST' }).catch(() => undefined); // the new key was never the key of this device: it does not count
      await this.refresh();
      throw err;
    }
    this.pending = null;
    void keepDeviceKey(); // ask the browser not to clear the key when it is short of room
    // a key this one replaces is retired only now that the new one is safe
    if (pending.replaces && pending.replaces !== this.thisKeyId()) {
      await this.revoke(pending.replaces, !replacing); // a rotation has already taken it out of the list
      void this.reencrypt.run(true); // and what only it could open is locked anew
    }
  }

  private relabelled = new Set<string>();

  /** The key of this device gets the name that tells its kind and device (an older key only had "Browser, <date>"). Checked on every start and refresh of the app (a name that is already right is not sent again). */
  private async relabel(jwk: JsonWebKey, id: string): Promise<void> {
    if (this.relabelled.has(id)) return;
    this.relabelled.add(id);
    const publicKey = canonicalPublicKey(jwk);
    if (!publicKey) return;
    try {
      const label = deviceLabel();
      await this.api.request('/keys', { method: 'POST', body: JSON.stringify({ publicKey, label }) });
      this.published.update((list) => list.map((k) => (k.id === id ? { ...k, label } : k)));
    } catch {
      this.relabelled.delete(id); // the old name stays; the next refresh tries again
    }
  }

  /** Retires a key of mine (a lost or replaced device): it is no longer used for new files. */
  async revoke(id: string, listed = true, by?: string): Promise<void> {
    if (listed) await this.deviceList.publishNext({ removeId: id }); // out of the signed list first, so friends stop locking for it (quiet when this device can not sign)
    await this.api.request(`/keys/${id}/revoke`, { method: 'POST', body: JSON.stringify({ by }) });
    await this.refresh();
  }

  /** Every other device of mine is lost: this device starts my signed list over (see `DeviceListService.restart`) and the server retires the other keys. */
  async startOver(): Promise<void> {
    await this.deviceList.restart();
    await this.refresh();
  }

  /**
   * Puts this person's key on this device from the 24 recovery words: the backup on the server is opened with them, and the key that fits
   * one of the published public keys is saved here (sealed again). Needs no key on this device yet.
   */
  async restore(words: string[]): Promise<RestoreResult> {
    const recoveryKey = await keyOf(words);
    if (!recoveryKey) return 'bad-words';
    const strayId = this.thisKeyId(); // a key this device made by itself, still waiting for approval: it is replaced by the restored one
    let backups: KeyBackup[];
    try {
      backups = (await this.api.request<{ backups: KeyBackup[] }>('/keys/backups')).backups;
    } catch {
      return 'no-backup';
    }
    // every device has its own backup: the words open only the backup of their own key
    let pkcs8: Uint8Array | null = null;
    for (const backup of backups) {
      pkcs8 = await unlockBackup(backup, recoveryKey);
      if (pkcs8) break;
    }
    recoveryKey.fill(0);
    if (!pkcs8) return 'wrong-code';
    try {
      let parts: ReturnType<typeof unpackBackup>;
      try {
        parts = unpackBackup(pkcs8); // an older backup holds the lock key only; a newer one the lock key and the signing key
      } catch {
        return 'wrong-code';
      }
      const { lock, sign } = parts;
      const mine = await this.api.request<MyKeys>('/keys');
      for (const key of mine.keys.filter((k) => !k.revoked)) {
        try {
          await restoreDeviceKey(this.uid, key.id, lock, key.publicKey, undefined, sign && key.signKey ? { pkcs8: sign, publicKey: key.signKey } : undefined);
          void keepDeviceKey();
          if (strayId && strayId !== key.id) await this.revoke(strayId, false, key.id).catch(() => undefined); // not listed, so nothing to publish
          else await this.refresh();
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
