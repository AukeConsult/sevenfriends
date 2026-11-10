import { Injectable, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FriendsService } from '../core/friends.service';
import { initials } from '../core/initials';
import { KeysService } from '../core/keys.service';
import { SafeboxService } from '../core/safebox.service';
import { UiPreferencesService } from '../core/ui-preferences';
import { ApiError } from '../core/api.service';
import { BoxKeys, SafeboxItem, profileColorHex, profileColorInk, readableFingerprint } from '../models';
import { tr } from '../core/i18n';

/** What the conversation tells the header it can do (the sort order and the clean-up belong to the feed, so the menu shows them only while the feed is open). */
export interface FeedActions {
  sortDesc(): boolean;
  toggleSort(): void;
  toggleCleanup(): void;
  /** the header menu was opened: the emoji picker and the + menu close */
  closeMenus(): void;
}

/** A tool of the page that is open (not the feed), shown first in the header menu: "Messages for X only" on Send a message, "Add files" in the safebox. */
export interface PageTool {
  label: string;
  kind: 'message' | 'files';
  run(): void;
}

/**
 * Everything about ONE friend that the header and the pages under it share: who the friend is, the colour, the keys and the padlock, the profile panel.
 * It lives as long as the friend page (`FriendPage`) is open, so switching between the messages and the safebox keeps it and asks nothing again.
 */
@Injectable()
export class FriendContext {
  private readonly friends = inject(FriendsService);
  private readonly keys = inject(KeysService);
  private readonly safebox = inject(SafeboxService);
  private readonly prefs = inject(UiPreferencesService);
  private readonly router = inject(Router);

  readonly friendId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  /** this friend, from the list */
  /** the ready-made messages that are for this friend only (kept on this device, see UiPreferences.friendQuick) */
  readonly ownQuick = computed(() => this.prefs.value('friendQuick')()[this.friendId] ?? []);

  setOwnQuick(list: string[]): void {
    const all = { ...this.prefs.get('friendQuick') };
    if (list.length) all[this.friendId] = list;
    else delete all[this.friendId];
    this.prefs.set('friendQuick', all);
  }

  /** the friend's name for a sentence */
  /** "Poke anyway" is on for the next message (only offered when the friend has me on their sleep list); it goes off again after a send. */
  readonly poke = signal(false);
  /** The next message is a poke: it makes a sound for a friend who has me on their sleep list. */
  readonly pokes = computed(() => this.poke() && this.friend()?.sleepsMe === true);
  readonly friendName = computed(() => this.friend()?.name ?? 'your friend');

  readonly friend = computed(() => this.friends.friends().find((f) => f.id === this.friendId) ?? null);
  /** the seat of this friend (1-7): its icon friend{seat}.svg is shown in the header; 0 while the list is not loaded */
  readonly seat = computed(() => this.friends.awake().findIndex((f) => f.id === this.friendId) + 1);
  /** the name of this conversation once it is loaded (the feed tells it) */
  readonly name = signal('');
  /** how many messages / safebox files of this friendship this device cannot open (set by the feed and the safebox; the band under the header shows it) */
  readonly lockedMessages = signal(0);
  readonly lockedFiles = signal(0);
  /** set when this conversation cannot be opened (not confirmed, or not found): the feed tells it */
  readonly blocked = signal<string | null>(null);
  /** the name for the header: the one of the conversation once it is loaded, until then the one of the friend list, else nothing */
  readonly headerName = computed(() => this.name() || this.friend()?.name || '');
  /** the header shows the full name when it is at most this many characters, else the initials */
  private static readonly HEADER_NAME_MAX = 15;
  readonly headerText = computed(() => {
    const full = this.headerName().trim();
    return full.length <= FriendContext.HEADER_NAME_MAX ? full : initials(full);
  });
  /** the colour my friend chose for their profile (#rrggbb), or null, and the text colour on it */
  readonly friendColor = computed(() => profileColorHex(this.friend()?.color));
  readonly friendInk = computed(() => profileColorInk(this.friend()?.color));

  /** what the padlock just did, said in plain words under the header for a few seconds (null = nothing), and a counter that restarts the fade */
  readonly lockNotice = signal<string | null>(null);
  readonly lockNoticeSeq = signal(0);
  private lockNoticeTimer: ReturnType<typeof setTimeout> | undefined;
  /** the menu of the three dots in the header */
  readonly moreOpen = signal(false);
  /** the height of the header: the message field sticks right under it when the newest message is on top */
  readonly barHeight = signal(56);
  /** set by the feed while it is open */
  readonly feed = signal<FeedActions | null>(null);
  /** the page that is open says what its own tool in the menu is (null = none); see PageTool */
  readonly pageTool = signal<PageTool | null>(null);

  /** a page sets its tool, and takes it back when it closes (not if another page has already set its own) */
  setPageTool(tool: PageTool, destroyRef: { onDestroy(fn: () => void): void }): void {
    this.pageTool.set(tool);
    destroyRef.onDestroy(() => {
      if (this.pageTool() === tool) this.pageTool.set(null);
    });
  }
  /** a message from this friend arrived while the safebox was open: a dot on the Messages icon */
  readonly messageDot = signal(false);

  // ---- the keys and the padlock
  /** the keys in use of me and of my friend, as the server lists them (null until asked) */
  readonly boxKeys = signal<BoxKeys | null>(null);
  readonly keysService = this.keys;
  private readonly boxPlain = this.prefs.value('boxPlain');
  /** who has a key: 'both', 'friend' (only I have one, on this device), 'me' (only my friend has one), 'none', or 'checking' while it is not known */
  readonly keyStatus = computed<'checking' | 'both' | 'me' | 'friend' | 'none'>(() => {
    const box = this.boxKeys();
    const state = this.keys.state();
    if (!box || state === 'checking') return 'checking';
    const mine = state === 'ready' && box.mine.some((k) => k.id === this.keys.thisKeyId());
    const friend = box.friend.length > 0;
    return mine && friend ? 'both' : friend ? 'me' : mine ? 'friend' : 'none';
  });
  /** who has a key: me (on this device) and my friend (on any device); null while it is not known */
  readonly meHasKey = computed(() => (this.keyStatus() === 'checking' ? null : this.keyStatus() === 'both' || this.keyStatus() === 'friend'));
  readonly friendHasKey = computed(() => (this.keyStatus() === 'checking' ? null : this.keyStatus() === 'both' || this.keyStatus() === 'me'));
  /** the keys in use of my friend (their codes are shown on the locking page, to compare with what they read from their own device) */
  readonly friendKeys = computed(() => this.boxKeys()?.friend ?? []);
  /** the fingerprints of my friend's keys (the question "did you change phone?" is asked when one is new on this device) */
  readonly friendFingerprints = computed(() => this.friendKeys().filter((k) => !k.revoked).map((k) => k.fingerprint));
  readonly readable = readableFingerprint;
  /** how many keys in use the server lists for me and for my friend (for the details line) */
  readonly serverKeys = computed(() => ({ mine: this.boxKeys()?.mine.length ?? 0, friend: this.boxKeys()?.friend.length ?? 0 }));
  /** both of us have a key (mine on this device, my friend's on any device) */
  readonly bothHaveKeys = computed(() => this.keyStatus() === 'both');
  /** new messages are locked: both have a key and locking is not switched off (the same choice as for new files in the safebox) */
  readonly messagesLocked = computed(() => this.bothHaveKeys() && !this.boxPlain());
  /** what the padlock says (for a screen reader and the tooltip) */
  readonly lockText = computed(() =>
    this.messagesLocked() ? tr('friendPage.newMessagesAndFiles', 'New messages and files are locked') : this.bothHaveKeys() ? tr('friendPage.lockingIsSwitchedOff', 'Locking is switched off for new messages and files') : tr('friendPage.messagesAndFilesAre', 'Messages and files are not locked yet: you both need a key'),
  );

  constructor() {
    void this.keys.refresh(); // is there a key for me on this device?
    this.loadBoxKeys(); // and for my friend?
    if (!this.friends.friends().length) void this.friends.load().catch(() => undefined); // opened directly (a reload): the seat comes from the list
  }

  /** Asks the server for the keys in use of me and of my friend (again when the padlock is tapped while they are still not known). */
  private loadBoxKeys(): void {
    void this.safebox
      .keys(this.friendId)
      .then((keys) => this.boxKeys.set(keys))
      .catch((err) => {
        console.warn('The keys of the friend could not be loaded', err);
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) this.blocked.set(err.message); // not a confirmed friend (any page of this friend can be opened directly)
      });
  }

  /** Locks files one by one (the safebox and the Locking and keys page both do this); stops at the first one that fails and returns what to say about it, null when all are done. */
  async lockFiles(files: SafeboxItem[], progress: (done: number) => void): Promise<string | null> {
    let done = 0;
    for (const item of files) {
      try {
        await this.lockExisting(item);
      } catch (err: any) {
        return `“${item.name}” could not be encrypted: ${err.message ?? 'something went wrong'}`;
      }
      progress(++done);
    }
    return null;
  }

  /** Locks a file that was put in the box before locking was possible; when the keys changed while it was sent (409) the keys are read again and it is tried once more. */
  async lockExisting(item: SafeboxItem): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const keys = this.boxKeys();
      if (!keys) throw new Error(tr('friendPage.theKeysAreNot', 'The keys are not known yet'));
      try {
        await this.safebox.encryptExisting(this.friendId, item, keys);
        return;
      } catch (err) {
        if (attempt > 0 || !(err instanceof ApiError) || err.status !== 409) throw err;
        this.boxKeys.set(await this.safebox.keys(this.friendId));
      }
    }
  }

  /**
   * The padlock of the header. When both of us have a key it switches locking on or off and says what that means (the message fades away by itself).
   * When one of us has no key there is nothing to switch: it opens the Locking and keys page, which says who needs to make one.
   */
  toggleLock(): void {
    const status = this.keyStatus();
    if (status === 'checking') {
      // the keys are not known (still asking, or the answer did not come): say so and ask again, instead of doing nothing
      this.lockNotice.set(tr('friendPage.theKeysAreNot', 'The keys are not known yet'));
      this.lockNoticeSeq.update((n) => n + 1);
      clearTimeout(this.lockNoticeTimer);
      this.lockNoticeTimer = setTimeout(() => this.lockNotice.set(null), 4000);
      void this.keys.refresh();
      this.loadBoxKeys();
      return;
    }
    if (status !== 'both') {
      void this.router.navigate(['/friends', this.friendId, 'lock']);
      return;
    }
    const on = this.boxPlain(); // it was off: the switch turns it on
    this.prefs.set('boxPlain', !on);
    const who = this.friendName();
    this.lockNotice.set(
      on
        ? tr('friendPage.lockingIsOnWhat', 'Locking is on. What you send to {{ who }} is locked on your device, so only the two of you can read it. Not even we can.', { who })
        : tr('friendPage.lockingIsOffWhat', 'Locking is off. What you send to {{ who }} is not locked, so our system can read it. What was sent earlier stays as it was sent.', { who }),
    );
    this.lockNoticeSeq.update((n) => n + 1);
    clearTimeout(this.lockNoticeTimer);
    this.lockNoticeTimer = setTimeout(() => this.lockNotice.set(null), 5000);
  }

  /** Opens the profile page of the friend (under the same header). */
  showProfile(): void {
    void this.router.navigate(['/friends', this.friendId, 'profile']);
  }

  /** The three dots of the header: opening its menu closes the emoji picker and the + menu of the feed (only one is open at a time). */
  toggleMore(): void {
    const open = !this.moreOpen();
    this.moreOpen.set(open);
    if (open) this.feed()?.closeMenus();
  }
}
