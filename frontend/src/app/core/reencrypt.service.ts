import { Injectable, inject, signal } from '@angular/core';
import { BoxKeys, ReencryptItem, ReencryptTodo, recipientsOf } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { relockObject, relockText } from './box-crypto';
import { myDeviceKey } from './my-key';

/**
 * Locks old things anew after a key of mine was retired (design: docs/design/default-key.md, step 5b). What the retired key could open is opened with this device's key and
 * locked again with a fresh key for the keys in use now, so a lost or leaked old key opens nothing from here on. It is quiet work in small steps; what this device
 * cannot open is skipped (another of my devices may do it) and tried again next time. Files and pictures are not part of this yet.
 */
@Injectable({ providedIn: 'root' })
export class ReencryptService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  /** true while the work runs */
  readonly running = signal(false);
  /** how many items were locked anew since the app was opened */
  readonly done = signal(0);
  /** how many this device could not open on its last run */
  readonly skipped = signal(0);
  private again = false;
  private last = 0;

  /**
   * Does the work (one run at a time; a call during a run makes it go round once more). Never throws: a failure is tried again next time. Without `force` it
   * is quiet for 10 minutes after a run, because reading all the messages for what is stale is not cheap.
   */
  async run(force = false): Promise<void> {
    if (!force && Date.now() - this.last < 10 * 60 * 1000) return;
    this.last = Date.now();
    if (this.running()) {
      this.again = true;
      return;
    }
    this.running.set(true);
    try {
      do {
        this.again = false;
        this.skipped.set(0);
        await this.pass();
      } while (this.again);
    } catch {
      /* the server or the key is not there now: the next run does it */
    } finally {
      this.running.set(false);
    }
  }

  private async pass(): Promise<void> {
    const mine = await myDeviceKey(this.auth.user()?.uid);
    if (!mine) return;
    for (const part of ['messages', 'box'] as const) {
      let after: string | null = null;
      do {
        const todo: ReencryptTodo = await this.api.request(`/reencrypt/todo?part=${part}${after ? `&after=${encodeURIComponent(after)}` : ''}`);
        for (const item of todo.items) {
          try {
            await this.relock(part, item, mine);
            this.done.update((n) => n + 1);
          } catch {
            this.skipped.update((n) => n + 1);
          }
        }
        after = todo.next;
      } while (after);
    }
  }

  private async relock(part: 'messages' | 'box', item: ReencryptItem, mine: { uid: string; keyId: string; privateKey: CryptoKey }): Promise<void> {
    if (!item.connectionId || !item.circleId) throw new Error('No friendship');
    const place = `/circles/${item.circleId}/friends/${item.connectionId}`;
    const keys = await this.api.request<BoxKeys>(`${place}/safebox/keys`);
    if (part === 'messages') {
      const enc = item.enc as unknown as Parameters<typeof relockText>[1];
      const sealed = await relockText(item.connectionId, enc, item.text ?? '', mine.keyId, mine.privateKey, [{ uid: mine.uid, keys: keys.mine }]);
      await this.api.request(`/reencrypt/messages/${item.id}`, { method: 'PUT', body: JSON.stringify({ was: enc.iv, text: sealed.text, enc: sealed.enc }) });
      return;
    }
    const enc = await relockObject(item.connectionId, item.enc as unknown as Parameters<typeof relockObject>[1], mine.keyId, mine.privateKey, recipientsOf(mine.uid, keys));
    await this.api.request(`${place}/safebox/items/${item.id}/reencrypt`, { method: 'PUT', body: JSON.stringify({ revision: item.revision, enc }) });
  }
}
