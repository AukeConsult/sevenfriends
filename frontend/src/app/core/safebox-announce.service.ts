import { Injectable, inject } from '@angular/core';
import { ChatService } from './chat.service';
import { tr } from './i18n';
import { UiPreferencesService } from './ui-preferences';

/**
 * Tells my friend (or my group) that I added something to the safebox: a regular chat message ("📦 In the safebox: Note – Title", then the address of the item on a
 * line of its own), locked and signed like every message, with its sound and push. Used by the pages that make an item and by the bell in an item. It can be switched off
 * under Settings → Preferences (`boxTellNew`); a failure to send is never an error for the item itself.
 */
@Injectable({ providedIn: 'root' })
export class SafeboxAnnounceService {
  private readonly chat = inject(ChatService);
  private readonly prefs = inject(UiPreferencesService);

  /** The text of the message for an item (`path` = the page of the item). */
  text(what: string, title: string, path: string[]): string {
    const item = [what.trim(), title.trim()].filter(Boolean).join(' – ');
    const text = tr('safebox.tell.message', '📦 In the safebox: {{ item }}', { item });
    return path.length ? `${text}\n${location.origin}${path.join('/')}` : text;
  }

  /** Sends the message (the bell in an item calls this and shows the error). */
  send(friendId: string, what: string, title: string, path: string[]): Promise<unknown> {
    return this.chat.send(friendId, this.text(what, title, path), false, true); // a notice: the others get it, I keep no copy in my own feed
  }

  /** After something was ADDED: tells the friend or group when the person wants that. Quiet: nothing is thrown. */
  async added(friendId: string, what: string, title: string, path: string[]): Promise<void> {
    if (!this.prefs.get('boxTellNew')) return;
    try {
      await this.send(friendId, what, title, path);
    } catch {
      /* the item is saved; the bell in the item can tell them later */
    }
  }

  /** After several files were added at once: one message for all of them. */
  async addedFiles(friendId: string, names: string[], single: string[]): Promise<void> {
    if (!names.length) return;
    if (names.length === 1) return this.added(friendId, '', names[0], single);
    return this.added(friendId, '', tr('safebox.tell.files', '{{ count }} files', { count: names.length }), ['/friends', friendId, 'safebox']);
  }
}
