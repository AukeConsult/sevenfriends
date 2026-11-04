import { Clearable } from '../core/clearable';
import { DatePipe } from '@angular/common';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiError } from '../core/api.service';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { MediaAudio } from '../media-audio/media-audio';
import { MediaImage } from '../media-image/media-image';
import { MediaVideo } from '../media-video/media-video';
import { ChatService } from '../core/chat.service';
import { MediaService } from '../core/media.service';
import { LiveChanges } from '../core/live-changes';
import { UiPreferencesService } from '../core/ui-preferences';
import { EMOJIS } from '../core/emojis';
import { FriendsService } from '../core/friends.service';
import { countries } from '../core/countries';
import { moodIcon, moodLabel } from '../core/moods';
import { presenceLabel } from '../core/presence';
import { RealtimeService } from '../core/realtime.service';
import { SOCIAL_NETWORKS } from '../core/social';
import { ChatMessage, MessageDeleteCriteria, MessageLink } from '../models';

// New messages, edits and deletes arrive live (RealtimeService). This refresh is only a safety net.
const SAFETY_REFRESH_MS = 30000;

/** The message feed with one friend: /friends/:id (the id of the connection). */
@Component({
  selector: 'app-chat',
  imports: [DatePipe, FriendAvatar, MediaAudio, MediaImage, MediaVideo, NgTemplateOutlet, RouterLink, Clearable],
  templateUrl: './chat.html',
})
export class Chat {
  private readonly chat = inject(ChatService);
  private readonly prefs = inject(UiPreferencesService);
  private readonly live = inject(LiveChanges);
  private readonly mediaService = inject(MediaService);
  private readonly realtime = inject(RealtimeService);
  private readonly friendsService = inject(FriendsService);
  private lastLive = this.realtime.latestMessage()?.seq ?? 0; // live messages before this page opened are not news
  private readonly end = viewChild<ElementRef<HTMLElement>>('end');
  private readonly field = viewChild<ElementRef<HTMLTextAreaElement>>('field');
  private readonly composer = viewChild<ElementRef<HTMLElement>>('composer');
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');

  protected readonly friendId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  protected readonly name = signal('');
  protected readonly moodIcon = moodIcon;
  protected readonly moodLabel = moodLabel;
  protected readonly presenceLabel = presenceLabel;
  /** this friend, from the list (for the mood) */
  protected readonly friend = computed(() => this.friendsService.friends().find((f) => f.id === this.friendId) ?? null);
  /** the seat of this friend (1-7): its icon friend{seat}.svg is shown in the header; 0 while the list is not loaded */
  protected readonly seat = computed(() => this.friendsService.awake().findIndex((f) => f.id === this.friendId) + 1);
  protected readonly messages = signal<ChatMessage[]>([]);
  /** false = oldest first (the default); true = newest first. Remembered on this device. */
  /** newest first? (a remembered choice, the same in every window; a refresh of the feed never changes it) */
  protected readonly sortDesc = computed(() => this.prefs.value('chatOrder')() === 'newest');
  protected readonly shown = computed(() => (this.sortDesc() ? [...this.messages()].reverse() : this.messages()));

  // deleting several of my messages: the expanding frame under the header
  protected readonly ageChoices: { label: string; days: number | null }[] = [
    { label: 'Older than a day', days: 1 },
    { label: 'Older than a week', days: 7 },
    { label: 'Older than a month', days: 30 },
    { label: 'All of them', days: null },
  ];
  protected readonly cleanupOpen = signal(false);
  /** the profile of the friend, opened by tapping the name in the header */
  protected readonly profileOpen = signal(false);
  protected readonly networks = SOCIAL_NETWORKS;
  private readonly countryNames = new Map(countries().map((c) => [c.code, c.name]));
  protected toggleProfile(): void {
    this.profileOpen.update((open) => !open);
    if (this.profileOpen()) window.scrollTo({ top: 0, behavior: 'smooth' }); // the frame is at the top of the page: bring it into view
  }
  protected countryName(code: string | null): string {
    return (code && this.countryNames.get(code)) || '';
  }
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
  protected readonly emojis = EMOJIS;
  /** the emoji panel above the message field */
  protected readonly emojiOpen = signal(false);
  /** my message whose Edit / Delete buttons are open (tap a message of mine) */
  protected readonly selected = signal<string | null>(null);
  /** my message that is being deleted (the question is open) */
  protected readonly deleting = signal<string | null>(null);
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
      const changed = first || res.messages.length !== this.messages().length;
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
  /** The pictures and videos the person has hidden in the feed (they are shown until hidden). */
  protected readonly pictureHidden = signal<ReadonlySet<string>>(new Set());

  protected togglePicture(id: string): void {
    this.pictureHidden.update((hidden) => {
      const next = new Set(hidden);
      if (!next.delete(id)) next.add(id);
      return next;
    });
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

  protected select(message: ChatMessage): void {
    if (!message.mine) return;
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
    if (!(key.ctrlKey || key.metaKey) || key.isComposing) return;
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

  /** Puts the emoji where the cursor is in the message field (at the end when the field was not used yet). */
  protected addEmoji(emoji: string): void {
    const input = this.field()?.nativeElement;
    const value = this.text();
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    const next = value.slice(0, start) + emoji + value.slice(end);
    if (next.length > 2000) return; // the same limit as the field (the server checks it too)
    this.text.set(next);
    this.emojiOpen.set(false); // one emoji per opening
    if (input) {
      input.value = next;
      const caret = start + emoji.length;
      input.focus();
      input.setSelectionRange(caret, caret); // keep typing after the emoji
      this.fit();
    }
  }

  protected toggleSort(): void {
    this.prefs.set('chatOrder', this.sortDesc() ? 'oldest' : 'newest');
    this.scrollDown();
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
    // a moment later: the feed and the message field have been drawn in their new places by then
    setTimeout(() => (this.sortDesc() ? window.scrollTo({ top: 0 }) : this.end()?.nativeElement.scrollIntoView({ block: 'end' })), 50);
  }
}
