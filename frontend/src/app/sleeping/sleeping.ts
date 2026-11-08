import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { FriendsService } from '../core/friends.service';
import { countries } from '../core/countries';
import { moodIcon, moodLabel } from '../core/moods';
import { MessagesService } from '../core/messages.service';
import { timeAgo } from '../core/time-ago';
import { Friend, profileColorHex, profileColorInk } from '../models';

const MAX_FRIENDS = 7; // seats (the same number as on the Friends page)

/**
 * The sleep list: friends who have no seat. Their conversation and files are kept.
 * A friend can be woken up (needs a free seat), opened to read the conversation, or deleted for good.
 */
@Component({
  selector: 'app-sleeping',
  imports: [DatePipe, RouterLink, FriendAvatar],
  templateUrl: './sleeping.html',
})
export class Sleeping {
  private readonly friendsService = inject(FriendsService);
  private readonly messagesService = inject(MessagesService);

  /** unread messages per friend (by connection id), as on the friends page: a sleeping friend can still have written */
  protected readonly unread = computed(() => {
    const counts = new Map<string, number>();
    for (const m of this.messagesService.messages()) {
      if (m.connectionId) counts.set(m.connectionId, (counts.get(m.connectionId) ?? 0) + 1);
    }
    return counts;
  });

  protected readonly sleeping = this.friendsService.sleeping;
  /** waking up needs a free seat: fewer than 7 friends in a seat */
  private readonly router = inject(Router);
  protected readonly seatFree = computed(() => this.friendsService.awake().length < MAX_FRIENDS);
  protected readonly max = MAX_FRIENDS;
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** the friend whose "delete for good" question is open */
  protected readonly deleting = signal<string | null>(null);

  /** the friend whose profile is open under the card */
  protected readonly expanded = signal<string | null>(null);
  private readonly countryNames = new Map(countries().map((c) => [c.code, c.name]));
  protected readonly moodIcon = moodIcon;
  protected readonly moodLabel = moodLabel;

  protected toggleProfile(friend: Friend): void {
    this.expanded.update((id) => (id === friend.id ? null : friend.id));
  }

  protected countryName(code: string | null): string {
    return (code && this.countryNames.get(code)) || '';
  }

  constructor() {
    if (!this.friendsService.friends().length) void this.friendsService.load().catch((err: any) => this.error.set(err.message));
  }

  /** The colour of a friend's colour key (as on the friends page), and the text colour that reads on it. */
  protected colorOf(key: string | null): string | null {
    return profileColorHex(key);
  }

  protected inkOf(key: string | null): string | null {
    return profileColorInk(key);
  }

  protected lastSpoken(friend: Friend): string {
    return friend.lastSpokenAt ? `Last spoken to ${timeAgo(friend.lastSpokenAt)}` : '';
  }

  protected async wake(friend: Friend): Promise<void> {
    const woken = await this.run(async () => void (await this.friendsService.sleep(friend.id, false)));
    if (woken) void this.router.navigate(['/friends']); // awake again: straight back to the list, where the friend has a seat
  }

  protected async remove(friend: Friend): Promise<void> {
    await this.run(async () => {
      await this.friendsService.remove(friend.id);
      this.deleting.set(null);
    });
  }

  /** Runs the action; false when it failed (the error is shown). */
  private async run(action: () => Promise<void>): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      return true;
    } catch (err: any) {
      this.error.set(err.message ?? 'Something went wrong');
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
