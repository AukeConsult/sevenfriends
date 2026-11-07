import { Capacitor } from '@capacitor/core';
import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ChatService } from '../core/chat.service';
import { ApiService } from '../core/api.service';
import { MoodEditor } from '../mood-editor/mood-editor';
import { AuthService } from '../core/auth.service';
import { FriendsService } from '../core/friends.service';
import { InviteLinkService } from '../core/invite-link.service';
import { MessagesService } from '../core/messages.service';
import { NotificationsService } from '../core/notifications.service';
import { InstallService } from '../core/install.service';
import { UiPreferencesService } from '../core/ui-preferences';
import { Friend, FriendRequest, Message, Notice, ProfileDetails } from '../models';
import { APP_ORIGIN } from '../core/app-origin';
import { AndroidChannelsService } from '../core/android-channels.service';
import { PushService } from '../core/push.service';

/** Without a word for this many days, a friend gets a gentle "Say hi". */
const SAY_HI_AFTER_DAYS = 14;

/** The unread messages of one friend, as one row on Home. */
interface MessageGroup {
  key: string;
  connectionId: string | null;
  name: string;
  count: number;
  last: Message;
  friend: Friend | null;
}

/**
 * Home: what needs me first (friend requests, unread messages grouped by friend with a quick reply, setup, unverified details),
 * then my circle at a glance (presence, mood, when we last spoke, a gentle "Say hi"), my mood, and the invite link under "More".
 */
@Component({
  selector: 'app-notifications',
  imports: [DatePipe, RouterLink, MoodEditor],
  templateUrl: './notifications.html',
  host: { '(click)': 'emptySpaceClicked($event)' },
})
export class Notifications {
  private readonly notifications = inject(NotificationsService);
  private readonly friendsService = inject(FriendsService);
  private readonly messagesService = inject(MessagesService);
  private readonly api = inject(ApiService);
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);

  /** A click on an empty part of the home page (nothing that reacts to a click) opens the friend list. */
  protected emptySpaceClicked(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('a, button, input, textarea, select, summary, label, details, app-mood-editor, [role="button"], [tabindex], [contenteditable]')) return;
    if (window.getSelection()?.toString()) return; // the person was selecting text
    void this.router.navigateByUrl('/friends');
  }
  protected readonly install = inject(InstallService);
  private readonly android = inject(AndroidChannelsService);
  private readonly push = inject(PushService);
  protected readonly invite = inject(InviteLinkService);
  private readonly prefs = inject(UiPreferencesService);
  /** the first-time setup was left for later: Home offers it again */
  protected readonly setupLeft = computed(() => this.prefs.value('setup')() === 'skipped');

  private readonly user = inject(AuthService).user;

  /** the link to hand out: whoever opens it, signs in and confirms sends ME a friend request (my email, or my phone number without an email) */
  protected readonly friendLink = computed(() => {
    const me = this.user();
    const contact = me?.email ?? me?.phoneNumber;
    return contact ? `${APP_ORIGIN}/welcome?friend=${encodeURIComponent(contact)}` : null;
  });

  /**
   * My own details, when none of them is verified. I still receive requests, but my friends are told that I have
   * not verified, so I am told here too (with a way to fix it).
   */
  protected readonly unverified = signal<('email' | 'phone')[]>([]);


  protected readonly requests = this.friendsService.requests;
  protected readonly messages = this.messagesService.messages;

  /** Requests that already have a pending seat in my circle: confirm or reject them here. */
  protected readonly seated = computed(() => this.requests().filter((r) => r.seated));
  /** Requests waiting for a free seat: only listed on the Pending page. */
  protected readonly waitingCount = computed(() => this.requests().filter((r) => !r.seated).length);

  private readonly now = Date.now();

  /** friends I have not talked to for a while (or ever): at most two gentle nudges, the longest silence first */
  protected readonly quiet = computed(() =>
    this.friendsService
      .awake()
      .filter((f) => f.status === 'confirmed' && this.sayHi(f))
      .sort((a, b) => (a.lastSpokenAt ?? '').localeCompare(b.lastSpokenAt ?? ''))
      .slice(0, 2),
  );

  /** the unread messages, one row for each friend (the latest line, how many), the friend with the newest message first */
  protected readonly groups = computed<MessageGroup[]>(() => {
    const byFriend = new Map<string, MessageGroup>();
    for (const message of this.messages()) {
      const key = message.connectionId ?? `name:${message.fromName}`;
      const group = byFriend.get(key);
      const newer = !group || (message.time ?? '') > (group.last.time ?? '');
      byFriend.set(key, {
        key,
        connectionId: message.connectionId,
        name: message.fromName,
        count: (group?.count ?? 0) + 1,
        last: newer ? message : group!.last,
        friend: this.friendsService.friends().find((f) => f.id === message.connectionId) ?? null,
      });
    }
    return [...byFriend.values()].sort((a, b) => (b.last.time ?? '').localeCompare(a.last.time ?? ''));
  });
  /** anything that needs me: the first block of the page is only there then */
  /** the Android app only: notifications are switched off in Android's settings (for everything, or for some kinds): the text for the warning, or null */
  protected readonly androidLater = signal(false); // "Not now": the warning stays away until the app is opened again
  protected readonly androidOff = computed(() => {
    const blocked = this.android.blocked();
    if (!blocked || this.androidLater()) return null;
    if (blocked.appOff) return 'Notifications are switched off for Seven Friends in Android, so you will not hear about new messages or friend requests.';
    const names: Record<string, string> = { message: 'new messages', request: 'friend requests', answer: 'answers to your requests', removed: 'removed friendships' };
    const off = blocked.off.map((kind) => names[kind] ?? kind);
    return off.length ? `In Android these notifications are switched off: ${off.join(', ')}.` : null;
  });
  /** the browser's own answer to "may this site notify?" (changes in the browser's settings, so it is read again when the page comes back) */
  private readonly permission = signal<string>(typeof Notification === 'undefined' ? 'denied' : Notification.permission);
  /** "Not now": the warning below stays away until the page is opened again */
  protected readonly pushLater = signal(false);
  protected readonly pushProblem = signal<string | null>(null);

  /**
   * In a browser (not the Android app: androidOff covers that): push notifications are the way to hear about news when the page is closed.
   * When they are not on for this device, or the browser blocks them, a warning says so. null = nothing to warn about (or push is not possible here).
   */
  protected readonly pushOff = computed(() => {
    if (Capacitor.isNativePlatform() || this.pushLater() || !this.push.checked() || !this.push.supported()) return null;
    if (this.push.enabled() && this.permission() === 'granted') return null;
    return this.permission() === 'denied'
      ? { canTurnOn: false, text: 'Notifications are blocked for this site in your browser, so you will not hear about new messages when this page is closed. Allow them in the browser settings (the lock icon by the address).' }
      : { canTurnOn: true, text: 'Notifications are off on this device, so you will not hear about new messages when this page is closed.' };
  });

  protected async turnOnPush(): Promise<void> {
    this.pushProblem.set(null);
    await this.push.setEnabled(true);
    this.permission.set(typeof Notification === 'undefined' ? 'denied' : Notification.permission);
    this.pushProblem.set(this.push.problem());
  }

  protected openAndroidSettings(): void {
    this.android.openSettings();
  }

  protected readonly needsYou = computed(() => this.androidOff() !== null || this.pushOff() !== null || this.setupLeft() || this.unverified().length > 0 || this.seated().length > 0 || this.waitingCount() > 0 || this.groups().length > 0);

  /** the quick replies being typed, by friend */
  protected readonly replies = signal<Partial<Record<string, string>>>({});
  protected readonly replying = signal<string | null>(null);

  /** Result of the last Confirm, shown above the lists. */
  protected readonly notice = signal<Notice | null>(null);

  protected readonly loaded = this.notifications.loaded;
  protected readonly error = this.notifications.error;

  constructor() {
    // the person may have changed the browser's permission in its settings: look again when the page comes back
    const recheck = () => this.permission.set(typeof Notification === 'undefined' ? 'denied' : Notification.permission);
    document.addEventListener('visibilitychange', recheck);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', recheck));
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
        // TODO: bring back when SMS verification is ready (the phone cannot be verified until then)
        // if (profile.phone) missing.push('phone');
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

  /** "You haven't talked to Anna for 3 weeks" */
  protected quietText(friend: Friend): string {
    if (!friend.lastSpokenAt) return `You haven't talked to ${friend.name} yet`;
    const days = Math.floor((this.now - new Date(friend.lastSpokenAt).getTime()) / 86_400_000);
    const span = days < 60 ? `${Math.max(2, Math.round(days / 7))} weeks` : `${Math.round(days / 30)} months`;
    return `You haven't talked to ${friend.name} for ${span}`;
  }

  /** a friend I have not talked to for a while (or never): a gentle nudge */
  protected sayHi(friend: Friend): boolean {
    return !friend.lastSpokenAt || this.now - new Date(friend.lastSpokenAt).getTime() > SAY_HI_AFTER_DAYS * 86_400_000;
  }

  protected setReply(key: string, text: string): void {
    this.replies.update((all) => ({ ...all, [key]: text }));
  }

  /** Sends the quick reply to that friend, and marks what they wrote as read. */
  protected async sendReply(group: MessageGroup): Promise<void> {
    const text = (this.replies()[group.key] ?? '').trim();
    if (!text || !group.connectionId || this.replying()) return;
    this.replying.set(group.key);
    this.error.set(null);
    try {
      await this.chat.send(group.connectionId, text);
      await this.chat.markRead(group.connectionId);
      this.setReply(group.key, '');
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not send the reply');
    } finally {
      this.replying.set(null);
    }
  }

  /** Marks everything this friend wrote as read. */
  protected async markGroupRead(group: MessageGroup): Promise<void> {
    try {
      if (group.connectionId) await this.chat.markRead(group.connectionId);
      else await this.messagesService.markRead(group.last.id);
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not mark the messages as read');
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
