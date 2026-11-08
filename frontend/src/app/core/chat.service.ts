import { Injectable, inject } from '@angular/core';
import { ChatMessage, Conversation, MessageDeleteCriteria, MessageDeleteResult, MessageLink, NewMedia } from '../models';
import { ApiError, ApiService } from './api.service';
import { FriendsService } from './friends.service';
import { ChatItem, MessageLockService, SealedText } from './message-lock.service';
import { MessagesService } from './messages.service';

/** The message feed of one connection (the friend id is the connection id). */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly api = inject(ApiService);
  private readonly friends = inject(FriendsService);
  private readonly unread = inject(MessagesService);
  private readonly lock = inject(MessageLockService);

  private base(friendId: string): string {
    // the circle is known once the Friends page has been opened; the default circle otherwise
    return `/circles/${this.friends.circle()?.id ?? 'default'}/friends/${friendId}/messages`;
  }

  /** The feed; a message that was sent locked comes with its real text when this device can open it (see ChatItem). */
  async load(friendId: string): Promise<Omit<Conversation, 'messages'> & { messages: ChatItem[] }> {
    const conversation = await this.api.request<Conversation>(this.base(friendId));
    return { ...conversation, messages: await this.lock.openAll(friendId, conversation.messages) };
  }

  /**
   * Sends a text or a change of one: locked on this device when both of us have a key and locking is on (the server then never sees the text), plain otherwise.
   * If a key was added or retired while it was being locked the server says so (409) and it is locked again with the new list of keys, once.
   */
  private async lockedRequest(friendId: string, text: string, force: boolean, send: (body: { text: string; enc?: SealedText['enc'] }) => Promise<ChatMessage>): Promise<ChatItem> {
    for (let attempt = 0; ; attempt++) {
      const sealed = await this.lock.seal(friendId, text, force);
      try {
        return await this.lock.open(friendId, await send(sealed ?? { text }));
      } catch (err) {
        if (!(sealed && attempt === 0 && err instanceof ApiError && err.status === 409)) throw err;
      }
    }
  }

  /** Sends a message: a text, a file that was uploaded (then the text is its caption), or both. */
  send(friendId: string, text: string, media?: NewMedia): Promise<ChatItem> {
    return this.lockedRequest(friendId, text, false, (body) => this.api.request<ChatMessage>(this.base(friendId), { method: 'POST', body: JSON.stringify({ ...body, media }) }));
  }

  /**
   * Changes the text of my message. A message that is locked stays locked with the SAME key it has: the new text is locked with it again (a new iv)
   * and only the text and the iv are sent, so the copies of the key do not change. A plain message is changed as it is sent: locked if both of us have a key.
   */
  async edit(friendId: string, messageId: string, text: string, existing?: ChatItem): Promise<ChatItem> {
    const url = `${this.base(friendId)}/${messageId}`;
    if (existing?.enc) {
      const again = await this.lock.reseal(friendId, existing, text);
      return this.lock.open(friendId, await this.api.request<ChatMessage>(url, { method: 'PUT', body: JSON.stringify(again) }));
    }
    return this.lockedRequest(friendId, text, false, (body) => this.api.request<ChatMessage>(url, { method: 'PUT', body: JSON.stringify(body) }));
  }

  /** Hides / shows a picture or video in my feed (kept on my copy of the message, so every device of mine shows it the same). */
  async setHidden(friendId: string, messageId: string, hidden: boolean): Promise<void> {
    await this.api.request<unknown>(`${this.base(friendId)}/${messageId}/hidden`, { method: 'PUT', body: JSON.stringify({ hidden }) });
  }

  /** The link of a text and whether its page can be shown in a frame (the same check the server makes when the message is sent). */
  async previewLink(text: string): Promise<MessageLink | null> {
    const { link } = await this.api.request<{ link: MessageLink | null }>('/link-preview', { method: 'POST', body: JSON.stringify({ text }) });
    return link;
  }

  remove(friendId: string, messageId: string): Promise<void> {
    return this.api.request<void>(`${this.base(friendId)}/${messageId}`, { method: 'DELETE' });
  }

  /** Deletes (or, with `dryRun`, only counts) several of my messages at once. */
  deleteMatching(friendId: string, criteria: MessageDeleteCriteria): Promise<MessageDeleteResult> {
    return this.api.request<MessageDeleteResult>(`${this.base(friendId)}/delete`, { method: 'POST', body: JSON.stringify(criteria) });
  }

  /** Opening the feed marks the other person's messages as read. */
  async markRead(friendId: string): Promise<{ ok: boolean; marked: number }> {
    const result = await this.api.request<{ ok: boolean; marked: number }>(`${this.base(friendId)}/read`, { method: 'POST' });
    this.unread.removeConnection(friendId); // they are read: off the Home list
    return result;
  }
}
