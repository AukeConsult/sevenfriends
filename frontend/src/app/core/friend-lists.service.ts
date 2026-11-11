import { Injectable, inject, signal } from '@angular/core';
import { DeviceList, DeviceListEntry, deviceListHash } from '../models';
import { ActiveCircleService } from './active-circle.service';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { listSignatureHolds } from './device-list';
import { dropLinkPin, linkPinOf } from './list-pin';
import { SafeboxService } from './safebox.service';

/**
 * What is known of a person's device list: 'none' = no list (an older lock, or the person has no key), 'ok' = a list whose chain and signatures hold and that
 * contains what this device has pinned, 'broken' = the chain or a signature fails, or the lists no longer contain what was pinned earlier (docs/design/default-key.md).
 * `devices` are the devices of EVERY version of a valid chain (a message from a device that was removed later is still the person's), newest list first.
 */
export interface PersonDevices {
  status: 'none' | 'ok' | 'broken';
  devices: DeviceListEntry[];
  /** the devices of the NEWEST version: the keys a text may be locked for (empty unless 'ok') */
  current?: DeviceListEntry[];
  /** from when this person's texts are signed (version 1's date), or null (an older list, or none) */
  since?: string | null;
  /**
   * why it is broken: 'chain' = a signature or a link fails (nothing can be trusted, only the person can say what happened); 'gone' = lists that were seen are no longer
   * there; 'pin' = a valid chain that does not contain the version this device pinned (a new history: the person may have started over, and can be asked).
   */
  reason?: 'chain' | 'gone' | 'pin';
}

/** A person whose lists do not hold, shown in the warning under the header of a friend's page. */
export interface BrokenPerson {
  uid: string;
  reason: 'chain' | 'gone' | 'pin';
}

/** How long what was fetched of a friend's lists is used again before they are fetched anew. */
const LISTS_FRESH_MS = 60_000;

/** Checks a chain of lists: versions 1..n in a row, version 1 signed by one of its own devices, every later one linked to the one before and signed by a device of it. */
export async function chainHolds(lists: DeviceList[]): Promise<boolean> {
  const sorted = [...lists].sort((a, b) => a.version - b.version);
  for (let i = 0; i < sorted.length; i++) {
    const list = sorted[i];
    if (list.version !== i + 1) return false;
    if (i === 0) {
      if (list.prev !== '' || !(await listSignatureHolds(list, list.devices))) return false;
    } else if (list.prev !== (await deviceListHash(sorted[i - 1])) || !(await listSignatureHolds(list, sorted[i - 1].devices))) return false;
  }
  return true;
}

/** The device lists of the people I write with: fetched, checked and pinned on this device (the head that was seen last is kept; a chain that no longer contains it is 'broken'). */
@Injectable({ providedIn: 'root' })
export class FriendListsService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly safebox = inject(SafeboxService);
  private readonly cache = new Map<string, Promise<Map<string, PersonDevices>>>();
  private readonly cachedAt = new Map<string, number>();
  /** the people whose lists do not hold, by connection (friend or group): the warning reads this */
  readonly broken = signal<Record<string, BrokenPerson[]>>({});

  constructor() {
    inject(ActiveCircleService).onSwitch(() => {
      this.cache.clear();
      this.broken.set({});
    });
  }

  /** The devices of one person of a connection (me: my own published lists), or null when the lists could not be fetched (offline). */
  async devicesOf(connectionId: string, uid: string, fresh = false): Promise<PersonDevices | null> {
    try {
      if (fresh) {
        this.cache.delete(connectionId);
        this.mineJob = null;
      }
      const me = this.auth.user()?.uid;
      if (uid === me) return (await this.mine()).get(uid) ?? { status: 'none', devices: [] };
      return (await this.people(connectionId)).get(uid) ?? { status: 'none', devices: [] };
    } catch {
      return null;
    }
  }

  /** The version and hash of my newest device list (for the friend link), or null when I have none (an older lock) or it could not be fetched. */
  async myHead(): Promise<{ uid: string; version: number; hash: string } | null> {
    try {
      const me = this.auth.user()?.uid;
      const { lists } = await this.api.request<{ lists: DeviceList[] }>('/keys/list');
      const head = [...lists].sort((a, b) => a.version - b.version).at(-1);
      return me && head ? { uid: me, version: head.version, hash: await deviceListHash(head) } : null;
    } catch {
      return null;
    }
  }

  private mineJob: Promise<Map<string, PersonDevices>> | null = null;
  private mineAt = 0;
  private mine(): Promise<Map<string, PersonDevices>> {
    if (this.mineJob && Date.now() - this.mineAt > LISTS_FRESH_MS) this.mineJob = null; // my own list changes when I approve a device
    if (!this.mineJob) this.mineAt = Date.now();
    const me = this.auth.user()?.uid ?? '';
    this.mineJob ??= this.api
      .request<{ lists: DeviceList[] }>('/keys/list')
      .then(async ({ lists }) => new Map([[me, await this.judge(me, lists)]]))
      .catch((err) => {
        this.mineJob = null;
        throw err;
      });
    return this.mineJob;
  }

  private people(connectionId: string): Promise<Map<string, PersonDevices>> {
    let job = this.cache.get(connectionId);
    if (job && Date.now() - (this.cachedAt.get(connectionId) ?? 0) > LISTS_FRESH_MS) job = undefined; // a new version may be out (a device was approved): look again now and then
    if (!job) {
      job = this.safebox
        .keyLists(connectionId)
        .then(async ({ people }) => {
          const judged = new Map(await Promise.all(people.map(async (p) => [p.uid, await this.judge(p.uid, p.lists)] as const)));
          const bad = [...judged].filter(([, d]) => d.status === 'broken').map(([uid, d]) => ({ uid, reason: d.reason ?? 'chain' }) as BrokenPerson);
          this.broken.update((all) => ({ ...all, [connectionId]: bad }));
          return judged;
        })
        .catch((err) => {
          this.cache.delete(connectionId);
          throw err;
        });
      this.cache.set(connectionId, job);
      this.cachedAt.set(connectionId, Date.now());
    }
    return job;
  }

  private pinKey(uid: string): string {
    return `sf-list-pin:${this.auth.user()?.uid ?? ''}:${uid}`;
  }

  /** Looks at the lists of a person again (the warning's "check again", and the first look when a friend's page opens). */
  async check(connectionId: string): Promise<void> {
    this.cache.delete(connectionId);
    await this.people(connectionId).catch(() => undefined);
  }

  /**
   * "Yes, they started over": this device trusts the lists as they are now, as the new beginning (only when the chain itself holds: a broken signature or a
   * list that went away can not be accepted, only explained by the person). Returns true when it was accepted.
   */
  async accept(connectionId: string, uid: string): Promise<boolean> {
    const person = (await this.people(connectionId).catch(() => null))?.get(uid);
    if (person?.reason !== 'pin') return false;
    const { people } = await this.safebox.keyLists(connectionId);
    const lists = people.find((p) => p.uid === uid)?.lists ?? [];
    if (!lists.length || !(await chainHolds(lists))) return false;
    const head = [...lists].sort((a, b) => a.version - b.version).at(-1)!;
    this.writePin(uid, { version: head.version, hash: await deviceListHash(head) });
    dropLinkPin(uid);
    await this.check(connectionId);
    return true;
  }

  private async judge(uid: string, lists: DeviceList[]): Promise<PersonDevices> {
    const pinned = this.readPin(uid);
    if (!lists.length) return pinned || linkPinOf(uid) ? { status: 'broken', devices: [], reason: 'gone' } : { status: 'none', devices: [] }; // a list that was seen can not go away
    if (!(await chainHolds(lists))) return { status: 'broken', devices: [], reason: 'chain' };
    const sorted = [...lists].sort((a, b) => a.version - b.version);
    if (pinned) {
      const at = sorted[pinned.version - 1];
      if (!at || (await deviceListHash(at)) !== pinned.hash) return { status: 'broken', devices: [], reason: 'pin' };
    }
    // the pin of a friend link (the list as it was when the link was made) must be in the chain too; once it has been seen, the ordinary pin takes over
    const fromLink = linkPinOf(uid);
    if (fromLink) {
      const at = sorted[fromLink.version - 1];
      if (!at || !(await deviceListHash(at)).startsWith(fromLink.hash)) return { status: 'broken', devices: [], reason: 'pin' };
      dropLinkPin(uid);
    }
    const head = sorted[sorted.length - 1];
    this.writePin(uid, { version: head.version, hash: await deviceListHash(head) });
    return { status: 'ok', devices: [...sorted].reverse().flatMap((l) => l.devices), current: head.devices, since: sorted[0].since ?? null }; // the date is version 1's
  }

  private readPin(uid: string): { version: number; hash: string } | null {
    try {
      const v = JSON.parse(localStorage.getItem(this.pinKey(uid)) ?? 'null') as { version?: unknown; hash?: unknown } | null;
      return v && Number.isInteger(v.version) && typeof v.hash === 'string' ? { version: v.version as number, hash: v.hash } : null;
    } catch {
      return null;
    }
  }

  private writePin(uid: string, pin: { version: number; hash: string }): void {
    try {
      localStorage.setItem(this.pinKey(uid), JSON.stringify(pin));
    } catch {
      /* no storage: the list is checked every time, but not pinned */
    }
  }
}
