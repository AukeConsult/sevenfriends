import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiError } from '../core/api.service';
import { ChatService } from '../core/chat.service';
import { RealtimeService } from '../core/realtime.service';
import { ChatMessage } from '../models';

// New messages arrive live (RealtimeService). This slow refresh is only a safety net.
const SAFETY_REFRESH_MS = 30000;

/** The message feed with one friend: /friends/:id (the id of the connection). */
@Component({
  selector: 'app-chat',
  imports: [DatePipe, RouterLink],
  templateUrl: './chat.html',
  styleUrl: './chat.scss',
})
export class Chat {
  private readonly chat = inject(ChatService);
  private readonly realtime = inject(RealtimeService);
  private lastLive = this.realtime.latestMessage()?.seq ?? 0; // live messages before this page opened are not news
  private readonly end = viewChild<ElementRef<HTMLElement>>('end');

  protected readonly friendId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  protected readonly name = signal('');
  protected readonly messages = signal<ChatMessage[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  /** set when this conversation cannot be opened (not confirmed, or not found) */
  protected readonly blocked = signal<string | null>(null);
  protected readonly text = signal('');
  protected readonly sending = signal(false);

  constructor() {
    this.realtime.openFeed.set(this.friendId); // new messages from this friend come here, not to the Home list
    this.refresh(true);

    // a message from THIS friend arrived: show it at once
    effect(() => {
      const live = this.realtime.latestMessage();
      if (!live || live.seq <= this.lastLive) return;
      this.lastLive = live.seq;
      if (live.connectionId === this.friendId) untracked(() => void this.refresh(false));
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

  protected async send(): Promise<void> {
    const text = this.text().trim();
    if (!text || this.sending()) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      const message = await this.chat.send(this.friendId, text);
      this.messages.update((list) => [...list, message]);
      this.text.set('');
      this.scrollDown();
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not send the message');
    } finally {
      this.sending.set(false);
    }
  }

  private scrollDown(): void {
    setTimeout(() => this.end()?.nativeElement.scrollIntoView({ block: 'end' }));
  }
}
