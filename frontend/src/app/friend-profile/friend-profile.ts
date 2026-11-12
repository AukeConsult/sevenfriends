import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { AppDatePipe } from '../core/app-date.pipe';
import { Component, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
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
import { PageBar } from '../page-bar/page-bar';

/**
 * The profile of one friend (`/friends/:id/profile`, opened with the friend's picture): who they are and how to reach them, under the header of the friend page.
 * Later it also gets the statistics of the conversation (see docs/design/friend-statistics.md).
 */
@Component({
  selector: 'app-friend-profile',
  imports: [PageBar, AppDatePipe, FriendAvatar, TranslocoDirective, RouterLink, NgTemplateOutlet],
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

  /** A tap on an empty place, or a swipe to the left, goes back to the conversation (not when something is open, or the tap is on a button, a link, a field or the bars). */
  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    const target = event.target as Element | null;
    if (!target || !target.isConnected || window.getSelection()?.toString() || this.asking() || this.adding() || this.leaving()) return;
    if (document.activeElement?.matches('input, textarea')) return; // the first tap only leaves the field being edited (the group's name and description)
    if (target.closest('a, button, input, textarea, select, label, summary, .sf-bar, .sf-expand, .sf-confirm, app-bottom-nav, [role="alertdialog"]')) return;
    this.back();
  }

  private swipeStart: { x: number; y: number; time: number } | null = null;

  @HostListener('document:touchstart', ['$event'])
  protected onTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    this.swipeStart = event.touches.length === 1 && touch && !(event.target as Element | null)?.closest('input, textarea, select, audio, video, iframe, [contenteditable], [role="slider"]') ? { x: touch.clientX, y: touch.clientY, time: Date.now() } : null;
  }

  @HostListener('document:touchend', ['$event'])
  protected onTouchEnd(event: TouchEvent): void {
    const start = this.swipeStart;
    this.swipeStart = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Date.now() - start.time <= 700 && dx <= -70 && Math.abs(dx) >= Math.abs(dy) * 1.8) this.back();
  }

  private back(): void {
    void this.router.navigate(['/friends', this.ctx.friendId]);
  }

  /** A group: the people in it, and which of my friends can still be added. */
  protected readonly members = signal<GroupMember[]>([]);
  protected readonly adding = signal(false);
  /** the question "leave the group?" is open */
  protected readonly leaving = signal(false);
  /** what else leaving means for me: the ownership goes on, or the group ends with me */
  protected readonly leaveNote = computed(() => {
    const list = this.members();
    const me = list.find((m) => m.you);
    if (list.length <= 1) return tr('friendProfile.leaveLastNote', 'You are the last person: the group and everything in it is deleted.');
    return me?.creator ? tr('friendProfile.leaveOwnerNote', 'You are the owner: the next person in the list becomes the owner.') : '';
  });

  /** Leave the group: it goes from my list, my messages and safebox items in it are deleted, the others keep it. */
  protected leave(friend: Friend): Promise<void> {
    return this.run(() => this.friendsService.remove(friend.id), () => this.router.navigateByUrl('/'));
  }
  private readonly myAvatar = inject(MyAvatarService);
  private readonly memberPicture = inject(MemberPictureService);
  /** The picture of a member: mine, else my friend's; null = the initial is shown. */
  protected pictureOf(m: GroupMember): string | null {
    return this.memberPicture.of(m);
  }
  protected initial(name: string): string { return (name.trim()[0] ?? '?').toUpperCase(); }
  /** Every friend of mine that is not a group, and why one cannot be added (null = can): so nobody wonders where a friend is. */
  protected readonly addChoices = computed(() => {
    const inGroup = new Set(this.members().map((m) => m.friendId));
    const full = this.members().length >= 7;
    return this.friendsService
      .friends()
      .filter((f) => !f.group)
      .map((f) => ({
        friend: f,
        reason: inGroup.has(f.id)
          ? tr('friendProfile.alreadyInGroup', 'Already in the group')
          : f.status !== 'confirmed'
            ? tr('friendProfile.notConfirmedYet', 'Has not confirmed the friendship yet')
            : full
              ? tr('friendProfile.groupIsFull', 'The group has 7 people, the most there can be')
              : null,
      }));
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
    const name = this.friendsService.friends().find((c) => c.id === friendId)?.name ?? '';
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
    if (friend.group) return tr('friendProfile.leaveQuestion', 'Leave {{ name }}? Your messages in the group and your safebox items there are deleted for everybody. The others keep the group. You are back only if someone adds you again.', { name: friend.name });
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
