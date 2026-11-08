import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiError, ApiService } from './api.service';
import { AcceptResult, Circle, Friend, FriendRequest, NewFriend } from '../models';
import { UiPreferencesService } from './ui-preferences';

@Injectable({ providedIn: 'root' })
export class FriendsService {
  private readonly api = inject(ApiService);
  private readonly prefs = inject(UiPreferencesService);

  readonly circle = signal<Circle | null>(null);
  readonly friends = signal<Friend[]>([]);
  /** the friends in a seat (all but the sleep list) */
  readonly awake = computed(() => this.friends().filter((f) => !f.asleep));
  /** the sleep list */
  readonly sleeping = computed(() => this.friends().filter((f) => f.asleep));
  readonly requests = signal<FriendRequest[]>([]);

  /** Loads the user's circle (the first one, i.e. the default) and its friends. */
  async load(): Promise<void> {
    const { circles } = await this.api.request<{ circles: Circle[] }>('/circles');
    const circle = circles[0] ?? null;
    this.circle.set(circle);
    if (!circle) {
      this.friends.set([]);
      return;
    }
    const res = await this.api.request<{ friends: Friend[] }>(`/circles/${circle.id}/friends`);
    this.friends.set(res.friends);
    this.forgetOldFriends(res.friends);
  }

  /** The ready-made messages kept on this device for a friend who is not in the list any more (removed, or the account was reset) are deleted with the friend. */
  private forgetOldFriends(friends: Friend[]): void {
    const kept = this.prefs.get('friendQuick');
    const ids = new Set(friends.map((f) => f.id));
    const left = Object.fromEntries(Object.entries(kept).filter(([id]) => ids.has(id)));
    if (Object.keys(left).length !== Object.keys(kept).length) this.prefs.set('friendQuick', left);
  }

  /**
   * Confirm a request: the requester becomes my friend too.
   * Returns 'no-seats' when my circle is full: the request then stays pending.
   */
  async acceptRequest(id: string): Promise<AcceptResult> {
    const res = await this.api.request<{ ok: boolean; result: AcceptResult }>(
      `/friend-requests/${id}/accept`,
      { method: 'POST' },
    );
    if (res.result === 'confirmed') {
      this.requests.update((list) => list.filter((r) => r.id !== id));
    }
    return res.result;
  }

  /** Reject a request: the requester sees it as rejected and can delete it. */
  async rejectRequest(id: string): Promise<void> {
    await this.api.request<void>(`/friend-requests/${id}/reject`, { method: 'POST' });
    this.requests.update((list) => list.filter((r) => r.id !== id));
  }

  async add(friend: NewFriend): Promise<Friend> {
    if (!this.circle()) await this.load(); // the first load may have failed: try again
    if (!this.circle()) throw new ApiError('Could not load your circle. Is the backend running?', 503);
    const created = await this.api.request<Friend>(`${this.friendsPath()}`, {
      method: 'POST',
      body: JSON.stringify(friend),
    });
    this.friends.update((list) => [...list, created]);
    return created;
  }

  /** "This is really them": hides the unverified warning of a friend. */
  async trust(id: string): Promise<Friend> {
    const saved = await this.api.request<Friend>(`${this.friendsPath()}/${id}/trust`, { method: 'POST', body: JSON.stringify({ trusted: true }) });
    this.friends.update((list) => list.map((f) => (f.id === id ? saved : f)));
    return saved;
  }

  /** Move a friend to another seat: a free seat is taken, a seat that is taken is swapped (shown at once; put back if the server refuses). */
  async moveToSeat(id: string, seat: number): Promise<void> {
    const before = this.friends();
    const moving = before.find((f) => f.id === id);
    if (!moving || moving.asleep || moving.seat === seat) return;
    const from = moving.seat;
    this.friends.set(before.map((f) => (f.id === id ? { ...f, seat } : !f.asleep && f.seat === seat ? { ...f, seat: from } : f)));
    try {
      await this.api.request(`${this.friendsPath()}/${id}/seat`, { method: 'POST', body: JSON.stringify({ seat }) });
    } catch (err) {
      this.friends.set(before);
      throw err;
    }
  }

  /** Put a friend on the sleep list (no seat, conversation kept) or wake them up (needs a free seat). */
  async sleep(id: string, asleep: boolean): Promise<Friend> {
    const saved = await this.api.request<Friend>(`${this.friendsPath()}/${id}/sleep`, { method: 'POST', body: JSON.stringify({ asleep }) });
    this.friends.update((list) => list.map((f) => (f.id === id ? saved : f)));
    return saved;
  }

  async remove(id: string): Promise<void> {
    await this.api.request<void>(`${this.friendsPath()}/${id}`, { method: 'DELETE' });
    this.friends.update((list) => list.filter((f) => f.id !== id));
  }

  private friendsPath(): string {
    const circle = this.circle();
    if (!circle) throw new ApiError('No circle loaded', 400);
    return `/circles/${circle.id}/friends`;
  }
}
