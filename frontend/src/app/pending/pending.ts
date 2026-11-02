import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FriendsService } from '../core/friends.service';
import { NotificationsService } from '../core/notifications.service';
import { FriendRequest } from '../models';

/**
 * Requests that cannot get a seat because all seats are taken.
 * (With a free seat, a request shows as a pending friend on the Friends page instead.)
 */
@Component({
  selector: 'app-pending',
  imports: [DatePipe, RouterLink],
  templateUrl: './pending.html',
  styleUrl: './pending.scss',
})
export class Pending {
  private readonly notifications = inject(NotificationsService);
  private readonly friendsService = inject(FriendsService);

  protected readonly waiting = computed(() => this.friendsService.requests().filter((r) => !r.seated));
  protected readonly loaded = this.notifications.loaded;
  protected readonly error = this.notifications.error;

  constructor() {
    this.load();
  }

  protected load(): Promise<void> {
    return this.notifications.refresh();
  }

  protected async reject(request: FriendRequest): Promise<void> {
    try {
      await this.friendsService.rejectRequest(request.id);
    } catch (err: any) {
      this.error.set(err.message);
    }
  }
}
