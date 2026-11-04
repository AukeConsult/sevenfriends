import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { FriendsService } from '../core/friends.service';
import { Friend } from '../models';

const MAX_FRIENDS = 7; // seats (the same number as on the Friends page)

/**
 * The sleep list: friends who have no seat. Their conversation and files are kept.
 * A friend can be woken up (needs a free seat), opened to read the conversation, or deleted for good.
 */
@Component({
  selector: 'app-sleeping',
  imports: [RouterLink, FriendAvatar],
  templateUrl: './sleeping.html',
})
export class Sleeping {
  private readonly friendsService = inject(FriendsService);

  protected readonly sleeping = this.friendsService.sleeping;
  /** waking up needs a free seat: fewer than 7 friends in a seat */
  protected readonly seatFree = computed(() => this.friendsService.awake().length < MAX_FRIENDS);
  protected readonly max = MAX_FRIENDS;
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** the friend whose "delete for good" question is open */
  protected readonly deleting = signal<string | null>(null);

  constructor() {
    if (!this.friendsService.friends().length) void this.friendsService.load().catch((err: any) => this.error.set(err.message));
  }

  protected async wake(friend: Friend): Promise<void> {
    await this.run(async () => void (await this.friendsService.sleep(friend.id, false)));
  }

  protected async remove(friend: Friend): Promise<void> {
    await this.run(async () => {
      await this.friendsService.remove(friend.id);
      this.deleting.set(null);
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (err: any) {
      this.error.set(err.message ?? 'Something went wrong');
    } finally {
      this.busy.set(false);
    }
  }
}
