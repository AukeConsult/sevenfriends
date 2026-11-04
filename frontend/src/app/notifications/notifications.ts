import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { MoodEditor } from '../mood-editor/mood-editor';
import { AuthService } from '../core/auth.service';
import { FriendsService } from '../core/friends.service';
import { InviteLinkService } from '../core/invite-link.service';
import { MessagesService } from '../core/messages.service';
import { NotificationsService } from '../core/notifications.service';
import { InstallService } from '../core/install.service';
import { SeatDots } from '../seat-dots/seat-dots';
import { FriendRequest, Message, Notice, ProfileDetails } from '../models';

/** Home page: a quiet overview of what needs attention (friend requests, incoming messages). */
@Component({
  selector: 'app-notifications',
  imports: [DatePipe, RouterLink, MoodEditor, SeatDots],
  templateUrl: './notifications.html',
})
export class Notifications {
  private readonly notifications = inject(NotificationsService);
  private readonly friendsService = inject(FriendsService);
  private readonly messagesService = inject(MessagesService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly install = inject(InstallService);
  protected readonly invite = inject(InviteLinkService);

  private readonly user = inject(AuthService).user;

  /** the link to hand out: whoever opens it, signs in and confirms sends ME a friend request (my email, or my phone number without an email) */
  protected readonly friendLink = computed(() => {
    const me = this.user();
    const contact = me?.email ?? me?.phoneNumber;
    return contact ? `${location.origin}/?friend=${encodeURIComponent(contact)}` : null;
  });

  /**
   * My own details, when none of them is verified. I still receive requests, but my friends are told that I have
   * not verified, so I am told here too (with a way to fix it).
   */
  protected readonly unverified = signal<('email' | 'phone')[]>([]);

  /** the seats taken: my friends who are not on the sleep list (the same count the Friends page uses) */
  protected readonly seatsTaken = computed(() => Math.min(7, this.friendsService.awake().length));

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
    void this.checkOwnDetails();
    if (!this.friendsService.circle()) void this.friendsService.load().catch(() => undefined); // opened directly: the seats come from the list
  }

  private async checkOwnDetails(): Promise<void> {
    try {
      const profile = await this.api.request<ProfileDetails>('/profile');
      const missing: ('email' | 'phone')[] = [];
      // one verified detail is enough to prove who I am: the warning only shows when nothing is verified
      if (!profile.emailVerified && !profile.phoneVerified) {
        if (this.user()?.email) missing.push('email');
        if (profile.phone) missing.push('phone');
      }
      this.unverified.set(missing);
    } catch {
      /* the banner is a help, not a requirement: the page works without it */
    }
  }

  protected load(): Promise<void> {
    return this.notifications.refresh();
  }

  protected async accept(request: FriendRequest): Promise<void> {
    this.notice.set(null);
    try {
      const result = await this.friendsService.acceptRequest(request.id);
      if (result === 'confirmed') {
        await this.router.navigateByUrl('/friends'); // the new friend is there
        return;
      }
      this.notice.set({
        kind: 'warning',
        text: `You have no free seats. The request from ${request.fromName} stays pending: remove a friend to make room, then confirm.`,
      });
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
