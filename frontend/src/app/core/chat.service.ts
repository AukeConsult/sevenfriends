import { Injectable, inject } from '@angular/core';
import { ChatMessage, Conversation, MessageDeleteCriteria, MessageDeleteResult, MessageLink, NewMedia } from '../models';
import { ApiService } from './api.service';
import { FriendsService } from './friends.service';
import { MessagesService } from './messages.service';

/** The message feed of one connection (the friend id is the connection id). */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly api = inject(ApiService);
  private readonly friends = inject(FriendsService);
  private readonly unread = inject(MessagesService);

  private base(friendId: string): string {
    // the circle is known once the Friends page has been opened; the default circle otherwise
    return `/circles/${this.friends.circle()?.id ?? 'default'}/friends/${friendId}/messages`;
  }

  load(friendId: string): Promise<Conversation> {
    return this.api.request<Conversation>(this.base(friendId));
  }

  /** Sends a message: a text, a file that was uploaded (then the text is its caption), or both. */
  send(friendId: string, text: string, media?: NewMedia): Promise<ChatMessage> {
    return this.api.request<ChatMessage>(this.base(friendId), { method: 'POST', body: JSON.stringify({ text, media }) });
  }

  edit(friendId: string, messageId: string, text: string): Promise<ChatMessage> {
    return this.api.request<ChatMessage>(`${this.base(friendId)}/${messageId}`, { method: 'PUT', body: JSON.stringify({ text }) });
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
