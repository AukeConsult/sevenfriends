import { Injectable, inject } from '@angular/core';
import { BoxKeys, GroupHistoryTodo, SafeboxWrap, recipientsOf } from '../models';
import { ActiveCircleService } from './active-circle.service';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { rewrapKey } from './box-crypto';
import { FriendsService } from './friends.service';
import { myDeviceKey } from './my-key';
import { SafeboxService } from './safebox.service';

/**
 * The history of the messages of a group (design: docs/design/groups.md, "History of the messages"; fixed rule: docs/design/recovery-rules.md, section 8).
 * Every member has the whole conversation, also what was written before they joined. A member who joined later has no copy of the older messages: this device gives
 * them theirs. A text that is not locked is copied by the server; a locked one is opened here with this device's key and locked again for the keys of the member that
 * lacks a copy (the content is never touched, only the copies of the message key are new). Quiet and safe to repeat; one member's device is enough.
 */
@Injectable({ providedIn: 'root' })
export class GroupHistoryService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly active = inject(ActiveCircleService);
  private readonly friends = inject(FriendsService);
  private readonly safebox = inject(SafeboxService);

  /** when each group was last looked through (the whole conversation is read each time, so it is not done more than every 10 minutes unless a member was just added) */
  private readonly last = new Map<string, number>();
  private readonly running = new Set<string>();

  private base(groupId: string): string {
    return `/circles/${this.friends.circle()?.id ?? this.active.id}/friends/${groupId}/history`;
  }

  /** Gives every member the messages they lack. Returns how many copies were made (0 when this device has no key or nothing was missing). Never throws. */
  async share(groupId: string, keys: BoxKeys, force = false): Promise<number> {
    if (this.running.has(groupId) || (!force && Date.now() - (this.last.get(groupId) ?? 0) < 10 * 60 * 1000)) return 0;
    this.running.add(groupId);
    this.last.set(groupId, Date.now());
    let total = 0;
    try {
      const mine = await myDeviceKey(this.auth.user()?.uid);
      if (!mine) return 0; // a device with no key can neither open a locked message nor sign a copy: it still does nothing for plain texts, another device does
      const trusted = await this.safebox.lockKeys(groupId, keys); // only the keys in the signed device lists, as for a new message
      const targets = new Map(recipientsOf(mine.uid, trusted).flatMap((p) => p.keys.map((k) => [`${p.uid}/${k.id}`, { uid: p.uid, key: k }] as const)));
      let after: string | null = null;
      do {
        const todo: GroupHistoryTodo = await this.api.request<GroupHistoryTodo>(`${this.base(groupId)}/todo${after ? `?after=${encodeURIComponent(after)}` : ''}`);
        const items: { id: string; plain?: string[]; wraps?: SafeboxWrap[] }[] = [];
        for (const item of todo.items) {
          if (item.plain.length) {
            items.push({ id: item.id, plain: item.plain });
            continue;
          }
          const wraps: SafeboxWrap[] = [];
          for (const m of item.missing) {
            const target = targets.get(`${m.uid}/${m.keyId}`);
            if (!target) continue; // a key that is not in the signed list (yet): left for later
            try {
              wraps.push(await rewrapKey({ wraps: item.wraps }, mine.keyId, mine.privateKey, target, 'message'));
            } catch {
              break; // this device cannot open this message (it was locked for another device of mine): another device may
            }
          }
          if (wraps.length) items.push({ id: item.id, wraps });
        }
        if (items.length) total += (await this.api.request<{ copied: number }>(`${this.base(groupId)}/`, { method: 'POST', body: JSON.stringify({ items }) })).copied;
        after = todo.next;
      } while (after);
    } catch (err) {
      console.warn('The messages of the group could not be shared with its members', err);
    } finally {
      this.running.delete(groupId);
    }
    return total;
  }
}
