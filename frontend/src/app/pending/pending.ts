import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { ActiveCircleService } from '../core/active-circle.service';
import { AppDatePipe } from '../core/app-date.pipe';
import { Component, computed, inject } from '@angular/core';
import { FriendsService } from '../core/friends.service';
import { NotificationsService } from '../core/notifications.service';
import { FriendRequest } from '../models';
import { PageBar } from '../page-bar/page-bar';

/**
 * Requests that cannot get a seat because all seats are taken.
 * (With a free seat, a request shows as a pending friend on the Friends page instead.)
 */
@Component({
  selector: 'app-pending',
  imports: [PageBar, AppDatePipe, TranslocoDirective],
  templateUrl: './pending.html',
  providers: [provideTranslocoScope('pending')],
})
export class Pending {
  protected readonly w = inject(ActiveCircleService).words;
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
