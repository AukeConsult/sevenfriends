import { Injectable, inject, signal } from '@angular/core';
import { PublishedKey, RecoveryTodoItem, SafeboxWrap } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { rewrapKey } from './box-crypto';
import { myDeviceKey } from './my-key';

/**
 * Recovery from my own other device (design: docs/design/message-encryption.md): this device has a key that opens my messages and files; another key of mine
 * (a new device, a reinstalled app) was added and has no copies yet. After one "Allow" this device gives it its copies, for every friend at once.
 */
@Injectable({ providedIn: 'root' })
export class OwnRecoveryService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  /** the keys waiting to be allowed by this device (empty when this device's key cannot help, or nothing waits) */
  readonly waiting = signal<PublishedKey[]>([]);

  async check(): Promise<void> {
    const mine = await myDeviceKey(this.auth.user()?.uid);
    if (!mine) {
      this.waiting.set([]);
      return;
    }
    try {
      this.waiting.set((await this.api.request<{ eligible: boolean; keys: PublishedKey[] }>(`/own-recovery/pending?me=${mine.keyId}`)).keys);
    } catch {
      this.waiting.set([]); // not now: it is asked again later
    }
  }

  /** How many messages and files are still locked for a key of mine. */
  status(keyId: string): Promise<{ messages: number; files: number }> {
    return this.api.request(`/own-recovery/status?key=${keyId}`);
  }

  /** The person says this device's key opens their old messages and files: it becomes the one that gives the others access. */
  async trustThisDevice(): Promise<void> {
    const mine = await myDeviceKey(this.auth.user()?.uid);
    if (!mine) throw new Error('This device has no key.');
    await this.api.request<unknown>('/own-recovery/trust', { method: 'POST', body: JSON.stringify({ key: mine.keyId }) });
    await this.check();
  }

  /** Gives `target` its copies of every message and file key of mine (100 at a time). Returns how many were done and how many this device could not open. */
  async allow(target: PublishedKey, progress: (done: number) => void): Promise<{ done: number; skipped: number }> {
    const mine = await myDeviceKey(this.auth.user()?.uid);
    if (!mine) throw new Error('This device has no key.');
    const result = { done: 0, skipped: 0 };
    for (const part of ['messages', 'box'] as const) {
      let after: string | null = null;
      do {
        const query = `key=${target.id}&part=${part}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
        const todo: { items: (RecoveryTodoItem & { connectionId?: string })[]; next: string | null } = await this.api.request(`/own-recovery/todo?${query}`);
        const items: { id: string; connectionId?: string; wrap: SafeboxWrap }[] = [];
        for (const item of todo.items) {
          try {
            items.push({ id: item.id, connectionId: item.connectionId, wrap: await rewrapKey({ wraps: item.wraps }, mine.keyId, mine.privateKey, { uid: mine.uid, key: target }, part === 'box' ? 'file' : 'message') });
          } catch {
            result.skipped++;
          }
        }
        if (items.length) {
          const sent = await this.api.request<{ added: number }>('/own-recovery/wraps', { method: 'POST', body: JSON.stringify({ key: target.id, part, items }) });
          result.done += sent.added;
          progress(result.done);
        }
        after = todo.next;
      } while (after);
    }
    // marked allowed only when nothing was left out: a device that could not open some of it must not call the key complete
    if (!result.skipped) await this.api.request<unknown>('/own-recovery/done', { method: 'POST', body: JSON.stringify({ key: target.id }) });
    await this.check();
    return result;
  }
}
