import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

export interface Message {
  id: string;
  fromName: string;
  text: string;
  /** when the message was sent */
  time: string | null;
}

@Injectable({ providedIn: 'root' })
export class MessagesService {
  private readonly api = inject(ApiService);

  /** Unread incoming messages, newest first. */
  readonly messages = signal<Message[]>([]);

  async load(): Promise<void> {
    const res = await this.api.request<{ messages: Message[] }>('/messages');
    this.messages.set(res.messages);
  }

  async markRead(id: string): Promise<void> {
    await this.api.request<void>(`/messages/${id}/read`, { method: 'POST' });
    this.messages.update((list) => list.filter((m) => m.id !== id));
  }
}
