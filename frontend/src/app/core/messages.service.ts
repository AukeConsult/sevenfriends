import { Injectable, inject, signal } from '@angular/core';
import { Message } from '../models';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class MessagesService {
  private readonly api = inject(ApiService);

  /** Unread incoming messages, newest first. */
  readonly messages = signal<Message[]>([]);

  async load(): Promise<void> {
    const res = await this.api.request<{ messages: Message[] }>('/messages');
    this.messages.set(res.messages);
  }

  /** The feed of this connection was read: its messages no longer belong in the unread list. */
  removeConnection(connectionId: string): void {
    this.messages.update((list) => list.filter((m) => m.connectionId !== connectionId));
  }

  async markRead(id: string): Promise<void> {
    await this.api.request<void>(`/messages/${id}/read`, { method: 'POST' });
    this.messages.update((list) => list.filter((m) => m.id !== id));
  }
}
