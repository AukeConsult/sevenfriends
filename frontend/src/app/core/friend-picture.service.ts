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

  /** The picture of this friend once it is here (asks for it the first time); null while it is on its way, or when there is none. */
  src(friendId: string, pictureAt: string | null): string | null {
    if (!pictureAt) return null;
    const key = `${friendId}@${pictureAt}`;
    if (!this.asked.has(key)) {
      this.asked.add(key);
      void this.load(friendId, key);
    }
    return this.pictures()[key] ?? null;
  }

  private async load(friendId: string, key: string): Promise<void> {
    try {
      const { image } = await this.api.request<ProfilePicture>(`/circles/${this.friends.circle()?.id ?? this.active.id}/friends/${friendId}/picture`);
      if (image) this.pictures.update((all) => ({ ...all, [key]: image }));
    } catch {
      this.asked.delete(key); // the next time it is asked for, it tries again
    }
  }
}
