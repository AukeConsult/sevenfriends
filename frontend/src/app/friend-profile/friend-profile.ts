import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { AppDatePipe } from '../core/app-date.pipe';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { FriendsService } from '../core/friends.service';
import { UiPreferencesService } from '../core/ui-preferences';
import { Friend, GroupMember } from '../models';
import { squareJpeg } from '../core/resize-image';
import { countries } from '../core/countries';
import { moodIcon, moodLabel } from '../core/moods';
import { presenceLabel } from '../core/presence';
import { possessive } from '../core/pronoun';
import { MyAvatarService } from '../core/my-avatar.service';
import { MemberPictureService } from '../core/member-picture.service';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { FriendContext } from '../friend-page/friend-context';
import { tr } from '../core/i18n';

/**
 * The profile of one friend (`/friends/:id/profile`, opened with the friend's picture): who they are and how to reach them, under the header of the friend page.
 * Later it also gets the statistics of the conversation (see docs/design/friend-statistics.md).
 */
@Component({
  selector: 'app-friend-profile',
  imports: [AppDatePipe, FriendAvatar, TranslocoDirective, RouterLink, NgTemplateOutlet],
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

  /** A group: the people in it, and which of my friends can still be added. */
  protected readonly members = signal<GroupMember[]>([]);
  protected readonly adding = signal(false);
  private readonly myAvatar = inject(MyAvatarService);
  private readonly memberPicture = inject(MemberPictureService);
  /** The picture of a member: mine, else my friend's; null = the initial is shown. */
  protected pictureOf(m: GroupMember): string | null {
    return this.memberPicture.of(m);
  }
  protected initial(name: string): string { return (name.trim()[0] ?? '?').toUpperCase(); }
  protected readonly canAdd = computed(() => {
    const inGroup = new Set(this.members().map((m) => m.friendId));
    return this.friendsService.friends().filter((f) => !f.group && f.status === 'confirmed' && !f.asleep && !inGroup.has(f.id));
  });

  constructor() {
    effect(() => {
      const f = this.ctx.friend();
      if (f?.group) {
        void untracked(() => this.loadMembers(f.id));
        void untracked(() => this.myAvatar.load());
      }
    });
  }

  private async loadMembers(id: string): Promise<void> {
    try {
      this.members.set(await this.friendsService.groupMembers(id));
    } catch (err: any) {
      this.error.set(err.message);
    }
  }

  /** Autosave of a group's name or description (when the field is left). */
  protected saveGroup(f: Friend, change: { name?: string; description?: string }): Promise<void> {
    const name = change.name?.trim();
    if (name === '' || (name !== undefined && name === f.name) || (change.description !== undefined && change.description === (f.description ?? ''))) return Promise.resolve();
    return this.run(() => this.friendsService.updateGroup(f.id, { ...change, ...(name ? { name } : {}) }));
  }

  protected async choosePicture(f: Friend, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.run(async () => this.friendsService.updateGroup(f.id, { picture: await squareJpeg(file) }));
  }

  protected removePicture(f: Friend): Promise<void> {
    return this.run(() => this.friendsService.updateGroup(f.id, { picture: null }));
  }

  /** What happened when somebody was added that the person should know ("on their sleep list"). */
  protected readonly note = signal<string | null>(null);

  protected async addMember(f: Friend, friendId: string): Promise<void> {
    const name = this.canAdd().find((c) => c.id === friendId)?.name ?? '';
    this.note.set(null);
    await this.run(
      async () => {
        const added = await this.friendsService.addGroupMember(f.id, friendId);
        if (added.asleep) this.note.set(tr('friendProfile.addedToSleepList', '{{ name }} has no free seat, so the group is on their sleep list.', { name }));
      },
      () => this.loadMembers(f.id),
    );
    this.adding.set(false);
  }

  /** Who added this member ("You" for me), or '' when it is not known. */
  protected inviterName(member: GroupMember): string {
    const by = this.members().find((m) => m.uid === member.invitedBy);
    return by ? (by.you ? tr('friendProfile.you', 'You') : by.name) : '';
  }

  protected removeMember(f: Friend, member: GroupMember): Promise<void> {
    return this.run(() => this.friendsService.removeGroupMember(f.id, member.uid), () => this.loadMembers(f.id));
  }

  /** A confirmed friend is put to sleep (the conversation is kept) when the sleep list is used; anything else is deleted. */
  protected sleepable(friend: Friend): boolean {
    return friend.status === 'confirmed' && !friend.asleep && this.prefs.get('sleepList'); // one that sleeps is woken up or deleted, not put to sleep again
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

  /** Wake a sleeping friend: they get a seat again (the server answers with an error when no seat is free). */
  protected wake(friend: Friend): Promise<void> {
    return this.run(() => this.friendsService.sleep(friend.id, false));
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
