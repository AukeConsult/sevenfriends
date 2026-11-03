import { Clearable } from '../core/clearable';
import { DatePipe } from '@angular/common';
import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiError } from '../core/api.service';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { MediaImage } from '../media-image/media-image';
import { ChatService } from '../core/chat.service';
import { EMOJIS } from '../core/emojis';
import { FriendsService } from '../core/friends.service';
import { moodIcon, moodLabel } from '../core/moods';
import { presenceLabel } from '../core/presence';
import { RealtimeService } from '../core/realtime.service';
import { ChatMessage, MessageDeleteCriteria } from '../models';

// New messages, edits and deletes arrive live (RealtimeService). This refresh is only a safety net.
const SAFETY_REFRESH_MS = 30000;

const SORT_KEY = 'sf-chat-order';

function readNewestFirst(): boolean {
  try {
    return localStorage.getItem(SORT_KEY) === 'newest';
  } catch {
    return false;
  }
}

/** The message feed with one friend: /friends/:id (the id of the connection). */
@Component({
  selector: 'app-chat',
  imports: [DatePipe, FriendAvatar, MediaImage, NgTemplateOutlet, RouterLink, Clearable],
  templateUrl: './chat.html',
})
export class Chat {
  private readonly chat = inject(ChatService);
  private readonly realtime = inject(RealtimeService);
  private readonly friendsService = inject(FriendsService);
  private lastChange = this.realtime.feedChanged()?.seq ?? 0;
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
  protected readonly seat = computed(() => this.friendsService.friends().findIndex((f) => f.id === this.friendId) + 1);
  protected readonly messages = signal<ChatMessage[]>([]);
  /** false = oldest first (the default); true = newest first. Remembered on this device. */
  protected readonly sortDesc = signal(readNewestFirst());
  protected readonly shown = computed(() => (this.sortDesc() ? [...this.messages()].reverse() : this.messages()));

  // deleting several of my messages: the expanding frame under the header
  protected readonly ageChoices: { label: string; days: number | null }[] = [
    { label: 'Older than a day', days: 1 },
    { label: 'Older than a week', days: 7 },
    { label: 'Older than a month', days: 30 },
    { label: 'All of them', days: null },
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

    // the friend edited or deleted a message: show it at once
    effect(() => {
      const change = this.realtime.feedChanged();
      if (!change || change.seq <= this.lastChange) return;
      this.lastChange = change.seq;
      if (change.connectionId === this.friendId) untracked(() => void this.refresh(false));
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
    this.sortDesc.update((desc) => !desc);
    try {
      localStorage.setItem(SORT_KEY, this.sortDesc() ? 'newest' : 'oldest');
    } catch {
      /* private mode: the choice lasts until the page is closed */
    }
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
