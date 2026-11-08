import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { countries } from '../core/countries';
import { moodIcon, moodLabel } from '../core/moods';
import { presenceLabel } from '../core/presence';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { FriendContext } from '../friend-page/friend-context';

/**
 * The profile of one friend (`/friends/:id/profile`, opened with the friend's picture): who they are and how to reach them, under the header of the friend page.
 * Later it also gets the statistics of the conversation (see docs/design/friend-statistics.md).
 */
@Component({
  selector: 'app-friend-profile',
  imports: [DatePipe, FriendAvatar],
  templateUrl: './friend-profile.html',
})
export class FriendProfile {
  protected readonly ctx = inject(FriendContext);
  protected readonly presenceLabel = presenceLabel;
  protected readonly moodIcon = moodIcon;
  protected readonly moodLabel = moodLabel;
  private readonly countryNames = new Map(countries().map((c) => [c.code, c.name]));

  protected countryName(code: string | null): string {
    return (code && this.countryNames.get(code)) || '';
  }
}
