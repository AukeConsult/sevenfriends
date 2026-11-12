import { APP_ORIGIN } from '../core/app-origin';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { ActiveCircleService } from '../core/active-circle.service';
import { FriendContext } from '../friend-page/friend-context';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppDatePipe } from '../core/app-date.pipe';
import { Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NavigationStart, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
import { ApiError } from '../core/api.service';
import { ChatItem } from '../core/message-lock.service';
import { SafeboxService } from '../core/safebox.service';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { MediaAudio } from '../media-audio/media-audio';
import { MediaImage } from '../media-image/media-image';
import { MediaVideo } from '../media-video/media-video';
import { AuthService } from '../core/auth.service';
import { NoticeClearService } from '../core/notice-clear.service';
import { ChatService } from '../core/chat.service';
import { MyAvatarService } from '../core/my-avatar.service';
import { LiveChanges } from '../core/live-changes';
import { UiPreferencesService } from '../core/ui-preferences';
import { FriendsService } from '../core/friends.service';
import { initials } from '../core/initials';
import { MemberPictureService } from '../core/member-picture.service';
import { RealtimeService } from '../core/realtime.service';
import { ChatMessage, GroupMember, MessageDeleteCriteria } from '../models';

// New messages, edits and deletes arrive live (RealtimeService). This refresh is only a safety net.
const SAFETY_REFRESH_MS = 30000;


/** The message feed with one friend: /friends/:id (the id of the connection). */
@Component({
  selector: 'app-chat',
  imports: [AppDatePipe, FriendAvatar, MediaAudio, MediaImage, MediaVideo, NgTemplateOutlet, RouterLink, TranslocoDirective],
  templateUrl: './chat.html',
  providers: [provideTranslocoScope('chat')],
})
export class Chat {
  protected readonly w = inject(ActiveCircleService).words;
  private readonly chat = inject(ChatService);
  private readonly notices = inject(NoticeClearService);
  private readonly safebox = inject(SafeboxService);
  private readonly prefs = inject(UiPreferencesService);
  private readonly live = inject(LiveChanges);
  private readonly realtime = inject(RealtimeService);
  private readonly friendsService = inject(FriendsService);
  private readonly router = inject(Router);
  private lastLive = this.realtime.latestMessage()?.seq ?? 0; // live messages before this page opened are not news
  private readonly end = viewChild<ElementRef<HTMLElement>>('end');

  /** everything about this friend that the header shares with the pages under it (the friend, the colour, the padlock, the profile) */
  protected readonly ctx = inject(FriendContext);
  protected readonly friendId = this.ctx.friendId;
  protected readonly name = this.ctx.name;
  protected readonly friend = this.ctx.friend;
  protected readonly seat = this.ctx.seat;
  protected readonly blocked = this.ctx.blocked;
  protected readonly barHeight = this.ctx.barHeight;

  /** The friend's picture next to a message: opens the profile under the header. */
  protected showProfile(): void {
    this.ctx.showProfile();
  }
  protected readonly initials = initials;
  protected readonly messages = signal<ChatItem[]>([]);
  private readonly lockedCount = computed(() => this.messages().filter((m) => m.locked === 'shut').length);
  /** a picture next to every message (a preference) */
  protected readonly feedIcons = this.prefs.value('feedIcons');
  private readonly myAvatarService = inject(MyAvatarService);
  protected readonly myAvatar = this.myAvatarService.src;
  private readonly me = inject(AuthService).user;
  protected readonly myInitials = computed(() => initials(this.me()?.displayName ?? this.me()?.email ?? this.me()?.phoneNumber));
  /** newest first? (a remembered choice, the same in every window; a refresh of the feed never changes it) */
  protected readonly sortDesc = computed(() => this.prefs.value('chatOrder')() === 'newest');
  protected readonly shown = computed(() => (this.sortDesc() ? [...this.messages()].reverse() : this.messages()));

  // deleting several of my messages: the expanding frame under the header
  /** A getter, not a field: the texts are read when the page is drawn, after the language file is loaded. */
  protected get ageChoices(): { label: string; days: number | null; icon: string }[] {
    return [
      { label: tr('chat.olderThanADay', 'Older than a day'), days: 1, icon: 'day' },
      { label: tr('chat.olderThanAWeek', 'Older than a week'), days: 7, icon: 'week' },
      { label: tr('chat.olderThanAMonth', 'Older than a month'), days: 30, icon: 'month' },
      { label: tr('chat.allOfThem', 'All of them'), days: null, icon: 'all' },
    ];
  }
  protected readonly cleanupOpen = signal(false);
  protected readonly cleanupWhose = signal<'mine' | 'both'>(this.prefs.get('cleanupWhose'));
  /** my messages, or both sides' (never the friend's alone) */
  protected readonly whoseChoices = computed<{ value: 'mine' | 'both'; label: string }[]>(() => [
    { value: 'mine', label: tr('chat.myMessages', 'My messages') },
    { value: 'both', label: `Both: mine and ${this.name() || 'my friend'}'s` },
  ]);
  protected readonly cleanupDays = signal<number | null>(this.rememberedDays());
  protected readonly cleanupText = signal('');

  /** the age that was chosen last, when one of the choices above has it (otherwise a month) */
  private rememberedDays(): number | null {
    const days = this.prefs.get('cleanupDays');
    return this.ageChoices.some((choice) => choice.days === days) ? days : 30;
  }
  /** how many messages match (counted by the server); null while counting */
  protected readonly cleanupCount = signal<number | null>(null);
  protected readonly cleanupAsk = signal(false);
  protected readonly cleanupBusy = signal(false);
  protected readonly cleanupDone = signal<string | null>(null);
  /** the messages in view that the delete frame would delete right now (marked in the feed; same rules as the server) */
  protected readonly doomed = computed(() => {
    const ids = new Set<string>();
    if (!this.cleanupOpen()) return ids;
    const cutoff = this.cleanupDays() === null ? null : Date.now() - this.cleanupDays()! * 86_400_000;
    const text = this.cleanupText().trim().toLowerCase();
    for (const m of this.messages()) {
      if (this.cleanupWhose() === 'mine' && !m.mine) continue;
      if (cutoff !== null && !(m.time && new Date(m.time).getTime() < cutoff)) continue;
      if (text && (m.locked || !m.text.toLowerCase().includes(text))) continue; // the server cannot read a locked text, so it never deletes one by its words
      ids.add(m.id);
    }
    return ids;
  });
  private countTimer: ReturnType<typeof setTimeout> | undefined;
  private countSeq = 0;
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  /** the text of my message that is being edited (the field is in the message itself) */
  protected readonly editText = signal('');
  protected readonly sending = signal(false);
  /** my message whose Edit / Delete buttons are open (tap a message of mine) */
  protected readonly selected = signal<string | null>(null);
  /** my message that is being deleted (the question is open) */
  protected readonly deleting = signal<string | null>(null);
  /** the picture or video whose "move to the safebox" question is open, and whether it is being moved */
  protected readonly moving = signal<string | null>(null);
  protected readonly movingBusy = signal(false);
  /** my message that is being edited (its text is a field in the message itself) */
  protected readonly editing = signal<string | null>(null);

  /** In a group feed: who is who, so every message shows its writer (picture or initials, and the name). */
  protected readonly isGroup = computed(() => !!this.friend()?.group);
  private readonly memberPicture = inject(MemberPictureService);
  private readonly members = signal<GroupMember[]>([]);
  private membersFor = '';
  private readonly unknownAsked = new Set<string>();
  private readonly byUid = computed(() => new Map(this.members().map((m) => [m.uid, m])));

  /** The member who wrote a message of a group feed (null = not in the group any more). */
  protected senderOf(message: ChatMessage): GroupMember | null {
    return (message.fromUid && this.byUid().get(message.fromUid)) || null;
  }

  protected senderName(message: ChatMessage): string {
    return this.senderOf(message)?.name || message.fromName || '?';
  }

  protected senderPicture(message: ChatMessage): string | null {
    const member = this.senderOf(message);
    return member ? this.memberPicture.of(member) : null;
  }

  private async loadMembers(): Promise<void> {
    const id = this.friendId;
    try {
      const list = await this.friendsService.groupMembers(id);
      if (this.friendId === id) this.members.set(list);
    } catch {
      /* the initials of the name in the message are shown */
    }
  }

  constructor() {
    effect(() => {
      // a group feed: the people of the group are read once; a writer that is not known yet (just added) asks once more
      if (!this.isGroup()) return;
      const unknown = this.messages().find((m) => !m.mine && m.fromUid && !this.byUid().has(m.fromUid) && !this.unknownAsked.has(m.fromUid));
      if (this.membersFor !== this.friendId || unknown) {
        this.membersFor = this.friendId;
        if (unknown?.fromUid) this.unknownAsked.add(unknown.fromUid);
        void untracked(() => this.loadMembers());
      }
    });

    // the band under the header says how many messages of this friendship this device cannot open
    effect(() => this.ctx.lockedMessages.set(this.lockedCount()));
    inject(DestroyRef).onDestroy(() => this.ctx.lockedMessages.set(0));
    // the header menu shows the sort order and the clean-up only while the feed is open
    this.ctx.feed.set({
      sortDesc: () => this.sortDesc(),
      toggleSort: () => this.toggleSort(),
      toggleCleanup: () => this.toggleCleanup(),
      addPending: (text) => this.addPending(text),
      confirmPending: (id, item) => this.messages.update((list) => list.map((m) => (m.id === id ? item : m))),
      dropPending: (id) => this.messages.update((list) => list.filter((m) => m.id !== id)),
    });
    // leaving the feed (any page): remember where it was scrolled to
    this.router.events.pipe(filter((e) => e instanceof NavigationStart), takeUntilDestroyed()).subscribe(() => {
      if (!this.loaded()) return; // the feed was not shown yet: nothing to remember
      const place = { y: window.scrollY, newest: this.messages().filter((m) => !m.id.startsWith('pending-')).at(-1)?.id ?? null, desc: this.sortDesc() };
      this.prefs.set('feedPlace', { ...this.prefs.get('feedPlace'), [this.friendId]: place });
    });
    this.refresh(true);

    // a message from THIS friend arrived: show it at once
    effect(() => {
      const live = this.realtime.latestMessage();
      if (!live || live.seq <= this.lastLive) return;
      this.lastLive = live.seq;
      if (live.connectionId === this.friendId) untracked(() => void this.refresh(false));
    });

    // the messages of this friendship changed (the friend edited or deleted one, or I did on another device): show it at once
    this.live.on('feed').pipe(takeUntilDestroyed()).subscribe((change) => {
      if (change.connectionId === this.friendId) void this.refresh(false);
    });

    const timer = setInterval(() => this.refresh(false), SAFETY_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      this.ctx.feed.set(null);
    });
  }

  private pendingCount = 0;

  /** A message of mine is in the feed the moment it is sent, before the server has answered; `refresh` takes the temporary copy away when the real one arrives. */
  private addPending(text: string): string {
    const id = `pending-${++this.pendingCount}`;
    this.messages.update((list) => [...list, { id, text, media: null, mine: true, read: false, time: new Date().toISOString(), edited: false, hidden: false, link: null }]);
    this.scrollDown();
    return id;
  }

  private async refresh(first: boolean): Promise<void> {
    try {
      const res = await this.chat.load(this.friendId);
      const pending = this.messages().filter((m) => m.id.startsWith('pending-')); // being sent: the server does not have them yet
      const known = new Set(this.messages().filter((m) => !m.id.startsWith('pending-')).map((m) => m.id));
      const changed = first || res.messages.some((m) => !known.has(m.id)) || res.messages.length !== known.size; // a new message (also when one was deleted at the same time)
      // a message of mine that arrived before the answer of its send: its temporary copy goes
      const arrived = res.messages.filter((m) => m.mine && !known.has(m.id)).map((m) => m.text);
      const waiting = pending.filter((p) => { const i = arrived.indexOf(p.text); if (i < 0) return true; arrived.splice(i, 1); return false; });
      this.name.set(res.friend.name);
      this.messages.set([...res.messages, ...waiting]);
      this.blocked.set(null);
      if (first) this.error.set(null);

      if (res.messages.some((m) => !m.mine && !m.read)) {
        await this.chat.markRead(this.friendId); // I am looking at them now
        this.messages.update((list) => list.map((m) => ({ ...m, read: true })));
      }
      if (first) {
        // shown again after a visit to another page: at the same place, unless a message came meanwhile (then the newest)
        const places = { ...this.prefs.get('feedPlace') };
        const left = places[this.friendId];
        delete places[this.friendId];
        if (left) this.prefs.set('feedPlace', places);
        const newest = res.messages.at(-1)?.id ?? null;
        if (left && left.desc === this.sortDesc() && left.newest === newest) this.scrollBack(left.y);
        else this.scrollDown();
      } else if (changed) this.scrollDown(); // a message arrived or was sent: the newest
    } catch (err: any) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) this.blocked.set(err.message);
      else if (first) this.error.set(err.message ?? tr('chat.couldNotLoadThe', 'Could not load the conversation'));
    } finally {
      this.loaded.set(true);
    }
  }

  /** The messages whose link preview is open (the page is loaded only after a tap: it shows the friend's address to that site and runs its scripts). */
  protected readonly previewing = signal<ReadonlySet<string>>(new Set());
  /** The pictures and videos I have hidden in the feed (they are shown until hidden). The flag is kept on my copy of the message in the database. */
  protected readonly pictureHidden = computed<ReadonlySet<string>>(() => new Set(this.messages().filter((m) => m.hidden).map((m) => m.id)));

  protected togglePicture(id: string): void {
    const hidden = !this.pictureHidden().has(id);
    this.setHidden(id, hidden);
    void this.chat.setHidden(this.friendId, id, hidden).catch(() => this.setHidden(id, !hidden)); // not saved: back to how it was
  }

  private setHidden(id: string, hidden: boolean): void {
    this.messages.update((list) => list.map((m) => (m.id === id ? { ...m, hidden } : m)));
  }

  private readonly sanitizer = inject(DomSanitizer);
  private readonly frames = new Map<string, SafeResourceUrl>();

  protected togglePreview(id: string): void {
    this.previewing.update((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** The address for the frame. It comes from the server, which only gives http(s) addresses; anything else is refused here too. */
  protected frameUrl(url: string): SafeResourceUrl {
    let safe = this.frames.get(url);
    if (!safe) {
      safe = this.sanitizer.bypassSecurityTrustResourceUrl(/^https?:\/\//i.test(url) ? url : 'about:blank');
      this.frames.set(url, safe);
    }
    return safe;
  }

  /** The text cut into pieces: plain text and web addresses (shown as links that open in a new tab). */
  /** an address of this app itself (an item of the safebox in a message): it opens here, not in a new tab, and has no preview frame */
  protected own(url: string): boolean {
    try {
      const { origin } = new URL(url);
      return origin === location.origin || origin === APP_ORIGIN; // the app runs on sevenfriends.web.app in the Android and Windows apps, and links are written with the main address
    } catch {
      return false;
    }
  }

  protected openInApp(event: Event, url: string, message?: ChatMessage): void {
    if (!this.own(url)) return;
    event.preventDefault();
    const target = new URL(url);
    const path = target.pathname + target.search + target.hash;
    if (!message || !/\/safebox(\/|$)/.test(target.pathname)) {
      void this.router.navigateByUrl(path);
      return;
    }
    // a notice about the safebox ("📦 In the safebox: …") is read once. First the box is checked: if the item is not there any more, the notice is taken out of MY feed and nothing opens;
    // if it is there, the page opens and, when the item has really opened, the notice goes (the page of the item tells `NoticeClearService`)
    void this.openSafeboxNotice(path, target.pathname, message);
  }

  private async openSafeboxNotice(path: string, pathname: string, message: ChatMessage): Promise<void> {
    const itemId = /\/safebox\/(?:object\/|note\/|link\/)?([^/]+?)(?:\/(?:new|pictures))?$/.exec(pathname)?.[1];
    let gone = false;
    if (itemId && !['new', 'note', 'object', 'link'].includes(itemId)) {
      try {
        gone = !(await this.safebox.load(this.friendId)).items.some((item) => item.id === itemId);
      } catch {
        gone = false; // no connection or another error: just open it, the notice stays until the item opens
      }
    }
    if (gone) {
      try {
        await this.chat.removeMine(this.friendId, message.id);
        this.messages.update((list) => list.filter((m) => m.id !== message.id));
      } catch { /* the notice stays */ }
      return;
    }
    this.notices.wait(this.friendId, message.id, pathname);
    void this.router.navigateByUrl(path);
  }

  protected parts(text: string): { text: string; url: string | null }[] {
    const result: { text: string; url: string | null }[] = [];
    let last = 0;
    for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      const shown = match[0].replace(/[.,;:!?)\]}]+$/, '');
      if (match.index > last) result.push({ text: text.slice(last, match.index), url: null });
      result.push({ text: shown, url: /^https?:\/\/[^/\s]+/i.test(shown) ? shown : null });
      last = match.index + shown.length;
    }
    if (last < text.length) result.push({ text: text.slice(last), url: null });
    return result;
  }

  /** A tap on a message (mine or the friend's) shows its time and its buttons; a tap on a link, a button or a player inside it does not. */
  /** The middle of a picture (this much of its width and of its height: about 30% of its area) opens it in full; the rest of it works like a tap on the message. */
  private static readonly PICTURE_MIDDLE = 0.55;

  protected pictureTap(message: ChatMessage, media: { ownerId: string; objectId: string }, event: MouseEvent): void {
    event.stopPropagation(); // the tap is handled here (the message below it would toggle itself too)
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = box.width ? (event.clientX - box.left) / box.width : 0.5;
    const y = box.height ? (event.clientY - box.top) / box.height : 0.5;
    const half = Chat.PICTURE_MIDDLE / 2;
    if (Math.abs(x - 0.5) <= half && Math.abs(y - 0.5) <= half) this.openPicture(media);
    else this.select(message);
  }

  protected openPicture(media: { ownerId: string; objectId: string }): void {
    void this.router.navigate(['/media', media.ownerId, media.objectId], { queryParams: { f: this.friendId } });
  }

  protected select(message: ChatMessage, event?: Event): void {
    if ((event?.target as Element | null)?.closest('a, button, video, audio, input')) return;
    this.deleting.set(null);
    this.selected.update((id) => (id === message.id ? null : message.id));
  }

  protected startEdit(message: ChatItem): void {
    if (message.locked === 'shut') {
      this.error.set(tr('chat.thisMessageIsLocked', 'This message is locked for another phone or computer of yours, so it cannot be changed here. Use that device, or get your old messages back under Settings → Privacy lock.'));
      this.selected.set(null);
      return;
    }
    this.editing.set(message.id);
    this.selected.set(null);
    this.editText.set(message.text);
    setTimeout(() => {
      const input = document.getElementById('inline-edit') as HTMLTextAreaElement | null;
      if (!input) return;
      this.grow(input);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  /** The field of the message that is being edited grows with its text. */
  protected grow(input: HTMLTextAreaElement): void {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + (input.offsetHeight - input.clientHeight)}px`; // the text and the border: no scroll bar until the cap (40% of the screen)
  }

  protected cancelEdit(): void {
    this.editing.set(null);
    this.editText.set('');
  }

  /** Save the text of the message that is being edited (a locked message stays locked, with the same key). */
  protected async saveEdit(): Promise<void> {
    const editingId = this.editing();
    const text = this.editText().trim();
    if (!editingId || !text || this.sending()) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      const changed = await this.chat.edit(this.friendId, editingId, text, this.messages().find((m) => m.id === editingId));
      this.messages.update((list) => list.map((m) => (m.id === editingId ? changed : m)));
      this.editing.set(null);
      this.editText.set('');
    } catch (err: any) {
      this.error.set(err.message ?? tr('chat.couldNotSaveThe', 'Could not save the message'));
    } finally {
      this.sending.set(false);
    }
  }

  /** Moves the picture or video of a message to the safebox: the message stays in both feeds and says it is there. */
  protected async toBox(message: ChatMessage): Promise<void> {
    this.error.set(null);
    this.movingBusy.set(true);
    try {
      await this.safebox.addFromMessage(this.friendId, message.id);
      this.messages.update((list) => list.map((m) => (m.id === message.id ? { ...m, media: null, inBox: true } : m)));
      this.selected.set(null);
      this.moving.set(null);
    } catch (err: any) {
      this.error.set(err.message ?? tr('chat.couldNotPutThe', 'Could not put the file in the safebox'));
    } finally {
      this.movingBusy.set(false);
    }
  }

  protected async remove(message: ChatMessage): Promise<void> {
    this.error.set(null);
    try {
      await this.chat.remove(this.friendId, message.id);
      this.messages.update((list) => list.filter((m) => m.id !== message.id));
      this.selected.set(null);
      this.deleting.set(null);
    } catch (err: any) {
      this.error.set(err.message ?? tr('chat.couldNotDeleteThe', 'Could not delete the message'));
    }
  }

  protected toggleSort(): void {
    this.prefs.set('chatOrder', this.sortDesc() ? 'oldest' : 'newest');
    this.scrollDown();
  }

  // Swipe sideways: to the conversation with the next friend (swipe left) or the previous one (swipe right), in the order of the friend list, round robin (the last is followed by the first).
  private swipe: { x: number; y: number; time: number } | null = null;

  @HostListener('document:touchstart', ['$event'])
  protected onTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    // only one finger, and not on something that uses sideways movement itself (text, sliders, players, scrolling strips)
    this.swipe = event.touches.length === 1 && touch && !this.usesSideways(event.target as Element | null) ? { x: touch.clientX, y: touch.clientY, time: Date.now() } : null;
  }

  @HostListener('document:touchend', ['$event'])
  protected onTouchEnd(event: TouchEvent): void {
    const start = this.swipe;
    this.swipe = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || window.getSelection()?.toString()) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // a quick, mostly horizontal, long enough movement
    if (Date.now() - start.time > 700 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
    const friends = this.friendsService.awake();
    const at = friends.findIndex((f) => f.id === this.friendId);
    if (at < 0 || friends.length < 2) return;
    // round robin: after the last friend comes the first, and before the first comes the last
    const next = friends[(at + (dx < 0 ? 1 : -1) + friends.length) % friends.length];
    void this.router.navigate(['/friends', next.id]);
  }

  private usesSideways(element: Element | null): boolean {
    for (let e = element; e && e !== document.body; e = e.parentElement) {
      if (e.matches('input, textarea, select, button, a, audio, video, iframe, [contenteditable], [role="slider"]')) return true;
      if (e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX)) return true;
    }
    return false;
  }

  /** A click somewhere else closes the open things: the delete frame (its criteria are forgotten) and the Edit / Delete buttons of a message. Escape does the same. */
  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    const target = event.target as Element | null;
    if (this.cleanupOpen() && !target?.closest('.sf-cleanup, [aria-controls="cleanup"]')) this.closeCleanup();
    const selected = this.selected();
    if (selected && (target?.closest('.sf-message') as HTMLElement | null)?.dataset['id'] !== selected) {
      this.selected.set(null);
      this.deleting.set(null);
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.closeCleanup();
    this.selected.set(null);
    this.deleting.set(null);
  }

  /** Closes the delete frame; the words to look for are forgotten, whose and how old are remembered (see setWhose, setDays). */
  private closeCleanup(): void {
    if (!this.cleanupOpen()) return;
    this.cleanupOpen.set(false);
    this.cleanupText.set('');
    this.cleanupCount.set(null);
    this.cleanupAsk.set(false);
    this.cleanupDone.set(null);
    clearTimeout(this.countTimer);
    this.countSeq++; // an answer that is still on its way is dropped
  }

  protected toggleCleanup(): void {
    if (this.cleanupOpen()) {
      this.closeCleanup();
      return;
    }
    this.cleanupOpen.set(true);
    this.cleanupDone.set(null);
    window.scrollTo({ top: 0, behavior: 'smooth' }); // the frame is at the top of the page: bring it into view
    this.recount(0);
  }

  protected setWhose(whose: 'mine' | 'both'): void {
    this.cleanupWhose.set(whose);
    this.prefs.set('cleanupWhose', whose);
    this.recount(0);
  }

  protected setDays(days: number | null): void {
    this.cleanupDays.set(days);
    this.prefs.set('cleanupDays', days);
    this.recount(0);
  }

  protected setText(text: string): void {
    this.cleanupText.set(text);
    this.recount(300);
  }

  private criteria(): MessageDeleteCriteria {
    return { whose: this.cleanupWhose(), olderThanDays: this.cleanupDays(), contains: this.cleanupText().trim() || null };
  }

  /** Asks the server how many of my messages match (a moment after the last change). */
  private recount(delay: number): void {
    this.cleanupAsk.set(false);
    this.cleanupCount.set(null);
    clearTimeout(this.countTimer);
    const seq = ++this.countSeq;
    this.countTimer = setTimeout(async () => {
      try {
        const { matched } = await this.chat.deleteMatching(this.friendId, { ...this.criteria(), dryRun: true });
        if (seq === this.countSeq) this.cleanupCount.set(matched);
      } catch (err: any) {
        if (seq === this.countSeq) this.error.set(err.message ?? tr('chat.couldNotCountThe', 'Could not count the messages'));
      }
    }, delay);
  }

  protected async deleteMatching(): Promise<void> {
    this.cleanupBusy.set(true);
    this.error.set(null);
    try {
      const { deleted } = await this.chat.deleteMatching(this.friendId, this.criteria());
      this.cleanupDone.set(`${deleted} ${deleted === 1 ? 'message' : 'messages'} deleted.`);
      await this.refresh(false);
      this.recount(0);
    } catch (err: any) {
      this.error.set(err.message ?? tr('chat.couldNotDeleteThe2', 'Could not delete the messages'));
    } finally {
      this.cleanupBusy.set(false);
      this.cleanupAsk.set(false);
    }
  }

  /** Back to the place the feed was left at (again after a while: pictures and videos take their height when they are loaded). */
  private scrollBack(y: number): void {
    for (const wait of [50, 400, 1200]) setTimeout(() => window.scrollTo({ top: y }), wait);
  }

  private scrollDown(): void {
    // oldest first: the newest is at the bottom; newest first: it is at the top
    // a moment later: the feed and the message field have been drawn in their new places by then. Again after a while: a picture or a
    // video preview takes its height only when it has been loaded, which would leave the new message below the screen.
    for (const wait of [50, 400, 1200]) {
      setTimeout(() => (this.sortDesc() ? window.scrollTo({ top: 0 }) : this.end()?.nativeElement.scrollIntoView({ block: 'end' })), wait);
    }
  }
}
