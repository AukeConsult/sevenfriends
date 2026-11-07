import { Clearable } from '../core/clearable';
import { DatePipe } from '@angular/common';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../core/api.service';
import { SafeboxService } from '../core/safebox.service';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { MediaAudio } from '../media-audio/media-audio';
import { MediaImage } from '../media-image/media-image';
import { MediaVideo } from '../media-video/media-video';
import { AuthService } from '../core/auth.service';
import { ChatService } from '../core/chat.service';
import { MyAvatarService } from '../core/my-avatar.service';
import { MediaService } from '../core/media.service';
import { LiveChanges } from '../core/live-changes';
import { UiPreferencesService } from '../core/ui-preferences';
import { EMOJI_GROUPS } from '../core/emojis';
import { FriendsService } from '../core/friends.service';
import { initials } from '../core/initials';
import { presenceLabel } from '../core/presence';
import { moodIcon, moodLabel } from '../core/moods';
import { RealtimeService } from '../core/realtime.service';
import { ChatMessage, MessageDeleteCriteria, MessageLink, profileColorHex, profileColorInk, profileColorSoft } from '../models';

// New messages, edits and deletes arrive live (RealtimeService). This refresh is only a safety net.
const SAFETY_REFRESH_MS = 30000;

/** The message feed with one friend: /friends/:id (the id of the connection). */
@Component({
  selector: 'app-chat',
  imports: [DatePipe, FriendAvatar, MediaAudio, MediaImage, MediaVideo, NgTemplateOutlet, RouterLink, Clearable],
  templateUrl: './chat.html',
  // the page takes a light colour that goes with my friend's colour (the header has the friend's own colour)
  host: {
    '[class.sf-feed-tinted]': '!!feedBackground()',
    '[style.--sf-feed-bg]': 'feedBackground()',
    '[style.--sf-friend]': 'friendColor()',
    '[style.--sf-friend-ink]': 'friendInk()',
    '[style.--sf-my]': 'myColor()',
    '[style.--sf-my-ink]': 'myInk()',
  },
})
export class Chat {
  private readonly chat = inject(ChatService);
  private readonly safebox = inject(SafeboxService);
  private readonly prefs = inject(UiPreferencesService);
  private readonly live = inject(LiveChanges);
  private readonly mediaService = inject(MediaService);
  private readonly realtime = inject(RealtimeService);
  private readonly friendsService = inject(FriendsService);
  private readonly router = inject(Router);
  private lastLive = this.realtime.latestMessage()?.seq ?? 0; // live messages before this page opened are not news
  private readonly end = viewChild<ElementRef<HTMLElement>>('end');
  private readonly field = viewChild<ElementRef<HTMLTextAreaElement>>('field');
  private readonly composer = viewChild<ElementRef<HTMLElement>>('composer');
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');

  protected readonly friendId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  protected readonly name = signal('');
  protected readonly presenceLabel = presenceLabel;
  protected readonly moodIcon = moodIcon;
  protected readonly moodLabel = moodLabel;
  protected readonly initials = initials;
  /** this friend, from the list (for the mood) */
  /** the colour my friend chose for their profile (#rrggbb), or null */
  protected readonly friendColor = computed(() => profileColorHex(this.friend()?.color));
  protected readonly friendInk = computed(() => profileColorInk(this.friend()?.color));
  /** a very light tint of my friend's colour: the background of the conversation */
  protected readonly feedBackground = computed(() => profileColorSoft(this.friend()?.color));
  /** my own colour for my bubbles, and the text colour on it */
  protected readonly myColor = computed(() => profileColorHex(this.myAvatarService.color()));
  protected readonly myInk = computed(() => profileColorInk(this.myAvatarService.color()));
  protected readonly friend = computed(() => this.friendsService.friends().find((f) => f.id === this.friendId) ?? null);
  /** the seat of this friend (1-7): its icon friend{seat}.svg is shown in the header; 0 while the list is not loaded */
  protected readonly seat = computed(() => this.friendsService.awake().findIndex((f) => f.id === this.friendId) + 1);
  protected readonly messages = signal<ChatMessage[]>([]);
  /** false = oldest first (the default); true = newest first. Remembered on this device. */
  /** newest first? (a remembered choice, the same in every window; a refresh of the feed never changes it) */
  /** the Enter key sends the message (a preference) */
  protected readonly enterSends = this.prefs.value('enterSends');
  /** a picture next to every message (a preference) */
  protected readonly feedIcons = this.prefs.value('feedIcons');
  private readonly myAvatarService = inject(MyAvatarService);
  protected readonly myAvatar = this.myAvatarService.src;
  private readonly me = inject(AuthService).user;
  protected readonly myInitials = computed(() => initials(this.me()?.displayName ?? this.me()?.email ?? this.me()?.phoneNumber));
  /** the ready-made messages of the + menu (a preference) */
  protected readonly quickMessages = this.prefs.value('quickMessages');
  protected readonly sortDesc = computed(() => this.prefs.value('chatOrder')() === 'newest');
  protected readonly shown = computed(() => (this.sortDesc() ? [...this.messages()].reverse() : this.messages()));

  // deleting several of my messages: the expanding frame under the header
  protected readonly ageChoices: { label: string; days: number | null; icon: string }[] = [
    { label: 'Older than a day', days: 1, icon: 'day' },
    { label: 'Older than a week', days: 7, icon: 'week' },
    { label: 'Older than a month', days: 30, icon: 'month' },
    { label: 'All of them', days: null, icon: 'all' },
  ];
  protected readonly cleanupOpen = signal(false);
  protected readonly cleanupWhose = signal<'mine' | 'both'>('mine');
  /** my messages, or both sides' (never the friend's alone) */
  protected readonly whoseChoices = computed<{ value: 'mine' | 'both'; label: string }[]>(() => [
    { value: 'mine', label: 'My messages' },
    { value: 'both', label: `Both: mine and ${this.name() || 'my friend'}'s` },
  ]);
  protected readonly cleanupDays = signal<number | null>(30);
  protected readonly cleanupText = signal('');
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
      if (text && !m.text.toLowerCase().includes(text)) continue;
      ids.add(m.id);
    }
    return ids;
  });
  private countTimer: ReturnType<typeof setTimeout> | undefined;
  private countSeq = 0;
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  /** set when this conversation cannot be opened (not confirmed, or not found) */
  protected readonly blocked = signal<string | null>(null);
  protected readonly text = signal('');
  protected readonly sending = signal(false);
  protected readonly emojiGroups = EMOJI_GROUPS;
  /** the tab of the emoji picker that is open (People first) */
  /** the group open in the emoji picker: the one used last (remembered on this device), People when there is none */
  protected readonly emojiGroup = signal(EMOJI_GROUPS.some((g) => g.name === this.prefs.get('emojiTab')) ? this.prefs.get('emojiTab') : 'People');
  protected chooseEmojiGroup(name: string): void {
    this.emojiGroup.set(name);
    this.prefs.set('emojiTab', name);
  }
  protected readonly emojisOfGroup = computed(() => EMOJI_GROUPS.find((g) => g.name === this.emojiGroup())?.emojis ?? []);
  /** the emoji panel above the message field */
  protected readonly emojiOpen = signal(false);
  /** the menu of the smiley and the paperclip button */
  protected readonly menuOpen = signal(false);
  /** the menu of the three dots in the header (sort order, clean up) */
  protected readonly moreOpen = signal(false);
  private menuPinned = false; // opened by a click or tap: it stays until the next click, instead of closing when the mouse leaves

  /** which menu is open: the smiley (emoji, quick messages) or the paperclip (image, video, voice) */
  protected readonly menuKind = signal<'emoji' | 'attach'>('emoji');

  protected toggleMenu(kind: 'emoji' | 'attach'): void {
    if (kind === 'emoji' && !this.quickMessages().length) { // no ready-made messages: the smiley opens the emojis at once, no menu
      this.menuOpen.set(false);
      this.moreOpen.set(false);
      this.emojiOpen.set(!this.emojiOpen());
      return;
    }
    if (this.menuOpen() && this.menuKind() === kind && this.menuPinned) {
      this.menuOpen.set(false);
      this.menuPinned = false;
      return;
    }
    this.emojiOpen.set(false); // only one thing is open at a time: the picker and the header menu close
    this.moreOpen.set(false);
    this.menuKind.set(kind);
    this.menuPinned = true; // opened by a click or tap: it stays until the next click
    this.menuOpen.set(true);
  }

  /** The three dots of the header: opening its menu closes the emoji picker and the smiley / paperclip menu (only one is open at a time). */
  protected toggleMore(): void {
    const open = !this.moreOpen();
    this.moreOpen.set(open);
    if (open) {
      this.menuOpen.set(false);
      this.emojiOpen.set(false);
    }
  }

  /** A mouse over a button opens its menu (or the emoji picker) and closes the other one; leaving closes the menu (a finger has no hover: it taps). */
  protected hoverMenu(inside: boolean, kind?: 'emoji' | 'attach'): void {
    if (!window.matchMedia('(any-hover: hover)').matches) return;
    if (!inside) {
      if (!this.menuPinned) this.menuOpen.set(false);
      return;
    }
    if (!kind) return;
    this.moreOpen.set(false);
    if (kind === 'attach') {
      this.emojiOpen.set(false); // the emoji picker closes when the paperclip opens
      if (this.menuKind() !== 'attach') this.menuPinned = false;
      this.menuKind.set('attach');
      this.menuOpen.set(true);
    } else if (!this.quickMessages().length) { // no menu to show: the emoji picker opens (and stays until the next click or typing)
      this.menuOpen.set(false);
      this.menuPinned = false;
      this.emojiOpen.set(true);
    } else {
      this.emojiOpen.set(false);
      if (this.menuKind() !== 'emoji') this.menuPinned = false;
      this.menuKind.set('emoji');
      this.menuOpen.set(true);
    }
  }
  /** my message whose Edit / Delete buttons are open (tap a message of mine) */
  protected readonly selected = signal<string | null>(null);
  /** my message that is being deleted (the question is open) */
  protected readonly deleting = signal<string | null>(null);
  /** the picture or video whose "move to the safebox" question is open, and whether it is being moved */
  protected readonly moving = signal<string | null>(null);
  protected readonly movingBusy = signal(false);
  /** my message that is being edited: the message field holds its text, and Send saves it */
  protected readonly editing = signal<string | null>(null);
  /** the height of the message field with its panel: the feed keeps this much room at the bottom, so no message hides behind it */
  protected readonly composerHeight = signal(64);
  /** the height of the header: the message field sticks right under it when the newest message is on top */
  protected readonly barHeight = signal(56);

  constructor() {
    if (!this.friendsService.friends().length) void this.friendsService.load().catch(() => undefined); // opened directly (a reload): the seat comes from the list
    this.realtime.openFeed.set(this.friendId); // new messages from this friend come here, not to the Home list
    this.refresh(true);
    if (this.prefs.get('feedIcons')) void this.myAvatarService.load();

    // a message from THIS friend arrived: show it at once
    effect(() => {
      const live = this.realtime.latestMessage();
      if (!live || live.seq <= this.lastLive) return;
      this.lastLive = live.seq;
      if (live.connectionId === this.friendId) untracked(() => void this.refresh(false));
    });

    // a link in the message field: check it after the last key press
    effect(() => {
      const text = this.text();
      untracked(() => this.watchDraft(text));
    });

    // the header's height (it changes with the notch and the font size)
    effect((onCleanup) => {
      const header = this.bar()?.nativeElement;
      if (!header) return;
      const watch = new ResizeObserver(() => this.barHeight.set(header.offsetHeight));
      watch.observe(header);
      onCleanup(() => watch.disconnect());
    });

    // the message field grows with its text: keep the feed clear of it
    effect((onCleanup) => {
      const form = this.composer()?.nativeElement;
      if (!form) return;
      const watch = new ResizeObserver(() => this.composerHeight.set(form.offsetHeight));
      watch.observe(form);
      onCleanup(() => watch.disconnect());
    });

    // the messages of this friendship changed (the friend edited or deleted one, or I did on another device): show it at once
    this.live.on('feed').pipe(takeUntilDestroyed()).subscribe((change) => {
      if (change.connectionId === this.friendId) void this.refresh(false);
    });

    const timer = setInterval(() => this.refresh(false), SAFETY_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      if (this.realtime.openFeed() === this.friendId) this.realtime.openFeed.set(null);
    });
  }

  private async refresh(first: boolean): Promise<void> {
    try {
      const res = await this.chat.load(this.friendId);
      const known = new Set(this.messages().map((m) => m.id));
      const changed = first || res.messages.some((m) => !known.has(m.id)) || res.messages.length !== known.size; // a new message (also when one was deleted at the same time)
      this.name.set(res.friend.name);
      this.messages.set(res.messages);
      this.blocked.set(null);
      if (first) this.error.set(null);

      if (res.messages.some((m) => !m.mine && !m.read)) {
        await this.chat.markRead(this.friendId); // I am looking at them now
        this.messages.update((list) => list.map((m) => ({ ...m, read: true })));
      }
      if (changed) this.scrollDown();
    } catch (err: any) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) this.blocked.set(err.message);
      else if (first) this.error.set(err.message ?? 'Could not load the conversation');
    } finally {
      this.loaded.set(true);
    }
  }

  /** The link in the text that is being written (checked a moment after the last key press), and whether its preview is open. */
  protected readonly draftLink = signal<MessageLink | null>(null);
  protected readonly draftOpen = signal(false);
  private draftDismissed: string | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;
  private draftSeq = 0;

  protected dismissDraftLink(): void {
    this.draftDismissed = this.draftLink()?.url ?? null; // the same link does not come back while it stays in the text
    this.draftLink.set(null);
    this.draftOpen.set(false);
  }

  /** The text changed: look for a link in it. */
  private watchDraft(text: string): void {
    clearTimeout(this.draftTimer);
    const url = this.parts(text).find((p) => p.url)?.url ?? null;
    if (!url || this.editing()) {
      this.draftSeq++;
      this.draftLink.set(null);
      this.draftOpen.set(false);
      this.draftDismissed = null;
      return;
    }
    if (url === this.draftLink()?.url || url === this.draftDismissed) return;
    const seq = ++this.draftSeq;
    this.draftTimer = setTimeout(async () => {
      try {
        const link = await this.chat.previewLink(text);
        if (seq === this.draftSeq) this.draftLink.set(link);
      } catch {
        if (seq === this.draftSeq) this.draftLink.set(null); // not checked: nothing is shown, the message still goes
      }
    }, 700);
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

  /** Saves the image, video or voice message of a message on this device (works for my own and for the friend's). */
  protected async download(media: NonNullable<ChatMessage['media']>): Promise<void> {
    try {
      const file = await this.mediaService.object(media.ownerId, media.objectId);
      const name = file.name || 'file';
      const extension = file.type.split('/')[1]?.split(';')[0].replace('jpeg', 'jpg').replace('quicktime', 'mov');
      const link = document.createElement('a');
      link.href = file.url;
      link.download = /\.[A-Za-z0-9]{2,5}$/.test(name) || !extension ? name : `${name}.${extension}`;
      link.click();
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not download the file');
    }
  }

  /** The three dots under a picture, video or voice message: its buttons open under it (any message, also my friend's). */
  protected more(message: ChatMessage): void {
    this.deleting.set(null);
    this.selected.update((id) => (id === message.id ? null : message.id));
  }

  /** Copy the text of a message to the clipboard, and close its buttons. */
  protected async copy(message: ChatMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(message.text);
    } catch {
      this.error.set('Could not copy the text');
    }
    this.selected.set(null);
  }

  protected select(message: ChatMessage): void {
    if (!message.mine && !message.inBox) return; // the note of a file moved to the safebox may be removed by either friend
    this.deleting.set(null);
    this.selected.update((id) => (id === message.id ? null : message.id));
  }

  protected startEdit(message: ChatMessage): void {
    this.editing.set(message.id);
    this.selected.set(null);
    this.text.set(message.text);
    setTimeout(() => {
      const input = this.field()?.nativeElement;
      if (!input) return;
      input.value = message.text;
      this.fit();
      input.focus();
    });
  }

  protected cancelEdit(): void {
    this.editing.set(null);
    this.text.set('');
    setTimeout(() => this.fit());
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
      this.error.set(err.message ?? 'Could not put the file in the safebox');
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
      this.error.set(err.message ?? 'Could not delete the message');
    }
  }

  protected async send(): Promise<void> {
    const text = this.text().trim();
    if (!text || this.sending()) return;
    const editingId = this.editing();
    this.sending.set(true);
    this.error.set(null);
    try {
      if (editingId) {
        const changed = await this.chat.edit(this.friendId, editingId, text);
        this.messages.update((list) => list.map((m) => (m.id === editingId ? changed : m)));
        this.editing.set(null);
      } else {
        const message = await this.chat.send(this.friendId, text);
        this.messages.update((list) => [...list, message]);
      }
      this.text.set('');
      this.emojiOpen.set(false);
      setTimeout(() => this.fit());
      this.scrollDown();
    } catch (err: any) {
      this.error.set(err.message ?? (editingId ? 'Could not save the message' : 'Could not send the message'));
    } finally {
      this.sending.set(false);
    }
  }

  /** A ready-made message from the + menu: sent at once. What is typed in the field stays as it is. */
  protected async sendQuick(text: string): Promise<void> {
    this.menuOpen.set(false);
    this.menuPinned = false;
    if (this.sending() || this.editing()) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      const message = await this.chat.send(this.friendId, text);
      this.messages.update((list) => [...list, message]);
      this.scrollDown();
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not send the message');
    } finally {
      this.sending.set(false);
    }
  }

  /** The field grew or shrank with what was typed. */
  protected typed(): void {
    const input = this.field()?.nativeElement;
    if (!input) return;
    this.text.set(input.value);
    this.fit();
  }

  /** Enter is a new line (the browser does that); Ctrl+Enter or Cmd+Enter sends, like the Send button. */
  protected enterPressed(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.isComposing) return; // a letter is still being composed (Enter confirms it)
    // autosend: Enter sends, Shift+Enter is a new line; otherwise only Ctrl / Cmd + Enter sends
    const sends = this.enterSends() ? !key.shiftKey : key.ctrlKey || key.metaKey;
    if (!sends) return;
    key.preventDefault();
    void this.send();
  }

  /** The field is as high as its text (it opens upwards: the form sits at the bottom of the screen), up to a few lines. */
  private fit(): void {
    const input = this.field()?.nativeElement;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }

  /**
   * Puts the emoji where the cursor is in the message field (at the end when the field was not used yet). The panel stays open, so
   * several emojis can be added one after the other: it closes when the person taps the field, types, sends, or taps the emoji button.
   * The field is not focused here (that would close the panel, and on a phone open the keyboard over it): the cursor is only moved.
   */
  protected addEmoji(emoji: string): void {
    const input = this.field()?.nativeElement;
    const value = this.text();
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    const next = value.slice(0, start) + emoji + value.slice(end);
    if (next.length > 2000) return; // the same limit as the field (the server checks it too)
    this.text.set(next);
    if (input) {
      input.value = next;
      const caret = start + emoji.length;
      input.setSelectionRange(caret, caret); // the next emoji (or the next letter) goes after this one
      this.fit();
    }
  }

  protected toggleSort(): void {
    this.prefs.set('chatOrder', this.sortDesc() ? 'oldest' : 'newest');
    this.scrollDown();
  }

  // Swipe sideways: to the conversation with the next friend (swipe left) or the previous one (swipe right), in the order of the friend list.
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
    const next = friends[friends.findIndex((f) => f.id === this.friendId) + (dx < 0 ? 1 : -1)];
    if (next) void this.router.navigate(['/friends', next.id]);
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
    if (this.menuOpen() && !target?.closest('.sf-add')) {
      this.menuOpen.set(false);
      this.menuPinned = false;
    }
    if (this.moreOpen() && !target?.closest('.sf-more')) this.moreOpen.set(false);
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

  /** Closes the delete frame and forgets what was chosen in it (the next opening starts fresh). */
  private closeCleanup(): void {
    if (!this.cleanupOpen()) return;
    this.cleanupOpen.set(false);
    this.cleanupWhose.set('mine');
    this.cleanupDays.set(30);
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
    this.recount(0);
  }

  protected setDays(days: number | null): void {
    this.cleanupDays.set(days);
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
        if (seq === this.countSeq) this.error.set(err.message ?? 'Could not count the messages');
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
      this.error.set(err.message ?? 'Could not delete the messages');
    } finally {
      this.cleanupBusy.set(false);
      this.cleanupAsk.set(false);
    }
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
