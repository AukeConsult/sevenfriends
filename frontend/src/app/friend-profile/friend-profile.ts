import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { AppDatePipe } from '../core/app-date.pipe';
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FriendsService } from '../core/friends.service';
import { UiPreferencesService } from '../core/ui-preferences';
import { Friend } from '../models';
import { countries } from '../core/countries';
import { moodIcon, moodLabel } from '../core/moods';
import { presenceLabel } from '../core/presence';
import { possessive } from '../core/pronoun';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { FriendContext } from '../friend-page/friend-context';
import { tr } from '../core/i18n';

/**
 * The profile of one friend (`/friends/:id/profile`, opened with the friend's picture): who they are and how to reach them, under the header of the friend page.
 * Later it also gets the statistics of the conversation (see docs/design/friend-statistics.md).
 */
@Component({
  selector: 'app-friend-profile',
  imports: [AppDatePipe, FriendAvatar, TranslocoDirective],
  templateUrl: './friend-profile.html',
  providers: [provideTranslocoScope('friendProfile')],
})
export class FriendProfile {
  protected readonly ctx = inject(FriendContext);
  protected readonly presenceLabel = presenceLabel;
  protected readonly moodIcon = moodIcon;
  protected readonly possessive = possessive;
  protected readonly moodLabel = moodLabel;
  private readonly countryNames = new Map(countries().map((c) => [c.code, c.name]));

  private readonly friendsService = inject(FriendsService);
  private readonly prefs = inject(UiPreferencesService);
  private readonly router = inject(Router);
  protected readonly error = signal<string | null>(null);
  protected readonly asking = signal(false);
  protected readonly busy = signal(false);

  /** A confirmed friend is put to sleep (the conversation is kept) when the sleep list is used; anything else is deleted. */
  protected sleepable(friend: Friend): boolean {
    return friend.status === 'confirmed' && this.prefs.get('sleepList');
  }

  protected deleteMessage(friend: Friend): string {
    if (this.sleepable(friend)) {
      return tr('friendProfile.putToSleepLeaves', 'Put {{ friendName }} to sleep? {{ friendName }} leaves your list and the seat is free again. Your conversation is kept, and you can wake {{ friendName }} up from the sleep list.', { friendName: friend.name });
    }
    return friend.invited || friend.incoming
      ? tr('friendProfile.deleteThisRemovesThe', 'Delete {{ friendName }}? This removes the connection from your list and from theirs.', { friendName: friend.name })
      : tr('friendProfile.removeFromYourCircle', 'Remove {{ friendName }} from your circle?', { friendName: friend.name });
  }

  private async run(action: () => Promise<unknown>, after?: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      await this.friendsService.load(); // a freed seat is given to the next waiting request
      await after?.();
    } catch (err: any) {
      this.error.set(err.message);
    } finally {
      this.busy.set(false);
    }
  }

  protected remove(friend: Friend): Promise<void> {
    return this.run(
      () => (this.sleepable(friend) ? this.friendsService.sleep(friend.id, true) : this.friendsService.remove(friend.id)),
      () => this.router.navigateByUrl('/'),
    );
  }

  /** I know it is really them: the "not verified" warning goes away. */
  protected trust(friend: Friend): Promise<void> {
    return this.run(() => this.friendsService.trust(friend.id));
  }

  /** Confirm a friend who invited me (a pending seat). */
  protected confirm(friend: Friend): Promise<void> {
    return friend.requestId ? this.run(() => this.friendsService.acceptRequest(friend.requestId!)) : Promise.resolve();
  }

  /** Reject a friend who invited me: they will see the request as rejected. */
  protected reject(friend: Friend): Promise<void> {
    return friend.requestId ? this.run(() => this.friendsService.rejectRequest(friend.requestId!)) : Promise.resolve();
  }

  protected countryName(code: string | null): string {
    return (code && this.countryNames.get(code)) || '';
  }
}
