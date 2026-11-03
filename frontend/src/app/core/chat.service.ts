import { Injectable, inject } from '@angular/core';
import { ChatMessage, Conversation } from '../models';
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

  send(friendId: string, text: string): Promise<ChatMessage> {
    return this.api.request<ChatMessage>(this.base(friendId), { method: 'POST', body: JSON.stringify({ text }) });
  }

  edit(friendId: string, messageId: string, text: string): Promise<ChatMessage> {
    return this.api.request<ChatMessage>(`${this.base(friendId)}/${messageId}`, { method: 'PUT', body: JSON.stringify({ text }) });
  }

  remove(friendId: string, messageId: string): Promise<void> {
    return this.api.request<void>(`${this.base(friendId)}/${messageId}`, { method: 'DELETE' });
  }

  /** Opening the feed marks the other person's messages as read. */
  async markRead(friendId: string): Promise<{ ok: boolean; marked: number }> {
    const result = await this.api.request<{ ok: boolean; marked: number }>(`${this.base(friendId)}/read`, { method: 'POST' });
    this.unread.removeConnection(friendId); // they are read: off the Home list
    return result;
  }
}
