import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FriendsService } from '../core/friends.service';
import { MessagesService } from '../core/messages.service';
import { countries } from '../core/countries';
import { moodIcon, moodLabel } from '../core/moods';
import { presenceLabel } from '../core/presence';
import { timeAgo } from '../core/time-ago';
import { NotificationsService } from '../core/notifications.service';
import { SOCIAL_NETWORKS } from '../core/social';
import { Friend, FriendSlot } from '../models';

const MAX_FRIENDS = 7;

@Component({
  selector: 'app-friends',
  imports: [DatePipe, RouterLink],
  templateUrl: './friends.html',
})
export class Friends {
  private readonly friendsService = inject(FriendsService);
  private readonly notifications = inject(NotificationsService);
  private readonly messagesService = inject(MessagesService);
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

  /** How many unread messages each friend has sent me (by connection id): marks the card. Kept live by the realtime service. */
  protected readonly unread = computed(() => {
    const counts = new Map<string, number>();
    for (const m of this.messagesService.messages()) {
      if (m.connectionId) counts.set(m.connectionId, (counts.get(m.connectionId) ?? 0) + 1);
    }
    return counts;
  });

  /** which friend's profile is open under the card (one at a time); closed = just the card */
  protected readonly expanded = signal<string | null>(null);
  /** "now", refreshed every minute, so "5 minutes ago" keeps counting */
  private readonly now = signal(Date.now());
  private readonly countryNames = new Map(countries().map((c) => [c.code, c.name]));

  protected readonly presenceLabel = presenceLabel;

  protected toggleProfile(friend: Friend): void {
    this.expanded.update((id) => (id === friend.id ? null : friend.id));
    this.deleting.set(null); // a delete question is part of the profile: it closes with it
  }

  /** "Last spoken to 3 days ago", or that you have not spoken yet. */
  protected lastSpoken(friend: Friend): string {
    return friend.lastSpokenAt ? `Last spoken to ${timeAgo(friend.lastSpokenAt, this.now())}` : 'You have not spoken yet';
  }

  protected countryName(code: string | null): string {
    return (code && this.countryNames.get(code)) || '';
  }

  protected readonly moodIcon = moodIcon;
  protected readonly moodLabel = moodLabel;

  protected readonly loadError = signal<string | null>(null);

  constructor() {
    const tick = setInterval(() => this.now.set(Date.now()), 60000);
    inject(DestroyRef).onDestroy(() => clearInterval(tick));
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
