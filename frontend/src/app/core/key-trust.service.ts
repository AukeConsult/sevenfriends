import { Injectable, inject } from '@angular/core';
import { BoxKeys, PublishedKey } from '../models';
import { FriendListsService } from './friend-lists.service';
import { tr } from './i18n';

/** This device's key is not in my own device list yet: nothing can be sent from here until another device of mine has approved it (the page shows a way to the recovery page). */
export class NotApprovedError extends Error {}

/**
 * Which keys a new locked thing (a message, a file, a note, an item of the safebox) may be locked for: ONE place for all of them.
 * Where a person has a signed device list, only the keys in its newest version count: a key the server lists that is not in the list gets no copy, so the server
 * cannot add a key of its own and have things locked for it. A person without a list (an older lock) is as the server says. Nothing here asks the user for anything.
 */
@Injectable({ providedIn: 'root' })
export class KeyTrustService {
  private readonly lists = inject(FriendListsService);

  /**
   * The keys cut down to the ones in the signed lists. Throws, so nothing is sent, when a list does not hold (`broken`), when THIS device has not been approved into my
   * own list yet, or when a list leaves a person with no key at all (a thing must not fall back to plain because of that).
   */
  async limit(friendId: string, mine: { uid: string; keyId: string }, keys: BoxKeys): Promise<BoxKeys> {
    const refuse = (text: string): never => {
      throw new Error(text);
    };
    const cut = async (uid: string, list: PublishedKey[]): Promise<PublishedKey[]> => {
      const person = await this.lists.devicesOf(friendId, uid);
      if (person?.status === 'broken') return refuse(tr('core.theLockOfThis', 'The lock of this conversation does not check out, so nothing can be sent. Look at the warning under the name.'));
      if (person?.status !== 'ok' || !person.current) return list;
      const allowed = new Set(person.current.map((d) => d.keyId));
      const kept = list.filter((k) => allowed.has(k.id));
      if (list.length && !kept.length) return refuse(tr('core.noKeyInList', 'Not sent: your friend has a new key that is not approved on their account yet, so nothing can be locked for them. Ask them to open the app on a device they used before and tap Approve.'));
      return kept;
    };
    const me = await this.lists.devicesOf(friendId, mine.uid);
    if (me?.status === 'ok' && me.current && !me.current.some((d) => d.keyId === mine.keyId)) {
      throw new NotApprovedError(tr('core.thisDeviceNotApproved', 'Not sent: this device is not approved on your account yet. Open the app on another device of yours and tap Approve on the banner about the new key, then try again. With no other device, bring your key back with your 24 secret words (Settings → Privacy lock).'));
    }
    const others = await Promise.all((keys.others ?? []).map(async (o) => ({ ...o, keys: await cut(o.uid, o.keys) })));
    return { ...keys, mine: await cut(mine.uid, keys.mine), others, friend: keys.friendUid ? (others[0]?.keys ?? []) : [] };
  }
}
