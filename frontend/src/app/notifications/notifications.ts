import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { ReturnTo } from '../core/return-to';
import { activeLang, tr } from '../core/i18n';
import { ActiveCircleService } from '../core/active-circle.service';
import { Capacitor } from '@capacitor/core';
import { AppDatePipe } from '../core/app-date.pipe';
import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ChatService } from '../core/chat.service';
import { RecoveryInboxService } from '../core/recovery-inbox.service';
import { ApiService } from '../core/api.service';
import { MoodEditor } from '../mood-editor/mood-editor';
import { CircleActivity } from '../circle-activity/circle-activity';
import { CircleActivityService } from '../core/circle-activity.service';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { HomeSeats } from '../home-seats/home-seats';
import { HomeTop } from '../home-top/home-top';
import { Sleeping } from '../sleeping/sleeping';
import { AddFriend } from '../add-friend/add-friend';
import { AuthService } from '../core/auth.service';
import { FriendsService } from '../core/friends.service';
import { MessagesService } from '../core/messages.service';
import { NotificationsService } from '../core/notifications.service';
import { InstallService } from '../core/install.service';
import { UiPreferencesService } from '../core/ui-preferences';
import { Friend, FriendRequest, Message, Notice, ProfileDetails, RecoveryItem } from '../models';
import { AndroidChannelsService } from '../core/android-channels.service';
import { KeysService } from '../core/keys.service';
import { PushService } from '../core/push.service';

/** How long a note that fades out stays: it is gone when the fade ends (see `.sf-fade` in styles.scss, same time). */
const NOTICE_FADE_MS = 5000;

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
 * then my circle at a glance (presence, mood, when we last spoke, a gentle "Say hi"), my mood, and the invite link under "Share".
 */
@Component({
  selector: 'app-notifications',
  imports: [AppDatePipe, CircleActivity, FriendAvatar, HomeSeats, HomeTop, RouterLink, MoodEditor, Sleeping, AddFriend, TranslocoDirective],
  templateUrl: './notifications.html',
  providers: [provideTranslocoScope('notifications')],
  host: { '(click)': 'emptySpaceClicked($event)' },
})
export class Notifications {
  protected readonly w = inject(ActiveCircleService).words;
  private readonly notifications = inject(NotificationsService);
  private readonly friendsService = inject(FriendsService);
  private readonly messagesService = inject(MessagesService);
  private readonly api = inject(ApiService);
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);

  /** A click on an empty part of the home page (nothing that reacts to a click) opens the friend list. */
  /** the silent list is open: it takes the place of everything under the top of Home */
  protected readonly silentOpen = signal(inject(ReturnTo).takeSleepList());
  protected readonly addOpen = signal(false);

  protected emptySpaceClicked(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (this.silentOpen() || this.addOpen()) {
      // the silent list or the add-friend form is open: a click on empty space (not on a card, the form or anything that reacts) is back to the normal Home
      if (!target || target.closest('a, button, input, textarea, select, summary, label, details, form, .card, .alert, [role="button"], [tabindex], [contenteditable]')) return;
      if (window.getSelection()?.toString()) return;
      this.silentOpen.set(false);
      this.addOpen.set(false);
      return;
    }
    if (!target || target.closest('a, button, input, textarea, select, summary, label, details, app-mood-editor, [role="button"], [tabindex], [contenteditable]')) return;
    if (window.getSelection()?.toString()) return; // the person was selecting text
    void this.router.navigateByUrl('/');
  }
  protected readonly install = inject(InstallService);
  private readonly android = inject(AndroidChannelsService);
  private readonly push = inject(PushService);
  private readonly prefs = inject(UiPreferencesService);
  private readonly keys = inject(KeysService);
  private readonly otherCircles = inject(CircleActivityService).circles;
  private readonly recovery = inject(RecoveryInboxService);
  /** friends who ask me to help open their old messages, and friends who declined my request (both of the circle in use) */
  protected readonly toHelp = this.recovery.toHelp;
  protected readonly declined = this.recovery.declined;
  /** the first-time setup was left for later: Home offers it again */
  protected readonly setupLeft = computed(() => ['skipped', 'start'].includes(this.prefs.value('setup')()));
  /** no key on this device and the setup is not offering it: a small reminder stays (the lock is made by itself at sign-in; this is only when this browser cannot keep one) */
  protected readonly lockOff = computed(() => this.keys.state() === 'none' && !this.setupLeft());

  private readonly auth = inject(AuthService);
  private readonly user = this.auth.user;

  /**
   * My own details, when none of them is verified. I still receive requests, but my friends are told that I have
   * not verified, so I am told here too (with a way to fix it).
   */
  protected readonly unverified = signal<('email' | 'phone')[]>([]);
  /** the "Send confirmation email" button of the unverified-email note */
  protected readonly emailSending = signal(false);
  protected readonly emailSent = signal(false);
  protected readonly emailError = signal<string | null>(null);

  /** Sends the email with the link that confirms the address (the same as on the profile page). */
  protected async sendConfirmation(): Promise<void> {
    this.emailSending.set(true);
    this.emailError.set(null);
    try {
      await this.auth.sendVerificationEmail();
      this.emailSent.set(true);
    } catch (err: any) {
      this.emailError.set(err?.message ? String(err.message) : tr('notifications.confirmationFailed', 'Could not send the email. Please try again.'));
    } finally {
      this.emailSending.set(false);
    }
  }


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
    if (blocked.appOff) return tr('notifications.notificationsAreSwitchedOff', 'Notifications are switched off for {{ app }} in Android, so you will not hear about new messages or {{ one }} requests.', { app: this.w.app, one: this.w.one });
    const names: Record<string, string> = { message: 'new messages', request: `${this.w.one} requests`, answer: 'answers to your requests', removed: 'removed connections' };
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
      ? { canTurnOn: false, text: tr('notifications.notificationsAreBlockedFor', 'Notifications are blocked for this site in your browser, so you will not hear about new messages when this page is closed. Allow them in the browser settings (the lock icon by the address).') }
      : { canTurnOn: true, text: tr('notifications.notificationsAreOffOn', 'Notifications are off on this device, so you will not hear about new messages when this page is closed.') };
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

  /** the setup notes can be hidden for 24 hours (the time is kept on this device, so they stay away when the app is opened again) */
  private static readonly CHECKS_KEY = 'sf-checks-hidden-until';
  protected readonly checksHidden = signal(Number(this.readHiddenUntil()) > Date.now());

  private readHiddenUntil(): string | null {
    try {
      return localStorage.getItem(Notifications.CHECKS_KEY);
    } catch {
      return null;
    }
  }

  protected hideChecks(): void {
    try {
      localStorage.setItem(Notifications.CHECKS_KEY, String(Date.now() + 24 * 60 * 60 * 1000));
    } catch {
      /* storage is not available: hidden until the app is opened again */
    }
    this.checksHidden.set(true);
  }

  /** the setup notes: sound and notifications not set up, the phone's notification switch, details not verified (folded into one line on Home); privacy lock off is one of them */
  protected readonly checkCount = computed(() => [this.setupLeft(), this.lockOff(), this.androidOff() !== null, this.pushOff() !== null, this.unverified().length > 0].filter(Boolean).length);

  /** what needs me from people: requests, a request waiting for a seat, unread messages, activity in another circle */
  protected readonly needsYou = computed(() => this.seated().length > 0 || this.waitingCount() > 0 || this.groups().length > 0 || this.otherCircles().length > 0 || this.toHelp().length > 0 || this.declined().length > 0);

  /** "Good evening, Leif" */
  protected readonly greeting = computed(() => {
    const hour = new Date().getHours();
    const part = hour < 5 ? tr('notifications.goodNight', 'Good night') : hour < 12 ? tr('notifications.goodMorning', 'Good morning') : hour < 18 ? tr('notifications.goodAfternoon', 'Good afternoon') : tr('notifications.goodEvening', 'Good evening');
    const first = (this.user()?.displayName ?? '').trim().split(/\s+/)[0];
    return first ? `${part}, ${first}` : part;
  });

  /** how many of my friends are active right now */
  protected readonly around = computed(() => {
    const n = this.friendsService.awake().filter((f) => f.status === 'confirmed' && f.presence === 'active').length;
    return n === 0 ? tr('notifications.nobodyIsAroundRight', 'Nobody is around right now') : n === 1 ? tr('notifications.ofYourSevenIs', '1 of your seven is around right now') : tr('notifications.ofYourSevenAre', '{{ n }} of your seven are around right now', { n });
  });

  /** the quick replies being typed, by friend */
  protected readonly replies = signal<Partial<Record<string, string>>>({});
  protected readonly replying = signal<string | null>(null);

  /** Result of the last Confirm, shown above the lists. */
  protected readonly notice = signal<Notice | null>(null);
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly loaded = this.notifications.loaded;
  protected readonly error = this.notifications.error;

  constructor() {
    void this.keys.refresh(); // the reminder "privacy lock is off" needs to know
    // a freshly installed app has nothing of what was set up in the browser (key, notifications, microphone): the setup wizard continues here, once
    if (this.install.separateApp && this.prefs.get('setup') === 'new') {
      void this.router.navigateByUrl('/setup');
    }
    // the person may have changed the browser's permission in its settings: look again when the page comes back
    const recheck = () => this.permission.set(typeof Notification === 'undefined' ? 'denied' : Notification.permission);
    document.addEventListener('visibilitychange', recheck);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', recheck));
    // a friend finished my recovery request: told once, as a note that fades
    effect(() => {
      const names = this.recovery.finished();
      if (!names.length) return;
      untracked(() => {
        this.recovery.finished.set([]);
        this.fadeNotice({ kind: 'success', fade: true, text: names.length === 1 ? tr('notifications.openedYourHistory', '{{ friendName }} opened your history.', { friendName: names[0] }) : tr('notifications.openedYourHistoryMany', '{{ friendNames }} opened your history.', { friendNames: names.join(', ') }) });
      });
    });
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
        await this.router.navigateByUrl('/'); // the new friend is there
        return;
      }
      this.notice.set({
        kind: 'warning',
        text: tr('notifications.youHaveNoFree', 'You have no free seats. The request from {{ fromName }} stays pending: remove a friend to make room, then confirm.', { fromName: request.fromName }),
      });
    } catch (err: any) {
      await this.failed(err);
    }
  }

  protected async reject(request: FriendRequest): Promise<void> {
    this.notice.set(null);
    try {
      await this.friendsService.rejectRequest(request.id);
      const note: Notice = { kind: 'warning', fade: true, text: tr('notifications.youRejectedTheRequest', 'You rejected the request from {{ fromName }}.', { fromName: request.fromName }) };
      this.fadeNotice(note);
    } catch (err: any) {
      await this.failed(err);
    }
  }

  /** A note that fades out and goes by itself. */
  private fadeNotice(note: Notice): void {
    this.notice.set(note);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => { if (this.notice() === note) this.notice.set(null); }, NOTICE_FADE_MS);
  }

  /** I say no to a friend's recovery request: the friend is told. */
  protected async declineHelp(item: RecoveryItem): Promise<void> {
    try {
      await this.recovery.decline(item);
    } catch (err: any) {
      await this.failed(err);
      void this.recovery.refresh();
    }
  }

  /** I have read that a friend said no to my recovery request. */
  protected async dismissDeclined(item: RecoveryItem): Promise<void> {
    try {
      await this.recovery.dismiss(item);
    } catch (err: any) {
      this.error.set(err.message);
    }
  }

  /** An answer that failed: when the request is not there any more (the person took it back) the list is checked again and the request goes; any other failure is shown. */
  private async failed(err: { status?: number; message: string }): Promise<void> {
    if (err.status === 404) await this.notifications.refresh();
    else this.error.set(err.message);
  }

  /** "You haven't talked to Anna for 3 weeks" */
  protected quietText(friend: Friend): string {
    if (!friend.lastSpokenAt) return tr('notifications.youHavenTTalked', 'You haven\'t talked to {{ friendName }} yet', { friendName: friend.name });
    const days = Math.floor((this.now - new Date(friend.lastSpokenAt).getTime()) / 86_400_000);
    const unit = (value: number, name: 'week' | 'month') => new Intl.NumberFormat(activeLang(), { style: 'unit', unit: name, unitDisplay: 'long' }).format(value);
    const span = days < 60 ? unit(Math.max(2, Math.round(days / 7)), 'week') : unit(Math.round(days / 30), 'month');
    return tr('notifications.youHavenTTalked2', 'You haven\'t talked to {{ friendName }} for {{ span }}', { friendName: friend.name, span });
  }

  /** seats still free */
  protected readonly freeSeats = computed(() => 7 - this.friendsService.awake().length);

  /** when it is quiet: the friend I have not talked to for the longest time (a confirmed friend), to say hi to */
  protected readonly nudge = computed<Friend | null>(
    () =>
      this.friendsService
        .awake()
        .filter((f) => f.status === 'confirmed')
        .sort((a, b) => (a.lastSpokenAt ?? '').localeCompare(b.lastSpokenAt ?? ''))[0] ?? null,
  );

  /** "You last spoke 3 days ago" */
  protected lastTalk(friend: Friend): string {
    if (!friend.lastSpokenAt) return tr('notifications.youHavenTTalked', 'You haven\'t talked to {{ friendName }} yet', { friendName: friend.name });
    const days = Math.floor((this.now - new Date(friend.lastSpokenAt).getTime()) / 86_400_000);
    return days < 1 ? tr('notifications.youSpokeToday', 'You spoke today') : days === 1 ? tr('notifications.youLastSpokeYesterday', 'You last spoke yesterday') : tr('notifications.youLastSpokeDays', 'You last spoke {{ days }} days ago', { days });
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
      this.error.set(err.message ?? tr('notifications.couldNotSendThe', 'Could not send the reply'));
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
      this.error.set(err.message ?? tr('notifications.couldNotMarkThe', 'Could not mark the messages as read'));
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
