import { Injectable, inject, signal } from '@angular/core';
import { ApiError, ApiService } from './api.service';
import { Socials } from './social';

export interface Friend extends Socials {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** pending until the other party confirms; rejected when they rejected the request */
  status: 'pending' | 'confirmed' | 'rejected';
  /** true when the friend has an account and has been sent a request */
  invited: boolean;
  /** true when their list is full and I am on their waiting list */
  waiting: boolean;
  /** true when THEY invited ME: this seat can be confirmed by me */
  incoming: boolean;
  requestId: string | null;
  createdAt: string | null;
}

export interface FriendRequest {
  id: string;
  fromName: string;
  fromEmail: string | null;
  createdAt: string | null;
  /** true = shown as a pending seat in my circle; false = waiting for a free seat */
  seated: boolean;
}

export type CircleType = 'friends' | 'family' | 'colleagues';

export interface Circle {
  id: string;
  name: string;
  type: CircleType;
  createdAt: string | null;
}

export type NewFriend = Pick<Friend, 'name' | 'email' | 'phone'> & Socials;

@Injectable({ providedIn: 'root' })
export class FriendsService {
  private readonly api = inject(ApiService);

  readonly circle = signal<Circle | null>(null);
  readonly friends = signal<Friend[]>([]);
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
  }

  /** Requests from people who added me and wait for my confirmation. */
  async loadRequests(): Promise<void> {
    const res = await this.api.request<{ requests: FriendRequest[] }>('/friend-requests');
    this.requests.set(res.requests);
  }

  /**
   * Confirm a request: the requester becomes my friend too.
   * Returns 'no-seats' when my circle is full: the request then stays pending.
   */
  async acceptRequest(id: string): Promise<'confirmed' | 'no-seats'> {
    const res = await this.api.request<{ ok: boolean; result: 'confirmed' | 'no-seats' }>(
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

  async add(friend: NewFriend): Promise<void> {
    if (!this.circle()) await this.load(); // the first load may have failed: try again
    if (!this.circle()) throw new ApiError('Could not load your circle. Is the backend running?', 503);
    const created = await this.api.request<Friend>(`${this.friendsPath()}`, {
      method: 'POST',
      body: JSON.stringify(friend),
    });
    this.friends.update((list) => [...list, created]);
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
