import { Injectable, inject, signal } from '@angular/core';
import { OwnRecoveryRequest, OwnRecoveryTodo, PublishedKey, SafeboxWrap } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { rewrapKey } from './box-crypto';
import { DeviceListService } from './device-list.service';
import { myDeviceKey } from './my-key';
import { tr } from './i18n';

/**
 * Recovery from my own other device (design: docs/design/message-encryption.md): this device has a key that opens my messages and files; another key of mine
 * (a new device, a reinstalled app) was added and has no copies yet. After one "Allow" this device gives it its copies, for every friend at once.
 */
@Injectable({ providedIn: 'root' })
export class OwnRecoveryService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly deviceList = inject(DeviceListService);

  /** the keys waiting to be allowed by this device (empty when this device's key cannot help, or nothing waits) */
  readonly waiting = signal<PublishedKey[]>([]);

  /** the requests of my other devices that this device may allow (the keys above, with their label, counts and progress) */
  readonly requests = signal<OwnRecoveryRequest[]>([]);
  /** the request of THIS device (made by itself, or by the person), null = none */
  readonly mine = signal<OwnRecoveryRequest | null>(null);

  /** the keys this device made itself: ANOTHER device has to approve them, never this one (a replaced key is published while the old key is still this device's key, so the server cannot tell) */
  private readonly madeHere = new Set<string>();

  madeKey(keyId: string): void {
    this.madeHere.add(keyId);
    this.waiting.update((list) => list.filter((k) => k.id !== keyId));
    this.requests.update((list) => list.filter((r) => r.keyId !== keyId));
  }

  async check(): Promise<void> {
    const mine = await myDeviceKey(this.auth.user()?.uid);
    if (!mine) {
      this.waiting.set([]);
      this.requests.set([]);
      return;
    }
    try {
      const found = await this.api.request<{ eligible: boolean; keys: PublishedKey[]; requests: OwnRecoveryRequest[] }>(`/own-recovery/pending?me=${mine.keyId}`);
      this.waiting.set(found.keys.filter((k) => !this.madeHere.has(k.id)));
      this.requests.set(found.requests.filter((r) => !this.madeHere.has(r.keyId)));
    } catch {
      this.waiting.set([]); // not now: it is asked again later
      this.requests.set([]);
    }
  }

  /** The request of this device: its state and progress (the asking device shows them). */
  async refreshMine(): Promise<void> {
    const mine = await myDeviceKey(this.auth.user()?.uid);
    if (!mine) {
      this.mine.set(null);
      return;
    }
    try {
      this.mine.set((await this.api.request<{ request: OwnRecoveryRequest | null }>(`/own-recovery/request?key=${mine.keyId}`)).request);
    } catch {
      /* the last state stays: it is read again soon */
    }
  }

  /** This device asks my other devices to open my old messages for it, at any time (a new request replaces the old one). Throws with the reason when nobody can help. */
  async ask(): Promise<void> {
    const mine = await myDeviceKey(this.auth.user()?.uid);
    if (!mine) throw new Error(tr('core.thisDeviceHasNo', 'This device has no key.'));
    this.mine.set((await this.api.request<{ request: OwnRecoveryRequest }>('/own-recovery/ask', { method: 'POST', body: JSON.stringify({ key: mine.keyId }) })).request);
  }

  /** The asking device has shown that the request was declined or finished: it is deleted (nothing is kept). */
  async dismissMine(): Promise<void> {
    const mine = await myDeviceKey(this.auth.user()?.uid);
    if (!mine) return;
    await this.api.request<unknown>('/own-recovery/dismiss', { method: 'POST', body: JSON.stringify({ key: mine.keyId }) });
    this.mine.set(null);
  }

  /** "Not me": the key that asked is removed at once. */
  async notMe(target: PublishedKey): Promise<void> {
    const mine = await myDeviceKey(this.auth.user()?.uid);
    if (!mine) throw new Error(tr('core.thisDeviceHasNo', 'This device has no key.'));
    await this.deviceList.publishNext({ removeId: target.id }); // in case it was in the list
    await this.api.request<unknown>('/own-recovery/decline', { method: 'POST', body: JSON.stringify({ key: target.id, me: mine.keyId }) });
    await this.check();
  }

  /** How many messages and files are still locked for a key of mine. */
  status(keyId: string): Promise<{ messages: number; files: number }> {
    return this.api.request(`/own-recovery/status?key=${keyId}`);
  }

  /** The person says this device's key opens their old messages and files: it becomes the one that gives the others access. */
  async trustThisDevice(): Promise<void> {
    const mine = await myDeviceKey(this.auth.user()?.uid);
    if (!mine) throw new Error(tr('core.thisDeviceHasNo', 'This device has no key.'));
    await this.api.request<unknown>('/own-recovery/trust', { method: 'POST', body: JSON.stringify({ key: mine.keyId }) });
    await this.check();
  }

  /** Gives `target` its copies of every message and file key of mine (100 at a time). Returns how many were done and how many this device could not open. */
  async allow(target: PublishedKey, progress: (done: number) => void, as?: { uid: string; keyId: string; privateKey: CryptoKey }): Promise<{ done: number; skipped: number; listed: boolean }> {
    // `as`: a rotation on this device hands over from the OLD key, which is still in memory while the new one is not yet the key of this device (it also makes the list itself)
    const mine = as ?? (await myDeviceKey(this.auth.user()?.uid));
    if (!mine) throw new Error(tr('core.thisDeviceHasNo', 'This device has no key.'));
    const listed = as ? true : await this.deviceList.publishNext({ add: target }); // the person allowed it: it joins the signed list, so friends accept what it writes and lock new messages for it (false: this device can not sign the list)
    await this.api.request<unknown>('/own-recovery/start', { method: 'POST', body: JSON.stringify({ key: target.id, me: mine.keyId }) }); // the asking device sees that the work has begun
    const result = { done: 0, skipped: 0, listed };
    // A pass lists what still lacks a copy for an allowed key (the one being allowed, the keys allowed before, the keys in my signed list) and locks each key again for
    // those keys; the content is never touched. A new pass looks again, so a key allowed meanwhile is covered; the last pass (it did nothing) tells what could not be opened.
    for (let pass = 0; pass < 5; pass++) {
      let passDone = 0;
      let passSkipped = 0;
      for (const part of ['messages', 'box'] as const) {
        let after: string | null = null;
        do {
          const query = `key=${target.id}&part=${part}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
          const todo: OwnRecoveryTodo = await this.api.request(`/own-recovery/todo?${query}`);
          const items: { id: string; connectionId?: string; wraps: SafeboxWrap[] }[] = [];
          for (const item of todo.items) {
            try {
              const wraps: SafeboxWrap[] = [];
              for (const key of todo.keys.filter((k) => item.missing.includes(k.id))) wraps.push(await rewrapKey({ wraps: item.wraps }, mine.keyId, mine.privateKey, { uid: mine.uid, key }, part === 'box' ? 'file' : 'message'));
              if (wraps.length) items.push({ id: item.id, connectionId: item.connectionId, wraps });
              else passSkipped++;
            } catch {
              passSkipped++;
            }
          }
          if (items.length) {
            const sent = await this.api.request<{ added: number }>('/own-recovery/wraps', { method: 'POST', body: JSON.stringify({ key: target.id, part, items }) });
            passDone += sent.added;
            result.done += sent.added;
            progress(result.done);
          }
          after = todo.next;
        } while (after);
      }
      result.skipped = passSkipped;
      if (!passDone) break;
    }
    // the server marks the key allowed only when nothing lacks a copy for it; when something does (this device could not open it) it keeps the number for the asking device
    try {
      await this.api.request<unknown>('/own-recovery/done', { method: 'POST', body: JSON.stringify({ key: target.id }) });
    } catch (err) {
      if (!result.skipped) throw err;
    }
    await this.check();
    return result;
  }
}
