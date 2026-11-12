import { Injectable, inject } from '@angular/core';
import { ChatService } from './chat.service';

/**
 * A notice about the safebox ("📦 In the safebox: …") is read once. The feed tells this service which notice was tapped (`wait`); the page of the item tells it when the
 * item has really opened (`opened`), and only then the notice is taken out of MY feed (the other person keeps theirs and clears it in the same way).
 * If the item is not there any more (taken out, never found), the notice goes too (`opened` is called then as well); a page that could not open for another reason (no connection) leaves the notice where it is.
 */
@Injectable({ providedIn: 'root' })
export class NoticeClearService {
  private readonly chat = inject(ChatService);
  private waiting: { friendId: string; messageId: string; path: string; at: number } | null = null;

  /** The person tapped "Open the item" on this notice; `path` is the address of the item. */
  wait(friendId: string, messageId: string, path: string): void {
    this.waiting = { friendId, messageId, path, at: Date.now() };
  }

  /** The page at the address of the browser has opened its item, or found that the item is gone. Does nothing unless it is the one a notice was waiting for (a tap is forgotten after two minutes). */
  opened(): void {
    const w = this.waiting;
    if (!w || w.path !== location.pathname || Date.now() - w.at > 120_000) return;
    this.waiting = null;
    void this.chat.removeMine(w.friendId, w.messageId).catch(() => undefined);
  }
}
