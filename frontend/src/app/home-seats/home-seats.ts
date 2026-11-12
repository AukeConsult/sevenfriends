import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { Component, computed, inject, output, signal } from '@angular/core';
import { ActiveCircleService } from '../core/active-circle.service';
import { Router } from '@angular/router';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { FriendsService } from '../core/friends.service';
import { MessagesService } from '../core/messages.service';
import { NotificationsService } from '../core/notifications.service';
import { UiPreferencesService } from '../core/ui-preferences';
import { moodIcon, moodLabel } from '../core/moods';
import { presenceLabel } from '../core/presence';
import { Friend, FriendSlot, profileColorHex } from '../models';

const MAX_FRIENDS = 7;

/**
 * The seven seats on Home, all of them (empty seats too, as on the Friends page): each friend as a round picture in their colour with the seat
 * number, how they are (the dot, the mood) and how many unread messages they sent. A tap opens the conversation. Press and hold a friend to drag the friend
 * onto another seat (the two change places, or the friend takes a free seat) or onto the silent bucket (the sleep list: no seat, no sound).
 */
@Component({
  selector: 'app-home-seats',
  imports: [FriendAvatar, TranslocoDirective],
  templateUrl: './home-seats.html',
  providers: [provideTranslocoScope('homeSeats')],
})
export class HomeSeats {
  protected readonly w = inject(ActiveCircleService).words;
  private readonly friendsService = inject(FriendsService);
  private readonly messagesService = inject(MessagesService);
  private readonly notifications = inject(NotificationsService);
  private readonly prefs = inject(UiPreferencesService);
  private readonly router = inject(Router);

  /** the silent bucket was tapped: Home shows the sleep list in place of everything else */
  readonly silent = output<void>();
  /** a free seat was tapped: Home shows the add-friend form in place of everything else */
  readonly add = output<void>();

  protected readonly presenceLabel = presenceLabel;
  protected readonly moodIcon = moodIcon;
  protected readonly moodLabel = moodLabel;

  protected readonly slots = computed<FriendSlot[]>(() =>
    Array.from({ length: MAX_FRIENDS }, (_, i) => ({ position: i + 1, friend: this.friendsService.awake().find((f) => f.seat === i + 1) ?? null })),
  );
  protected readonly unread = computed(() => {
    const counts = new Map<string, number>();
    for (const m of this.messagesService.messages()) if (m.connectionId) counts.set(m.connectionId, (counts.get(m.connectionId) ?? 0) + 1);
    return counts;
  });
  protected readonly sleeping = computed(() => this.friendsService.sleeping().length);
  /** the silent bucket is shown when the sleep list is used, or when friends are still on it */
  protected readonly seatMoved = this.prefs.value('seatMoved');
  protected readonly showBucket = computed(() => this.prefs.value('sleepList')() || this.sleeping() > 0);

  protected readonly error = signal<string | null>(null);
  protected readonly dragging = signal<{ from: number; startX: number; startY: number } | null>(null);
  protected readonly dragDx = signal(0);
  protected readonly dragDy = signal(0);
  protected readonly dropSeat = signal<number | null>(null);
  protected readonly overBucket = signal(false);

  protected colorOf(key: string | null): string | null {
    return profileColorHex(key);
  }

  private friendIn(seat: number): Friend | null {
    return this.slots().find((s) => s.position === seat)?.friend ?? null;
  }

  /** a confirmed friend can go to sleep (when the sleep list is switched on); a request that is not confirmed yet cannot */
  private canSilence(friend: Friend): boolean {
    return friend.status === 'confirmed' && this.prefs.get('sleepList');
  }

  /** A tap opens the conversation (the profile for a request that is not confirmed yet); a tap that ends a drag does not. */
  protected open(friend: Friend): void {
    if (this.justDragged) return;
    void this.router.navigateByUrl(friend.status === 'confirmed' ? `/friends/${friend.id}` : `/friends/${friend.id}/profile`);
  }

  /** the seat that is being held (the ring turns around the picture) until the hold is long enough to pick the friend up */
  protected readonly pressing = signal<number | null>(null);
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private justDragged = false;
  private static readonly HOLD_MS = 250;
  private static readonly MOVE_PX = 8;

  /** a finger or mouse held on a friend for a moment picks the friend up; before that the page scrolls and a tap opens as usual */
  protected dragStart(event: PointerEvent, seat: number): void {
    this.justDragged = false;
    const target = event.currentTarget as HTMLElement;
    const { pointerId, clientX, clientY } = event;
    this.pressing.set(seat);
    this.blockMenu(true);
    this.holdStart = { x: clientX, y: clientY };
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => {
      this.pressing.set(null);
      this.error.set(null);
      target.setPointerCapture?.(pointerId);
      navigator.vibrate?.(15);
      document.addEventListener('touchmove', this.blockScroll, { passive: false });
      this.dragging.set({ from: seat, startX: clientX, startY: clientY });
      this.dragDx.set(0);
      this.dragDy.set(0);
      this.dropSeat.set(seat);
    }, HomeSeats.HOLD_MS);
  }

  private holdStart = { x: 0, y: 0 };

  private readonly blockScroll = (e: TouchEvent): void => {
    if (e.cancelable) e.preventDefault();
  };

  /** while a friend is pressed or moved, the browser's own menu (Download, Print, ...) and the text marking must not open: they would take the press away */
  private readonly noMenu = (e: Event): void => e.preventDefault();
  private menuTimer: ReturnType<typeof setTimeout> | undefined;
  private blockMenu(on: boolean): void {
    clearTimeout(this.menuTimer);
    if (on) {
      document.addEventListener('contextmenu', this.noMenu, true);
      document.addEventListener('selectstart', this.noMenu, true);
      this.menuTimer = setTimeout(() => this.blockMenu(false), 8000); // never left on
    } else {
      document.removeEventListener('contextmenu', this.noMenu, true);
      document.removeEventListener('selectstart', this.noMenu, true);
    }
  }

  private endHold(): void {
    clearTimeout(this.holdTimer);
    this.pressing.set(null);
    document.removeEventListener('touchmove', this.blockScroll);
    if (!this.dragging()) setTimeout(() => this.blockMenu(false), 700); // the menu of a long press comes a moment after the hold
  }

  protected dragMove(event: PointerEvent): void {
    const drag = this.dragging();
    if (!drag) {
      if (this.pressing() !== null && Math.hypot(event.clientX - this.holdStart.x, event.clientY - this.holdStart.y) > HomeSeats.MOVE_PX) this.endHold(); // moved: it is a scroll, not a hold
      return;
    }
    this.dragDx.set(event.clientX - drag.startX);
    this.dragDy.set(event.clientY - drag.startY);
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const mover = this.friendIn(drag.from);
    const bucket = !!under?.closest('[data-bucket]') && !!mover && this.canSilence(mover);
    this.overBucket.set(bucket);
    const seat = under?.closest('[data-hs-seat]')?.getAttribute('data-hs-seat');
    this.dropSeat.set(bucket ? drag.from : seat ? Number(seat) : drag.from);
  }

  protected async dragEnd(event: PointerEvent, cancelled = false): Promise<void> {
    this.endHold();
    const drag = this.dragging();
    if (!drag) return;
    this.justDragged = true;
    setTimeout(() => (this.justDragged = false)); // the click that follows this pointer-up must not open the conversation
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    const to = this.dropSeat();
    const toBucket = this.overBucket();
    this.dragging.set(null);
    setTimeout(() => this.blockMenu(false), 700);
    this.dragDx.set(0);
    this.dragDy.set(0);
    this.dropSeat.set(null);
    this.overBucket.set(false);
    if (cancelled) return;
    const mover = this.friendIn(drag.from);
    if (!mover) return;
    if (toBucket || (to && to !== drag.from)) this.prefs.set('seatMoved', true); // learned: the tip goes away
    try {
      if (toBucket) {
        await this.friendsService.sleep(mover.id, true);
        await this.notifications.refresh(); // the freed seat can go to a waiting request
        await this.friendsService.load();
      } else if (to && to !== drag.from) {
        await this.friendsService.moveToSeat(mover.id, to);
      }
    } catch (err: any) {
      this.error.set(err.message ?? tr('homeSeats.couldNotMoveThe', 'Could not move the ') + this.w.one);
    }
  }

  /** The arrow keys on a seat: one seat to the left or right. */
  protected async seatKey(event: KeyboardEvent, seat: number): Promise<void> {
    const to = event.key === 'ArrowLeft' ? seat - 1 : event.key === 'ArrowRight' ? seat + 1 : 0;
    const mover = this.friendIn(seat);
    if (!mover || to < 1 || to > MAX_FRIENDS) return;
    event.preventDefault();
    try {
      await this.friendsService.moveToSeat(mover.id, to);
    } catch (err: any) {
      this.error.set(err.message ?? tr('homeSeats.couldNotMoveThe', 'Could not move the ') + this.w.one);
    }
  }
}
