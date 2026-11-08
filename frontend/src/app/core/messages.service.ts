import { Injectable, inject, signal } from '@angular/core';
import { Message } from '../models';
import { ActiveCircleService } from './active-circle.service';
import { ApiService } from './api.service';

@Injectable({ providedIn: 'root' })
export class MessagesService {
  private readonly api = inject(ApiService);
  private readonly active = inject(ActiveCircleService);

  /** Unread incoming messages, newest first. */
  readonly messages = signal<Message[]>([]);

  async load(): Promise<void> {
    const res = await this.api.request<{ messages: Message[] }>('/messages');
    this.replace(res.messages);
  }

  /** The unread list, from the server: only the messages of the circle this app is in (an app is blind to the other circles). */
  replace(list: Message[]): void {
    this.messages.set(list.filter((m) => (m.circleId ?? 'default') === this.active.id));
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
