import { Injectable, inject } from '@angular/core';
import { DeviceList, PublishedKey, deviceListHash } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { StoredDeviceKey } from './device-key';
import { entryOf, entryOfPublished, firstDeviceList, signList } from './device-list';
import { myDeviceKey } from './my-key';

/**
 * The next version of my own device list (docs/design/default-key.md, step 4): a device I approve is added, a device I remove is taken out. The new version is
 * signed by THIS device, which must be in the newest version and have a signing key; friends accept it because its signer is in the version they have pinned.
 * A person without a list (an older lock) or a device without a signing key can not do this: nothing is published and the caller goes on as before.
 */
@Injectable({ providedIn: 'root' })
export class DeviceListService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  /** Publishes the next version with `add` in it and/or without `removeId`. Returns true when a new version was published, false when nothing needed to change or it could not be done. */
  async publishNext(change: { add?: PublishedKey; removeId?: string }, attempt = 0): Promise<boolean> {
    try {
      const mine = await myDeviceKey(this.auth.user()?.uid);
      if (!mine?.signKey) return false;
      const { lists } = await this.api.request<{ lists: DeviceList[] }>('/keys/list');
      const head = [...lists].sort((a, b) => a.version - b.version).at(-1);
      if (!head || !head.devices.some((d) => d.keyId === mine.keyId)) return false; // no list, or this device is not in it: it can not sign for the person
      let devices = head.devices.filter((d) => d.keyId !== change.removeId);
      if (change.add && !devices.some((d) => d.keyId === change.add!.id)) {
        const entry = await entryOfPublished(change.add);
        if (!entry) return false; // the key has no signing key (an older lock): it stays outside the list
        devices = [...devices, entry];
      }
      if (devices.length === head.devices.length && devices.every((d, i) => d.keyId === head.devices[i].keyId)) return false; // nothing to change
      if (!devices.length) return false; // a list is never empty
      const next = await signList({ version: head.version + 1, devices, prev: await deviceListHash(head), signedBy: mine.keyId }, mine.signKey);
      await this.api.request('/keys/list', { method: 'POST', body: JSON.stringify(next) });
      return true;
    } catch (err) {
      if ((err as { status?: number })?.status === 409 && attempt < 2) return this.publishNext(change, attempt + 1); // another device published first: look again
      return false;
    }
  }

  /**
   * A rotation (a new lock made for a rescue code): the next version has the NEW device in place of the old one, signed by the OLD signing key, so friends accept it.
   * A person with no list yet (an older lock, which has no signing key) gets version 1 with the new device, signed by the new key itself. Throws when it can not be done,
   * so the caller does not go on with the swap.
   */
  async rotate(old: StoredDeviceKey, newKey: StoredDeviceKey, added: PublishedKey): Promise<void> {
    const { lists } = await this.api.request<{ lists: DeviceList[] }>('/keys/list');
    const head = [...lists].sort((a, b) => a.version - b.version).at(-1);
    if (!head) {
      const first = await firstDeviceList(newKey, added.label);
      if (!first) throw new Error('The new key has no signing key');
      await this.api.request('/keys/list', { method: 'POST', body: JSON.stringify(first) });
      return;
    }
    const oldEntry = await entryOf(old, '');
    const entry = await entryOfPublished(added);
    if (!oldEntry || !old.signKey || !entry || !head.devices.some((d) => d.keyId === oldEntry.keyId)) throw new Error('This device can not sign the next version of the list');
    const devices = [...head.devices.filter((d) => d.keyId !== oldEntry.keyId), entry];
    const next = await signList({ version: head.version + 1, devices, prev: await deviceListHash(head), signedBy: oldEntry.keyId }, old.signKey.privateKey);
    await this.api.request('/keys/list', { method: 'POST', body: JSON.stringify(next) });
  }
}
