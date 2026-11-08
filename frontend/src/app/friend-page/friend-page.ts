import { computed, Component, DestroyRef, ElementRef, HostListener, effect, inject, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { moodIcon, moodLabel } from '../core/moods';
import { MyAvatarService } from '../core/my-avatar.service';
import { UiPreferencesService } from '../core/ui-preferences';
import { profileColorHex, profileColorInk, profileColorSoft } from '../models';
import { presenceLabel } from '../core/presence';
import { possessive } from '../core/pronoun';
import { RealtimeService } from '../core/realtime.service';
import { FriendAvatar } from '../friend-avatar/friend-avatar';
import { FriendContext } from './friend-context';

/**
 * The page of one friend: /friends/:id. The header stays (the friend, the padlock, the menu, the profile and the lock frame); what is under it changes with the
 * two icons in the header: the messages (the feed), or the safebox with this friend. Everything the header and the pages share is in `FriendContext`.
 */
@Component({
  selector: 'app-friend-page',
  imports: [FriendAvatar, RouterLink, RouterLinkActive, RouterOutlet],
  providers: [FriendContext],
  templateUrl: './friend-page.html',
  // every page under the header has the look of the conversation: a light tint of the friend's colour, and my own colour for what is mine
  host: {
    class: 'd-block sf-friend-page',
    '[class.sf-feed-tinted]': '!!feedBackground()',
    '[style.--sf-feed-bg]': 'feedBackground()',
    '[style.--sf-friend]': 'ctx.friendColor()',
    '[style.--sf-friend-ink]': 'ctx.friendInk()',
    '[style.--sf-my]': 'myColor()',
    '[style.--sf-my-ink]': 'myInk()',
  }, // the header sticks to the top of this block
})
export class FriendPage {
  protected readonly ctx = inject(FriendContext);
  private readonly realtime = inject(RealtimeService);
  private readonly myAvatar = inject(MyAvatarService);
  private readonly prefs = inject(UiPreferencesService);
  protected readonly feedBackground = computed(() => profileColorSoft(this.ctx.friend()?.color));
  protected readonly myColor = computed(() => profileColorHex(this.myAvatar.color()));
  protected readonly myInk = computed(() => profileColorInk(this.myAvatar.color()));
  private readonly router = inject(Router);
  private readonly bar = viewChild<ElementRef<HTMLElement>>('bar');
  private lastLive = this.realtime.latestMessage()?.seq ?? 0; // live messages before this page opened are not news

  protected readonly presenceLabel = presenceLabel;
  protected readonly moodIcon = moodIcon;
  protected readonly possessive = possessive;
  protected readonly moodLabel = moodLabel;

  /** the address now: the feed is `/friends/<id>`, anything longer (the safebox) is another page */
  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url.split(/[?#]/)[0])), { initialValue: this.router.url.split(/[?#]/)[0] });
  /** the menu has no item for the page you are already on */
  protected readonly onSafebox = computed(() => this.url().startsWith(`/friends/${this.ctx.friendId}/safebox`));
  protected readonly onFeed = computed(() => this.url().replace(/\/$/, '') === `/friends/${this.ctx.friendId}`);
  protected readonly onSend = computed(() => this.url().startsWith(`/friends/${this.ctx.friendId}/send`));
  protected readonly onProfile = computed(() => this.url().startsWith(`/friends/${this.ctx.friendId}/profile`));
  protected readonly onLock = computed(() => this.url().startsWith(`/friends/${this.ctx.friendId}/lock`));

  constructor() {
    // new messages from this friend come to this page (the feed, or the dot while the safebox is open), not to the Home list
    this.realtime.openFeed.set(this.ctx.friendId);
    if (this.prefs.get('feedIcons')) void this.myAvatar.load(); // my colour, for what is mine on every page under the header
    inject(DestroyRef).onDestroy(() => {
      if (this.realtime.openFeed() === this.ctx.friendId) this.realtime.openFeed.set(null);
    });

    // a message arrived while the safebox is open: a dot on the Messages icon until the feed is opened
    effect(() => {
      const onFeed = this.onFeed();
      const live = this.realtime.latestMessage();
      untracked(() => {
        if (onFeed) {
          this.ctx.messageDot.set(false);
          if (live) this.lastLive = live.seq;
        } else if (live && live.seq > this.lastLive) {
          this.lastLive = live.seq;
          if (live.connectionId === this.ctx.friendId) this.ctx.messageDot.set(true);
        }
      });
    });

    // the header's height (it changes with the notch and the font size)
    effect((onCleanup) => {
      const header = this.bar()?.nativeElement;
      if (!header) return;
      const watch = new ResizeObserver(() => this.ctx.barHeight.set(header.offsetHeight));
      watch.observe(header);
      onCleanup(() => watch.disconnect());
    });
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    const target = event.target as Element | null;
    if (this.ctx.moreOpen() && !target?.closest('.sf-more')) this.ctx.moreOpen.set(false);
  }
}
