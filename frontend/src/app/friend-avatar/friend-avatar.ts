import { Component, computed, inject, input } from '@angular/core';
import { FriendPictureService } from '../core/friend-picture.service';
import { Friend } from '../models';

/**
 * The round picture of a friend: their uploaded picture, else the icon they chose for themselves, else the icon of the
 * seat they sit in (friend1.svg ... friend7.svg). It follows what the friend changes.
 */
@Component({
  selector: 'app-friend-avatar',
  host: { style: 'display: contents' },
  template: `<img class="sf-avatar" [class.sf-avatar-sm]="small()" [src]="src()" alt="" draggable="false" [attr.width]="size()" [attr.height]="size()" />`,
})
export class FriendAvatar {
  private readonly pictures = inject(FriendPictureService);

  readonly friend = input.required<Friend>();
  /** the seat (1-7) of the friend; 0 = none (a friend on the sleep list is not in a seat) */
  readonly seat = input.required<number>();
  readonly small = input(false);
  /** the size in pixels (the CSS decides how big it is drawn; this is the size before the CSS is there) */
  readonly size = input(32);

  protected readonly src = computed(() => {
    const friend = this.friend();
    if (friend.group) return this.pictures.src(friend.id, friend.pictureId ?? friend.pictureAt) ?? 'icons/friends/group.svg'; // a group: its picture, else the group icon (never a seat icon)
    const icon = friend.icon ?? this.seat();
    return this.pictures.src(friend.id, friend.pictureId ?? friend.pictureAt) ?? (icon >= 1 && icon <= 7 ? `icons/friends/friend${icon}.svg` : 'icons/friends/group.svg'); // no seat (the sleep list) and no chosen icon: a neutral icon, never a seat's
  });
}
