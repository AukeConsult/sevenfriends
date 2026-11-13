import { Injectable, inject } from '@angular/core';
import { RecoveryState, RecoveryTodo, SafeboxWrap } from '../models';
import { ActiveCircleService } from './active-circle.service';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { rewrapKey } from './box-crypto';
import { FriendsService } from './friends.service';
import { myDeviceKey } from './my-key';
import { SafeboxService } from './safebox.service';
import { tr } from './i18n';

export interface HelpResult {
  /** new copies of keys filed on the server */
  done: number;
  /** messages and files this device could not open (they were locked for a key it does not have) */
  skipped: number;
}

/**
 * Recovery (design: docs/design/message-encryption.md): I have a new key and ask my friend to open the old messages and files again, or my friend asks me.
 * The helper's device opens each message key with its own key and locks it again for the new key; the server only files the new copies.
 */
@Injectable({ providedIn: 'root' })
export class RecoveryService {
  private readonly api = inject(ApiService);
  private readonly active = inject(ActiveCircleService);
  private readonly friends = inject(FriendsService);
  private readonly safebox = inject(SafeboxService);
  private readonly auth = inject(AuthService);

  private base(friendId: string, circleId?: string): string {
    return `/circles/${circleId ?? this.friends.circle()?.id ?? this.active.id}/friends/${friendId}/recovery`;
  }

  /** The friend says no: the asker is told. */
  decline(friendId: string, circleId?: string): Promise<RecoveryState> {
    return this.api.request<RecoveryState>(`${this.base(friendId, circleId)}/decline`, { method: 'POST' });
  }

  /** The asker has seen a declined or finished request: it is deleted (nothing is kept of a finished recovery). */
  async dismiss(friendId: string, circleId?: string): Promise<void> {
    await this.api.request<unknown>(`${this.base(friendId, circleId)}/dismiss`, { method: 'POST' });
  }

  state(friendId: string): Promise<RecoveryState> {
    return this.api.request<RecoveryState>(this.base(friendId));
  }

  /** I ask my friend to help (my newest key is the one to open the messages for). */
  ask(friendId: string): Promise<RecoveryState> {
    return this.api.request<RecoveryState>(this.base(friendId), { method: 'POST' });
  }

  /** I take my request back, or I turn my friend's request down. */
  async cancel(friendId: string): Promise<void> {
    await this.api.request<unknown>(this.base(friendId), { method: 'DELETE' });
  }

  approve(friendId: string): Promise<RecoveryState> {
    return this.api.request<RecoveryState>(`${this.base(friendId)}/approve`, { method: 'POST' });
  }

  /**
   * The helper's work, after approving: every message and file that has no copy for the new key gets one (100 at a time), then the request is finished.
   * `progress` is told how many copies are filed so far. Throws when this device has no key or the request is no longer valid.
   */
  async help(friendId: string, request: RecoveryState, progress: (done: number) => void): Promise<HelpResult> {
    const [mine, keys] = await Promise.all([myDeviceKey(this.auth.user()?.uid), this.safebox.keys(friendId)]);
    if (!mine) throw new Error(tr('core.thisDeviceHasNo2', 'This device has no key, so it cannot open your friend’s messages. Bring your key back in Settings → Privacy lock.'));
    if (!keys.friend.length) throw new Error(tr('core.yourFriendHasNo', 'Your friend has no key in use any more. Ask them to ask again.'));
    const result: HelpResult = { done: 0, skipped: 0 };

    for (const part of ['messages', 'box'] as const) {
      let after: string | null = null;
      do {
        const query = `part=${part}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
        const todo: RecoveryTodo = await this.api.request<RecoveryTodo>(`${this.base(friendId)}/todo?${query}`);
        const items: { id: string; wraps: SafeboxWrap[] }[] = [];
        for (const item of todo.items) {
          try {
            // one copy for every key of my friend that has none yet: the new key, and any other device they use
            const targets = keys.friend.filter((k) => item.missing.includes(k.id));
            const wraps: SafeboxWrap[] = [];
            for (const key of targets) wraps.push(await rewrapKey({ wraps: item.wraps }, mine.keyId, mine.privateKey, { uid: keys.friendUid, key }, part === 'box' ? 'file' : 'message'));
            if (wraps.length) items.push({ id: item.id, wraps });
          } catch {
            result.skipped++;
          }
        }
        if (items.length) {
          const sent = await this.api.request<{ added: number }>(`${this.base(friendId)}/wraps`, { method: 'POST', body: JSON.stringify({ part, items }) });
          result.done += sent.added;
          progress(result.done);
        }
        after = todo.next;
      } while (after);
    }
    // nothing could be opened here (every copy is locked for a key this device does not have): that is not "done", and the asker is not told it is
    if (result.done === 0 && result.skipped > 0) throw new Error(tr('friendRecovery.nothingCouldBeOpened', 'Nothing could be opened: this device has no key for these old messages, so it cannot help. Bring your own key back first (Settings → Privacy lock: another device of yours, or your 24 words).'));
    await this.api.request<RecoveryState>(`${this.base(friendId)}/finish`, { method: 'POST' });
    return result;
  }
}
