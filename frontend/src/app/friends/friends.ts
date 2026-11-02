import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FriendsService } from '../core/friends.service';
import { NotificationsService } from '../core/notifications.service';
import { SOCIAL_NETWORKS } from '../core/social';
import { Friend, FriendSlot } from '../models';

const MAX_FRIENDS = 7;

@Component({
  selector: 'app-friends',
  imports: [RouterLink],
  templateUrl: './friends.html',
  styleUrl: './friends.scss',
})
export class Friends {
  private readonly friendsService = inject(FriendsService);
  private readonly notifications = inject(NotificationsService);
  private readonly router = inject(Router);

  protected readonly circle = this.friendsService.circle;
  protected readonly max = MAX_FRIENDS;
  protected readonly networks = SOCIAL_NETWORKS;
  /** incoming requests that wait for a free seat (shown on the Pending page) */
  protected readonly waiting = computed(() => this.friendsService.requests().filter((r) => !r.seated).length);
  protected readonly filled = computed(() => this.friendsService.friends().length);
  protected readonly slots = computed<FriendSlot[]>(() =>
    Array.from({ length: MAX_FRIENDS }, (_, i) => ({
      position: i + 1,
      friend: this.friendsService.friends()[i] ?? null,
    })),
  );

  protected readonly loadError = signal<string | null>(null);

  constructor() {
    this.reload();
  }

  protected async reload(): Promise<void> {
    this.loadError.set(null);
    await this.notifications.refresh(); // invited? a request gets a free seat as a pending friend
    try {
      await this.friendsService.load();
    } catch (err: any) {
      this.loadError.set(err.message);
    }
  }

  /** Clicking a confirmed contact opens the message feed (buttons and links inside the card do their own thing). */
  protected open(friend: Friend, event: Event): void {
    if (friend.status !== 'confirmed') return;
    if ((event.target as HTMLElement).closest('button, a')) return;
    this.router.navigate(['/friends', friend.id]);
  }

  /** Which friend's delete confirmation is open under its card (one at a time). */
  protected readonly deleting = signal<string | null>(null);
  protected readonly deleteBusy = signal(false);

  protected askDelete(friend: Friend): void {
    this.deleting.update((id) => (id === friend.id ? null : friend.id));
  }

  protected cancelDelete(): void {
    this.deleting.set(null);
  }

  protected deleteMessage(friend: Friend): string {
    return friend.invited || friend.incoming
      ? `Delete ${friend.name}? This removes the connection from your list and from theirs.`
      : `Remove ${friend.name} from your circle?`;
  }

  protected async remove(friend: Friend): Promise<void> {
    this.deleteBusy.set(true);
    try {
      await this.friendsService.remove(friend.id);
      this.deleting.set(null);
      await this.reload(); // a freed seat is given to the next waiting request
    } catch (err: any) {
      this.loadError.set(err.message);
    } finally {
      this.deleteBusy.set(false);
    }
  }

  /** Reject a friend who invited me: they will see the request as rejected. */
  protected async reject(friend: Friend): Promise<void> {
    if (!friend.requestId) return;
    try {
      await this.friendsService.rejectRequest(friend.requestId);
      await this.friendsService.load();
    } catch (err: any) {
      this.loadError.set(err.message);
    }
  }

  /** Confirm a friend who invited me (a pending seat). */
  protected async confirm(friend: Friend): Promise<void> {
    if (!friend.requestId) return;
    try {
      await this.friendsService.acceptRequest(friend.requestId);
      await this.friendsService.load();
    } catch (err: any) {
      this.loadError.set(err.message);
    }
  }
}
