import { Injectable, inject } from '@angular/core';
import { FriendPictureService } from './friend-picture.service';
import { FriendsService } from './friends.service';
import { MyAvatarService } from './my-avatar.service';

/** The picture of a person in a group: mine, else the picture (or seat icon) of my friend; null = the initials are shown (not my friend, or gone). */
@Injectable({ providedIn: 'root' })
export class MemberPictureService {
  private readonly myAvatar = inject(MyAvatarService);
  private readonly friends = inject(FriendsService);
  private readonly pictures = inject(FriendPictureService);

  of(member: { you: boolean; friendId: string | null }): string | null {
    if (member.you) return this.myAvatar.src();
    const friend = this.friends.friends().find((x) => x.id === member.friendId);
    if (!friend) return null;
    const seat = this.friends.awake().findIndex((x) => x.id === friend.id) + 1;
    return this.pictures.src(friend.id, friend.pictureAt) ?? `icons/friends/friend${friend.icon ?? (seat || 1)}.svg`;
  }
}
