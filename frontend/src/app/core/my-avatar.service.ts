import { Injectable, inject, signal } from '@angular/core';
import { ProfileDetails, ProfilePicture } from '../models';
import { ApiService } from './api.service';

/** My own picture for the message feed: the one I uploaded, else the icon I chose; null = neither (the initials are shown). */
@Injectable({ providedIn: 'root' })
export class MyAvatarService {
  private readonly api = inject(ApiService);

  readonly src = signal<string | null>(null);

  /** Reads it again from my profile (called when a feed is opened, so a change on the profile page shows). */
  async load(): Promise<void> {
    try {
      const profile = await this.api.request<ProfileDetails>('/profile');
      if (profile.hasPicture) {
        this.src.set((await this.api.request<ProfilePicture>('/profile/picture').catch(() => null))?.image ?? null);
      } else {
        this.src.set(profile.icon ? `icons/friends/friend${profile.icon}.svg` : null);
      }
    } catch {
      /* no picture: the initials are shown */
    }
  }
}
