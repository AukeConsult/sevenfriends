import { ActiveCircleService } from './active-circle.service';
import { Injectable, inject, signal } from '@angular/core';
import { ProfilePicture } from '../models';
import { ApiService } from './api.service';
import { FriendsService } from './friends.service';

/**
 * The uploaded pictures of my friends. The friend list only says WHEN a picture changed (`pictureAt`); the picture itself
 * (a small data URL) is fetched once per version and kept here, so a changed picture is fetched again and an unchanged
 * one never.
 */
@Injectable({ providedIn: 'root' })
export class FriendPictureService {
  private readonly active = inject(ActiveCircleService);
  private readonly api = inject(ApiService);
  private readonly friends = inject(FriendsService);

  /** the pictures that are here: "friendId@pictureAt" -> data URL */
  private readonly pictures = signal<Record<string, string>>({});
  private readonly asked = new Set<string>();

  constructor() {
    this.active.onSwitch(() => {
      this.pictures.set({});
      this.asked.clear();
    });
  }

  /** The picture of this friend once it is here (asks for it the first time); null while it is on its way, or when there is none. */
  src(friendId: string, pictureAt: string | null): string | null {
    if (!pictureAt) return null;
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
      const { image } = await this.api.request<ProfilePicture>(`/circles/${this.friends.circle()?.id ?? this.active.id}/friends/${friendId}/picture?v=${encodeURIComponent(pictureAt)}`); // the version in the address: an old answer kept by the browser or the app is never used for a new picture
      if (image && generation === this.active.generation) this.pictures.update((all) => ({ ...all, [key]: image }));
    } catch {
      this.asked.delete(key); // the next time it is asked for, it tries again
    }
  }
}
