import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { ReturnTo } from '../core/return-to';
import { tr } from '../core/i18n';
import { NgTemplateOutlet } from '@angular/common';
import { ActiveCircleService } from '../core/active-circle.service';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { FriendsService } from '../core/friends.service';
import { MessagesService } from '../core/messages.service';
import { timeAgo } from '../core/time-ago';
import { Friend, profileColorHex } from '../models';

const MAX_FRIENDS = 7; // seats (the same number as on the Friends page)

/**
 * The sleep list: friends who have no seat. Their conversation and files are kept.
 * A friend can be woken up (needs a free seat), opened to read the conversation, or deleted for good.
 */
@Component({
  selector: 'app-sleeping',
  imports: [NgTemplateOutlet, RouterLink, FriendAvatar, TranslocoDirective],
  templateUrl: './sleeping.html',
  providers: [provideTranslocoScope('sleeping')],
})
export class Sleeping {
  protected readonly w = inject(ActiveCircleService).words;
  private readonly friendsService = inject(FriendsService);
  /** shown inside Home (under its top, in place of everything else) instead of as a page of its own: the back arrow then closes it */
  readonly embedded = input(false);
  readonly closed = output<void>();
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
  private readonly returnTo = inject(ReturnTo);
  protected readonly max = MAX_FRIENDS;

  /** a friend is opened from the list (embedded in Home): its back arrow leads back here */
  protected opened(): void {
    if (this.embedded()) this.returnTo.fromSleepList();
  }
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** the friend whose "delete for good" question is open */
  protected readonly deleting = signal<string | null>(null);

  /** friends in a seat */
  protected readonly taken = computed(() => this.friendsService.awake().length);

  /** how the sleepers are shown: small circles (tap one to see its card) or a list of cards; remembered on this device */
  protected readonly view = signal<'circles' | 'list'>(localStorage.getItem('sf-sleep-view') === 'list' ? 'list' : 'circles');
  /** the sleeper whose card is open (circles view) */
  protected readonly expanded = signal<string | null>(null);
  protected readonly selected = computed(() => this.sleeping().find((f) => f.id === this.expanded()) ?? null);

  protected setView(view: 'circles' | 'list'): void {
    this.view.set(view);
    this.deleting.set(null);
    try {
      localStorage.setItem('sf-sleep-view', view);
    } catch {
      /* not saved: the choice holds until the page is closed */
    }
  }

  protected toggleProfile(friend: Friend): void {
    this.deleting.set(null);
    this.expanded.update((id) => (id === friend.id ? null : friend.id));
  }

  constructor() {
    if (!this.friendsService.friends().length) void this.friendsService.load().catch((err: any) => this.error.set(err.message));
  }

  /** The colour of a friend's colour key (as on the friends page), and the text colour that reads on it. */
  protected colorOf(key: string | null): string | null {
    return profileColorHex(key);
  }

  protected lastSpoken(friend: Friend): string {
    return friend.lastSpokenAt ? tr('sleeping.lastSpoken', 'Last spoken to {{ when }}', { when: timeAgo(friend.lastSpokenAt) }) : '';
  }

  protected async wake(friend: Friend): Promise<void> {
    const woken = await this.run(async () => void (await this.friendsService.sleep(friend.id, false)));
    if (!woken) return;
    if (this.embedded()) this.closed.emit(); // awake again: back to Home, where the friend has a seat
    else void this.router.navigate(['/']);
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
      this.error.set(err.message ?? tr('sleeping.somethingWentWrong', 'Something went wrong'));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
