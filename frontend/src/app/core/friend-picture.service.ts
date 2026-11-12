import { ActiveCircleService } from './active-circle.service';
import { Injectable, inject, signal } from '@angular/core';
import { ProfilePicture } from '../models';
import { ApiService } from './api.service';
import { FriendsService } from './friends.service';

/**
 * The uploaded pictures of my friends. The friend list only says WHICH picture it is (`pictureId` / `pictureAt`); the picture
 * itself (a small data URL) is asked for from the server again every time the friend list is loaded (opening Home or a
 * conversation, coming back to the app, a change seen live). There is no lasting cache: what is here is only what is shown
 * until the new answer arrives, so nothing flickers.
 */
@Injectable({ providedIn: 'root' })
export class FriendPictureService {
  private readonly active = inject(ActiveCircleService);
  private readonly api = inject(ApiService);
  private readonly friends = inject(FriendsService);

  /** the pictures that are here: "friendId@pictureAt" -> data URL */
  private readonly pictures = signal<Record<string, string>>({});
  private readonly asked = new Set<string>();
  /** counts the friend-list loads; every load makes every picture be asked for again */
  private readonly round = signal(0);

  constructor() {
    this.active.onSwitch(() => {
      this.pictures.set({});
      this.asked.clear();
    });
    this.friends.onLoaded(() => {
      this.asked.clear(); // ask again for every picture that is shown
      this.round.update((n) => n + 1);
    });
  }

  /** The picture of this friend once it is here (asks for it the first time); null while it is on its way, or when there is none. */
  src(friendId: string, pictureAt: string | null): string | null {
    if (!pictureAt) return null;
    this.round(); // read it, so every picture on the screen asks again after a load
    const key = `${friendId}@${pictureAt}`;
    if (!this.asked.has(key)) {
      this.asked.add(key);
      void this.load(friendId, key, pictureAt);
    }
    return this.pictures()[key] ?? null;
  }

  private async load(friendId: string, key: string, pictureAt: string): Promise<void> {
    try {
      const generation = this.active.generation;
      const { image } = await this.api.request<ProfilePicture>(`/circles/${this.friends.circle()?.id ?? this.active.id}/friends/${friendId}/picture?v=${encodeURIComponent(pictureAt)}&r=${this.round()}`); // the round in the address: an answer kept by the browser or the app is never used again
      if (image && generation === this.active.generation) this.pictures.update((all) => ({ ...all, [key]: image }));
    } catch {
      this.asked.delete(key); // the next time it is asked for, it tries again
    }
  }
}
