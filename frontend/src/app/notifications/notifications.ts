import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FriendsService } from '../core/friends.service';
import { MessagesService } from '../core/messages.service';
import { NotificationsService } from '../core/notifications.service';
import { FriendRequest, Message, Notice } from '../models';

/** Home page: a quiet overview of what needs attention (friend requests, incoming messages). */
@Component({
  selector: 'app-notifications',
  imports: [DatePipe, RouterLink],
  templateUrl: './notifications.html',
  styleUrl: './notifications.scss',
})
export class Notifications {
  private readonly notifications = inject(NotificationsService);
  private readonly friendsService = inject(FriendsService);
  private readonly messagesService = inject(MessagesService);

  protected readonly requests = this.friendsService.requests;
  protected readonly messages = this.messagesService.messages;

  /** Requests that already have a pending seat in my circle: confirm or reject them here. */
  protected readonly seated = computed(() => this.requests().filter((r) => r.seated));
  /** Requests waiting for a free seat: only listed on the Pending page. */
  protected readonly waitingCount = computed(() => this.requests().filter((r) => !r.seated).length);

  /** Result of the last Confirm, shown above the lists. */
  protected readonly notice = signal<Notice | null>(null);

  protected readonly loaded = this.notifications.loaded;
  protected readonly error = this.notifications.error;
  protected readonly allQuiet = computed(
    () => this.loaded() && !this.error() && !this.requests().length && !this.messages().length,
  );

  constructor() {
    this.load();
  }

  protected load(): Promise<void> {
    return this.notifications.refresh();
  }

  protected async accept(request: FriendRequest): Promise<void> {
    this.notice.set(null);
    try {
      const result = await this.friendsService.acceptRequest(request.id);
      this.notice.set(
        result === 'confirmed'
          ? { kind: 'success', text: `${request.fromName} is now your friend.` }
          : {
              kind: 'warning',
              text: `You have no free seats. The request from ${request.fromName} stays pending: remove a friend to make room, then confirm.`,
            },
      );
    } catch (err: any) {
      this.error.set(err.message);
    }
  }

  protected async reject(request: FriendRequest): Promise<void> {
    this.notice.set(null);
    try {
      await this.friendsService.rejectRequest(request.id);
      this.notice.set({ kind: 'warning', text: `You rejected the request from ${request.fromName}. They can see that it was rejected.` });
    } catch (err: any) {
      this.error.set(err.message);
    }
  }

  protected async markRead(message: Message): Promise<void> {
    try {
      await this.messagesService.markRead(message.id);
    } catch (err: any) {
      this.error.set(err.message);
    }
  }
}
